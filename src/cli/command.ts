import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import packageJson from "../../package.json";
import { CliProfile } from "./profile";
import { RegistryClient, parseTemplateIdentifier } from "./registry";
import { TemplateStore } from "./store";
import { Generator } from "../generator/generator";
import { INVALID_TEMPLATE_LITERAL, parseTemplateLiteral } from "../template/literal";

type CliWriter = (message: string) => void;

export interface RunCliOptions {
    cwd?: string;
    stdout?: CliWriter;
    stderr?: CliWriter;
    storeHomeDir?: string;
    apiUrl?: string;
    fetchImplementation?: typeof fetch;
}

type GenerateCommandOptions = {
    target?: string;
    templatePath?: string;
    outDir?: string;
    dataPath?: string;
    argAssignments: string[];
    dryRun: boolean;
};

type SaveCommandOptions = {
    templatePath: string;
    alias?: string;
};

type RemoveCommandOptions = {
    name: string;
};

type AddCommandOptions = {
    identifier: string;
};

type UseCommandOptions = {
    identifier: string;
    outDir?: string;
    dataPath?: string;
    argAssignments: string[];
    dryRun: boolean;
};

type LoginCommandOptions = {
    username: string;
    password: string;
    duration: number;
};

type SignupCommandOptions = {
    username: string;
    password: string;
};

type PublishCommandOptions = {
    target?: string;
    templatePath?: string;
};

type CommandHelp = {
    canonicalName: string;
    aliases: string[];
    helpText: string;
};

type CliFormatter = ReturnType<typeof createCliFormatter>;

type GeneratorRunOptions = Required<Pick<RunCliOptions, "stdout">> & Pick<RunCliOptions, "cwd" | "storeHomeDir"> & { format: CliFormatter };
type RegistryRunOptions = Required<Pick<RunCliOptions, "stdout">> &
    Pick<RunCliOptions, "cwd" | "storeHomeDir" | "apiUrl" | "fetchImplementation"> & { format: CliFormatter };

const VERSION = typeof packageJson.version === "string" ? packageJson.version : "0.0.0";

const COMMANDS: Record<string, CommandHelp> = {
    generate: {
        canonicalName: "generate",
        aliases: ["gen"],
        helpText: `mtrgen generate [name] [key=value ...]

Generate files from an MTRGEN template.

Options:
  -p, --path <file>         Generate from a template file path instead of a saved template name
  -o, --out-dir <dir>       Output root directory (default: current working directory)
  -d, --data <file>         JSON file with template arguments
  -a, --arg <key=value>     Template argument, repeatable
      --dry-run             Print the files that would be generated
  -h, --help                Show help

Examples:
  mtrgen generate ButtonTemplate name=button folder=ui
  mtrgen generate --path ./templates/component.ts.mtr --arg name=Button
  mtrgen gen ButtonTemplate --data ./component.json --out-dir ./src
`,
    },
    save: {
        canonicalName: "save",
        aliases: ["s"],
        helpText: `mtrgen save <template-path>

Save a template to the local store.

Options:
  -a, --alias <name>        Alias to use instead of the template header name
  -h, --help                Show help

Examples:
  mtrgen save ./templates/component.ts.mtr
  mtrgen save ./templates/component.ts.mtr --alias ButtonTemplate
`,
    },
    saved: {
        canonicalName: "saved",
        aliases: ["ls"],
        helpText: `mtrgen saved

List templates saved in the local store.

Options:
  -h, --help                Show help
`,
    },
    remove: {
        canonicalName: "remove",
        aliases: ["rm"],
        helpText: `mtrgen remove <name>

Remove a template from the local store.

Options:
  -h, --help                Show help
`,
    },
    repair: {
        canonicalName: "repair",
        aliases: ["r"],
        helpText: `mtrgen repair

Repair the local store by removing entries whose template files no longer exist.

Options:
  -h, --help                Show help
`,
    },
    add: {
        canonicalName: "add",
        aliases: ["a"],
        helpText: `mtrgen add <vendor/name>

Download a template from the online registry and save it to the local store.

Options:
  -h, --help                Show help

Examples:
  mtrgen add vendor/component
`,
    },
    use: {
        canonicalName: "use",
        aliases: ["u"],
        helpText: `mtrgen use <vendor/name> [key=value ...]

Generate files directly from a template in the online registry.

Options:
  -o, --out-dir <dir>       Output root directory (default: current working directory)
  -d, --data <file>         JSON file with template arguments
  -a, --arg <key=value>     Template argument, repeatable
      --dry-run             Print the files that would be generated
  -h, --help                Show help

Examples:
  mtrgen use vendor/component name=button
  mtrgen use vendor/component --data ./component.json --out-dir ./src
`,
    },
    login: {
        canonicalName: "login",
        aliases: ["in"],
        helpText: `mtrgen login <username> <password>

Login to the online registry.

Options:
  -d, --duration <hours>    Session duration in hours (default: 24)
  -h, --help                Show help
`,
    },
    signup: {
        canonicalName: "signup",
        aliases: ["sign"],
        helpText: `mtrgen signup <username> <password>

Create a user account in the online registry.

Options:
  -h, --help                Show help
`,
    },
    publish: {
        canonicalName: "publish",
        aliases: ["pub"],
        helpText: `mtrgen publish [name]

Publish a template to the online registry.

Options:
  -p, --path <file>         Publish from a template file path instead of a saved template name
  -h, --help                Show help

Examples:
  mtrgen publish ButtonTemplate
  mtrgen publish --path ./templates/component.ts.mtr
`,
    },
};

const COMMAND_ALIASES = Object.fromEntries(
    Object.values(COMMANDS).flatMap(({ canonicalName, aliases }) => [canonicalName, ...aliases].map((name) => [name, canonicalName])),
);

const GLOBAL_HELP = `mtrgen <command>

Commands:
  generate, gen            Generate files from a template file or saved template
  save, s                  Save a template to the local store
  saved, ls                List saved templates
  remove, rm               Remove a template from the local store
  repair, r                Repair the local store
  add, a                   Download a template from the online registry
  use, u                   Generate from an online registry template
  login, in                Login to the online registry
  signup, sign             Create a registry account
  publish, pub             Publish a template to the online registry

Other:
  help [command]           Show global or command help
  list                     Show all available commands
  -h, --help               Show help
  -v, --version            Show version

Examples:
  mtrgen generate --path ./templates/component.ts.mtr --arg name=Button
  mtrgen save ./templates/component.ts.mtr --alias ButtonTemplate
  mtrgen use vendor/component name=button
  mtrgen publish ButtonTemplate
`;

export async function runCli(argv: string[], options: RunCliOptions = {}): Promise<number> {
    const stdout = options.stdout ?? console.log;
    const stderr = options.stderr ?? console.error;
    const format = createCliFormatter(shouldUseColor(options));

    try {
        const command = argv[0];

        if (!command || command === "-h" || command === "--help") {
            stdout(GLOBAL_HELP);
            return 0;
        }

        if (command === "-v" || command === "--version" || command === "version") {
            stdout(VERSION);
            return 0;
        }

        if (command === "list") {
            stdout(GLOBAL_HELP);
            return 0;
        }

        if (command === "help") {
            const helpTarget = argv[1];
            stdout(helpTarget ? getCommandHelp(helpTarget) : GLOBAL_HELP);
            return 0;
        }

        const normalizedCommand = COMMAND_ALIASES[command];
        if (!normalizedCommand) {
            throw new Error(`Unknown command "${command}".`);
        }

        switch (normalizedCommand) {
            case "generate": {
                const parsed = parseGenerateCommand(argv.slice(1));
                if ("help" in parsed) {
                    stdout(COMMANDS.generate.helpText);
                    return 0;
                }

                return runGenerateCommand(parsed, {
                    cwd: options.cwd,
                    stdout,
                    storeHomeDir: options.storeHomeDir,
                    format,
                });
            }
            case "save": {
                const parsed = parseSaveCommand(argv.slice(1));
                if ("help" in parsed) {
                    stdout(COMMANDS.save.helpText);
                    return 0;
                }

                return runSaveCommand(parsed, {
                    cwd: options.cwd,
                    stdout,
                    storeHomeDir: options.storeHomeDir,
                    format,
                });
            }
            case "saved": {
                const parsed = parseSavedCommand(argv.slice(1));
                if ("help" in parsed) {
                    stdout(COMMANDS.saved.helpText);
                    return 0;
                }

                return runSavedCommand({
                    stdout,
                    storeHomeDir: options.storeHomeDir,
                    format,
                });
            }
            case "remove": {
                const parsed = parseRemoveCommand(argv.slice(1));
                if ("help" in parsed) {
                    stdout(COMMANDS.remove.helpText);
                    return 0;
                }

                return runRemoveCommand(parsed, {
                    stdout,
                    storeHomeDir: options.storeHomeDir,
                    format,
                });
            }
            case "repair": {
                const parsed = parseRepairCommand(argv.slice(1));
                if ("help" in parsed) {
                    stdout(COMMANDS.repair.helpText);
                    return 0;
                }

                return runRepairCommand({
                    stdout,
                    storeHomeDir: options.storeHomeDir,
                    format,
                });
            }
            case "add": {
                const parsed = parseAddCommand(argv.slice(1));
                if ("help" in parsed) {
                    stdout(COMMANDS.add.helpText);
                    return 0;
                }

                return await runAddCommand(parsed, {
                    stdout,
                    storeHomeDir: options.storeHomeDir,
                    apiUrl: options.apiUrl,
                    fetchImplementation: options.fetchImplementation,
                    format,
                });
            }
            case "use": {
                const parsed = parseUseCommand(argv.slice(1));
                if ("help" in parsed) {
                    stdout(COMMANDS.use.helpText);
                    return 0;
                }

                return await runUseCommand(parsed, {
                    cwd: options.cwd,
                    stdout,
                    storeHomeDir: options.storeHomeDir,
                    apiUrl: options.apiUrl,
                    fetchImplementation: options.fetchImplementation,
                    format,
                });
            }
            case "login": {
                const parsed = parseLoginCommand(argv.slice(1));
                if ("help" in parsed) {
                    stdout(COMMANDS.login.helpText);
                    return 0;
                }

                return await runLoginCommand(parsed, {
                    stdout,
                    storeHomeDir: options.storeHomeDir,
                    apiUrl: options.apiUrl,
                    fetchImplementation: options.fetchImplementation,
                    format,
                });
            }
            case "signup": {
                const parsed = parseSignupCommand(argv.slice(1));
                if ("help" in parsed) {
                    stdout(COMMANDS.signup.helpText);
                    return 0;
                }

                return await runSignupCommand(parsed, {
                    stdout,
                    storeHomeDir: options.storeHomeDir,
                    apiUrl: options.apiUrl,
                    fetchImplementation: options.fetchImplementation,
                    format,
                });
            }
            case "publish": {
                const parsed = parsePublishCommand(argv.slice(1));
                if ("help" in parsed) {
                    stdout(COMMANDS.publish.helpText);
                    return 0;
                }

                return await runPublishCommand(parsed, {
                    cwd: options.cwd,
                    stdout,
                    storeHomeDir: options.storeHomeDir,
                    apiUrl: options.apiUrl,
                    fetchImplementation: options.fetchImplementation,
                    format,
                });
            }
        }

        throw new Error(`Unhandled command "${normalizedCommand}".`);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        stderr(format.error(`Error: ${message}`));
        stderr("");
        stderr(GLOBAL_HELP);
        return 1;
    }
}

function shouldUseColor(options: RunCliOptions): boolean {
    if (process.env.NO_COLOR) return false;
    if (options.stdout !== undefined || options.stderr !== undefined) return false;
    return Boolean(process.stdout.isTTY || process.stderr.isTTY);
}

function createCliFormatter(useColor: boolean) {
    const wrap = (open: string, message: string): string => useColor ? `${open}${message}\u001B[0m` : message;

    return {
        success: (message: string): string => wrap("\u001B[32m", message),
        warning: (message: string): string => wrap("\u001B[33m", message),
        error: (message: string): string => wrap("\u001B[31m", message),
        info: (message: string): string => wrap("\u001B[36m", message),
        label: (message: string): string => wrap("\u001B[1m", message),
        path: (message: string): string => wrap("\u001B[36m", message),
        value: (message: string): string => wrap("\u001B[33m", message),
    };
}

function getCommandHelp(name: string): string {
    const command = COMMAND_ALIASES[name];
    if (!command) {
        throw new Error(`Unknown command "${name}".`);
    }

    return COMMANDS[command].helpText;
}

function parseGenerateCommand(argv: string[]): GenerateCommandOptions | { help: true } {
    let target: string | undefined;
    let templatePath: string | undefined;
    let outDir: string | undefined;
    let dataPath: string | undefined;
    const argAssignments: string[] = [];
    let dryRun = false;

    for (let index = 0; index < argv.length; index++) {
        const token = argv[index] ?? "";
        if (!token) continue;
        if (token === "-h" || token === "--help") return { help: true };

        if (token === "--dry-run") {
            dryRun = true;
            continue;
        }

        const templatePathValue = readInlineOptionValue(token, "--path");
        if (token === "-p" || token === "--path" || templatePathValue !== undefined) {
            templatePath = token === "-p" || token === "--path"
                ? requireOptionValue(argv, ++index, token)
                : templatePathValue;
            continue;
        }

        const outDirValue = readInlineOptionValue(token, "--out-dir");
        if (token === "-o" || token === "--out-dir" || outDirValue !== undefined) {
            outDir = token === "-o" || token === "--out-dir"
                ? requireOptionValue(argv, ++index, token)
                : outDirValue;
            continue;
        }

        const dataValue = readInlineOptionValue(token, "--data");
        if (token === "-d" || token === "--data" || dataValue !== undefined) {
            dataPath = token === "-d" || token === "--data"
                ? requireOptionValue(argv, ++index, token)
                : dataValue;
            continue;
        }

        const argValue = readInlineOptionValue(token, "--arg");
        if (token === "-a" || token === "--arg" || argValue !== undefined) {
            const assignment = token === "-a" || token === "--arg"
                ? requireOptionValue(argv, ++index, token)
                : argValue ?? "";
            argAssignments.push(assignment);
            continue;
        }

        if (token.startsWith("-")) {
            throw new Error(`Unknown option "${token}".`);
        }

        if (isAssignmentToken(token) && (templatePath || target)) {
            argAssignments.push(token);
            continue;
        }

        if (templatePath) {
            throw new Error(`Unexpected argument "${token}".`);
        }

        if (!target) {
            target = token;
            continue;
        }

        if (isAssignmentToken(token)) {
            argAssignments.push(token);
            continue;
        }

        throw new Error(`Unexpected argument "${token}".`);
    }

    if (!templatePath && !target) {
        throw new Error("Missing template name or --path. Usage: mtrgen generate [name] [key=value ...]");
    }

    return {
        target,
        templatePath,
        outDir,
        dataPath,
        argAssignments,
        dryRun,
    };
}

function parseSaveCommand(argv: string[]): SaveCommandOptions | { help: true } {
    let templatePath: string | undefined;
    let alias: string | undefined;

    for (let index = 0; index < argv.length; index++) {
        const token = argv[index] ?? "";
        if (!token) continue;
        if (token === "-h" || token === "--help") return { help: true };

        const aliasValue = readInlineOptionValue(token, "--alias");
        if (token === "-a" || token === "--alias" || aliasValue !== undefined) {
            alias = token === "-a" || token === "--alias"
                ? requireOptionValue(argv, ++index, token)
                : aliasValue;
            continue;
        }

        if (token.startsWith("-")) {
            throw new Error(`Unknown option "${token}".`);
        }

        if (templatePath) {
            throw new Error(`Unexpected argument "${token}".`);
        }

        templatePath = token;
    }

    if (!templatePath) {
        throw new Error("Missing template path. Usage: mtrgen save <template-path>");
    }

    return {
        templatePath,
        alias,
    };
}

function parseSavedCommand(argv: string[]): Record<never, never> | { help: true } {
    for (const token of argv) {
        if (!token) continue;
        if (token === "-h" || token === "--help") return { help: true };
        throw new Error(`Unexpected argument "${token}".`);
    }

    return {};
}

function parseRemoveCommand(argv: string[]): RemoveCommandOptions | { help: true } {
    let name: string | undefined;

    for (const token of argv) {
        if (!token) continue;
        if (token === "-h" || token === "--help") return { help: true };
        if (token.startsWith("-")) throw new Error(`Unknown option "${token}".`);
        if (name) throw new Error(`Unexpected argument "${token}".`);
        name = token;
    }

    if (!name) {
        throw new Error("Missing template name. Usage: mtrgen remove <name>");
    }

    return { name };
}

function parseRepairCommand(argv: string[]): Record<never, never> | { help: true } {
    for (const token of argv) {
        if (!token) continue;
        if (token === "-h" || token === "--help") return { help: true };
        throw new Error(`Unexpected argument "${token}".`);
    }

    return {};
}

function parseAddCommand(argv: string[]): AddCommandOptions | { help: true } {
    let identifier: string | undefined;

    for (const token of argv) {
        if (!token) continue;
        if (token === "-h" || token === "--help") return { help: true };
        if (token.startsWith("-")) throw new Error(`Unknown option "${token}".`);
        if (identifier) throw new Error(`Unexpected argument "${token}".`);
        identifier = token;
    }

    if (!identifier) {
        throw new Error("Missing template identifier. Usage: mtrgen add <vendor/name>");
    }

    parseTemplateIdentifier(identifier);
    return { identifier };
}

function parseUseCommand(argv: string[]): UseCommandOptions | { help: true } {
    let identifier: string | undefined;
    let outDir: string | undefined;
    let dataPath: string | undefined;
    const argAssignments: string[] = [];
    let dryRun = false;

    for (let index = 0; index < argv.length; index++) {
        const token = argv[index] ?? "";
        if (!token) continue;
        if (token === "-h" || token === "--help") return { help: true };

        if (token === "--dry-run") {
            dryRun = true;
            continue;
        }

        const outDirValue = readInlineOptionValue(token, "--out-dir");
        if (token === "-o" || token === "--out-dir" || outDirValue !== undefined) {
            outDir = token === "-o" || token === "--out-dir"
                ? requireOptionValue(argv, ++index, token)
                : outDirValue;
            continue;
        }

        const dataValue = readInlineOptionValue(token, "--data");
        if (token === "-d" || token === "--data" || dataValue !== undefined) {
            dataPath = token === "-d" || token === "--data"
                ? requireOptionValue(argv, ++index, token)
                : dataValue;
            continue;
        }

        const argValue = readInlineOptionValue(token, "--arg");
        if (token === "-a" || token === "--arg" || argValue !== undefined) {
            const assignment = token === "-a" || token === "--arg"
                ? requireOptionValue(argv, ++index, token)
                : argValue ?? "";
            argAssignments.push(assignment);
            continue;
        }

        if (token.startsWith("-")) {
            throw new Error(`Unknown option "${token}".`);
        }

        if (!identifier) {
            identifier = token;
            continue;
        }

        if (isAssignmentToken(token)) {
            argAssignments.push(token);
            continue;
        }

        throw new Error(`Unexpected argument "${token}".`);
    }

    if (!identifier) {
        throw new Error("Missing template identifier. Usage: mtrgen use <vendor/name> [key=value ...]");
    }

    parseTemplateIdentifier(identifier);
    return {
        identifier,
        outDir,
        dataPath,
        argAssignments,
        dryRun,
    };
}

function parseLoginCommand(argv: string[]): LoginCommandOptions | { help: true } {
    let username: string | undefined;
    let password: string | undefined;
    let duration = 24;

    for (let index = 0; index < argv.length; index++) {
        const token = argv[index] ?? "";
        if (!token) continue;
        if (token === "-h" || token === "--help") return { help: true };

        const durationValue = readInlineOptionValue(token, "--duration");
        if (token === "-d" || token === "--duration" || durationValue !== undefined) {
            const rawDuration = token === "-d" || token === "--duration"
                ? requireOptionValue(argv, ++index, token)
                : durationValue;
            duration = Number(rawDuration);
            if (!Number.isInteger(duration) || duration < 0) {
                throw new Error(`Invalid duration "${rawDuration}". Use a non-negative integer.`);
            }
            continue;
        }

        if (token.startsWith("-")) {
            throw new Error(`Unknown option "${token}".`);
        }

        if (!username) {
            username = token;
            continue;
        }

        if (!password) {
            password = token;
            continue;
        }

        throw new Error(`Unexpected argument "${token}".`);
    }

    if (!username || !password) {
        throw new Error("Missing credentials. Usage: mtrgen login <username> <password>");
    }

    return {
        username,
        password,
        duration,
    };
}

function parseSignupCommand(argv: string[]): SignupCommandOptions | { help: true } {
    let username: string | undefined;
    let password: string | undefined;

    for (const token of argv) {
        if (!token) continue;
        if (token === "-h" || token === "--help") return { help: true };
        if (token.startsWith("-")) throw new Error(`Unknown option "${token}".`);

        if (!username) {
            username = token;
            continue;
        }

        if (!password) {
            password = token;
            continue;
        }

        throw new Error(`Unexpected argument "${token}".`);
    }

    if (!username || !password) {
        throw new Error("Missing credentials. Usage: mtrgen signup <username> <password>");
    }

    return {
        username,
        password,
    };
}

function parsePublishCommand(argv: string[]): PublishCommandOptions | { help: true } {
    let target: string | undefined;
    let templatePath: string | undefined;

    for (let index = 0; index < argv.length; index++) {
        const token = argv[index] ?? "";
        if (!token) continue;
        if (token === "-h" || token === "--help") return { help: true };

        const pathValue = readInlineOptionValue(token, "--path");
        if (token === "-p" || token === "--path" || pathValue !== undefined) {
            templatePath = token === "-p" || token === "--path"
                ? requireOptionValue(argv, ++index, token)
                : pathValue;
            continue;
        }

        if (token.startsWith("-")) {
            throw new Error(`Unknown option "${token}".`);
        }

        if (templatePath || target) {
            throw new Error(`Unexpected argument "${token}".`);
        }

        target = token;
    }

    if (!templatePath && !target) {
        throw new Error("Missing template name or --path. Usage: mtrgen publish [name]");
    }

    return {
        target,
        templatePath,
    };
}

function readInlineOptionValue(token: string, name: string): string | undefined {
    return token.startsWith(`${name}=`) ? token.slice(name.length + 1) : undefined;
}

function requireOptionValue(argv: string[], index: number, flag: string): string {
    const value = argv[index];
    if (!value) throw new Error(`Missing value for "${flag}".`);
    return value;
}

function isAssignmentToken(token: string): boolean {
    const equalsIndex = token.indexOf("=");
    return equalsIndex > 0;
}

function runGenerateCommand(command: GenerateCommandOptions, options: GeneratorRunOptions): number {
    const cwd = options.cwd ?? process.cwd();
    const store = new TemplateStore({ homeDir: options.storeHomeDir });
    const templatePath = resolveStoredOrLocalTemplatePath(command.target, command.templatePath, cwd, store);
    const templateArgs = buildTemplateArgs(command, cwd);
    const generatedFiles = Generator.parseAnyFile(templatePath, templateArgs);

    emitGeneratedFiles(generatedFiles, {
        stdout: options.stdout,
        cwd,
        outDir: command.outDir,
        dryRun: command.dryRun,
        format: options.format,
    });

    return 0;
}

function runSaveCommand(command: SaveCommandOptions, options: Required<Pick<RunCliOptions, "stdout">> & Pick<RunCliOptions, "cwd" | "storeHomeDir"> & { format: CliFormatter }): number {
    const cwd = options.cwd ?? process.cwd();
    const store = new TemplateStore({ homeDir: options.storeHomeDir });
    const absolutePath = path.resolve(cwd, command.templatePath);
    const savedName = store.save(absolutePath, command.alias);

    options.stdout(
        `${options.format.success("Template")} ${formatQuotedValue(savedName, options.format)} ${options.format.success("added from")} ${options.format.path(absolutePath)}${options.format.success("!")}`,
    );
    return 0;
}

function runSavedCommand(options: Required<Pick<RunCliOptions, "stdout">> & Pick<RunCliOptions, "storeHomeDir"> & { format: CliFormatter }): number {
    const store = new TemplateStore({ homeDir: options.storeHomeDir });
    const names = store.listNames();

    if (names.length === 0) {
        options.stdout(options.format.warning("No saved templates."));
        return 0;
    }

    options.stdout(options.format.label("Saved templates:"));
    for (const name of names) {
        options.stdout(`${options.format.info("-")} ${options.format.value(name)}`);
    }

    return 0;
}

function runRemoveCommand(command: RemoveCommandOptions, options: Required<Pick<RunCliOptions, "stdout">> & Pick<RunCliOptions, "storeHomeDir"> & { format: CliFormatter }): number {
    const store = new TemplateStore({ homeDir: options.storeHomeDir });
    if (!store.remove(command.name)) {
        throw new Error(`Couldn't find template with name "${command.name}".`);
    }

    options.stdout(`${options.format.success("Template")} ${formatQuotedValue(command.name, options.format)} ${options.format.success("removed!")}`);
    return 0;
}

function runRepairCommand(options: Required<Pick<RunCliOptions, "stdout">> & Pick<RunCliOptions, "storeHomeDir"> & { format: CliFormatter }): number {
    const store = new TemplateStore({ homeDir: options.storeHomeDir });
    const removed = store.repair();

    if (removed.length === 0) {
        options.stdout(options.format.success("Local store repaired. No stale templates were found."));
        return 0;
    }

    options.stdout(
        `${options.format.success("Local store repaired.")} ${options.format.info("Removed")} ${options.format.value(String(removed.length))} ${options.format.info(`stale template${removed.length === 1 ? "" : "s"}.`)}`,
    );
    return 0;
}

async function runAddCommand(command: AddCommandOptions, options: RegistryRunOptions): Promise<number> {
    const registry = new RegistryClient({
        apiUrl: options.apiUrl,
        fetchImplementation: options.fetchImplementation,
    });
    const store = new TemplateStore({ homeDir: options.storeHomeDir });
    const template = await registry.getTemplate(command.identifier);

    store.saveRemote(command.identifier, template.fileName, template.contents);
    options.stdout(
        `${options.format.success("Template")} ${formatQuotedValue(command.identifier, options.format)} ${options.format.success("was added to the local store!")}`,
    );
    return 0;
}

async function runUseCommand(command: UseCommandOptions, options: RegistryRunOptions): Promise<number> {
    const cwd = options.cwd ?? process.cwd();
    const registry = new RegistryClient({
        apiUrl: options.apiUrl,
        fetchImplementation: options.fetchImplementation,
    });
    const template = await registry.getTemplate(command.identifier);
    const templateArgs = buildTemplateArgs(command, cwd);
    const generatedFile = Generator.parseTemplate(template.contents, templateArgs);

    emitGeneratedFiles([generatedFile], {
        stdout: options.stdout,
        cwd,
        outDir: command.outDir,
        dryRun: command.dryRun,
        format: options.format,
    });

    return 0;
}

async function runLoginCommand(command: LoginCommandOptions, options: RegistryRunOptions): Promise<number> {
    const registry = new RegistryClient({
        apiUrl: options.apiUrl,
        fetchImplementation: options.fetchImplementation,
    });
    const response = await registry.login(command.username, command.password, command.duration);

    if (response.status !== "success" || !response.token) {
        throw new Error(response.message ?? "Something went wrong. Try again.");
    }

    const profile = new CliProfile({ homeDir: options.storeHomeDir });
    profile.save(command.username, response.token);

    options.stdout(`${options.format.success("Logged in as")} ${options.format.value(command.username)}${options.format.success(".")}`);
    return 0;
}

async function runSignupCommand(command: SignupCommandOptions, options: RegistryRunOptions): Promise<number> {
    const registry = new RegistryClient({
        apiUrl: options.apiUrl,
        fetchImplementation: options.fetchImplementation,
    });
    await registry.signup(command.username, command.password);

    options.stdout(
        `${options.format.success("User")} ${options.format.value(command.username)} ${options.format.success("created. You may now login.")}`,
    );
    return 0;
}

async function runPublishCommand(command: PublishCommandOptions, options: RegistryRunOptions): Promise<number> {
    const cwd = options.cwd ?? process.cwd();
    const profile = new CliProfile({ homeDir: options.storeHomeDir });
    const session = profile.load();

    if (!session.username || !session.token) {
        throw new Error("You must login first.");
    }

    const store = new TemplateStore({ homeDir: options.storeHomeDir });
    const templatePath = resolveStoredOrLocalTemplatePath(command.target, command.templatePath, cwd, store);
    const contents = readFileSync(templatePath, "utf8");
    const header = Generator.getTemplateHeader(contents);
    const registry = new RegistryClient({
        apiUrl: options.apiUrl,
        fetchImplementation: options.fetchImplementation,
    });
    const response = await registry.publishTemplate({
        username: session.username,
        token: session.token,
        fileName: path.basename(templatePath),
        templateName: header.name,
        contents,
    });

    if (response.status !== "success") {
        throw new Error(response.message ?? "Publishing failed.");
    }

    options.stdout(
        `${options.format.success("Template")} ${options.format.value(header.name)} ${options.format.success("published as")} ${formatQuotedPath(`${session.username.toLowerCase()}/${header.name.toLowerCase()}`, options.format)}${options.format.success("!")}`,
    );
    return 0;
}

function formatQuotedValue(value: string, format: CliFormatter): string {
    return `'${format.value(value)}'`;
}

function formatQuotedPath(value: string, format: CliFormatter): string {
    return `'${format.path(value)}'`;
}

function resolveStoredOrLocalTemplatePath(
    target: string | undefined,
    templatePath: string | undefined,
    cwd: string,
    store: TemplateStore,
): string {
    if (templatePath) {
        const resolved = path.resolve(cwd, templatePath);
        if (!existsSync(resolved)) {
            throw new Error(`Template file not found: ${resolved}`);
        }
        return resolved;
    }

    if (!target) {
        throw new Error("Missing template name or path.");
    }

    const storedPath = store.getFullPath(target);
    if (storedPath) {
        return storedPath;
    }

    const resolvedPath = path.resolve(cwd, target);
    if (existsSync(resolvedPath)) {
        return resolvedPath;
    }

    throw new Error(`Template "${target}" not found in the local store.`);
}

function emitGeneratedFiles(
    files: ReturnType<typeof Generator.parseAnyFile>,
    options: { stdout: CliWriter; cwd: string; outDir?: string; dryRun: boolean; format: CliFormatter },
): void {
    const rootDir = options.outDir ? path.resolve(options.cwd, options.outDir) : options.cwd;

    if (options.dryRun) {
        for (const file of files) {
            options.stdout(`${options.format.warning("Would generate")} ${options.format.path(path.resolve(rootDir, file.filePath))}`);
        }
        return;
    }

    Generator.writeFiles(files, { rootDir });

    for (const file of files) {
        options.stdout(`${options.format.success("Generated")} ${options.format.path(path.resolve(rootDir, file.filePath))}`);
    }
}

function buildTemplateArgs(command: Pick<GenerateCommandOptions, "dataPath" | "argAssignments">, cwd: string): Record<string, unknown> {
    const data = command.dataPath ? readDataFile(path.resolve(cwd, command.dataPath)) : {};

    for (const assignment of command.argAssignments) {
        const equalsIndex = assignment.indexOf("=");
        if (equalsIndex === -1) {
            throw new Error(`Invalid argument assignment "${assignment}". Use key=value.`);
        }

        const key = assignment.slice(0, equalsIndex).trim();
        if (!key) {
            throw new Error(`Invalid argument assignment "${assignment}". Use key=value.`);
        }

        const rawValue = assignment.slice(equalsIndex + 1);
        setByPath(data, parseKeyPath(key), parseInputValue(rawValue));
    }

    return data;
}

function readDataFile(filePath: string): Record<string, unknown> {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    if (!isRecord(parsed)) {
        throw new Error(`Data file must contain a JSON object: ${filePath}`);
    }

    return parsed;
}

function parseInputValue(rawValue: string): unknown {
    const parsedLiteral = parseTemplateLiteral(rawValue.trim());
    return parsedLiteral === INVALID_TEMPLATE_LITERAL ? rawValue : parsedLiteral;
}

function parseKeyPath(input: string): Array<string | number> {
    const trimmed = input.trim();
    const baseMatch = /^[a-zA-Z0-9_]+/.exec(trimmed);
    if (!baseMatch) {
        throw new Error(`Invalid argument path "${input}".`);
    }

    const segments: Array<string | number> = [baseMatch[0]];
    let index = baseMatch[0].length;

    while (index < trimmed.length) {
        const current = trimmed[index];
        if (current === ".") {
            index++;
            const propMatch = /^[a-zA-Z0-9_]+/.exec(trimmed.slice(index));
            if (!propMatch) {
                throw new Error(`Invalid argument path "${input}".`);
            }

            segments.push(propMatch[0]);
            index += propMatch[0].length;
            continue;
        }

        if (current === "[") {
            const closeIndex = trimmed.indexOf("]", index + 1);
            if (closeIndex === -1) {
                throw new Error(`Invalid argument path "${input}".`);
            }

            const inside = trimmed.slice(index + 1, closeIndex).trim();
            if (/^\d+$/.test(inside)) {
                segments.push(Number(inside));
            } else if (
                (inside.startsWith("'") && inside.endsWith("'")) ||
                (inside.startsWith("\"") && inside.endsWith("\""))
            ) {
                segments.push(inside.slice(1, -1).replace(/\\(['"])/g, "$1"));
            } else if (inside.length > 0) {
                segments.push(inside);
            } else {
                throw new Error(`Invalid argument path "${input}".`);
            }

            index = closeIndex + 1;
            continue;
        }

        throw new Error(`Invalid argument path "${input}".`);
    }

    return segments;
}

function setByPath(target: Record<string, unknown>, segments: Array<string | number>, value: unknown): void {
    let current: Record<string, unknown> | unknown[] = target;

    for (let index = 0; index < segments.length - 1; index++) {
        const segment = segments[index]!;
        const nextSegment = segments[index + 1]!;
        const key = String(segment);
        const existingValue = (current as Record<string, unknown>)[key];

        if (nextSegmentIsContainer(existingValue, nextSegment)) {
            current = existingValue as Record<string, unknown> | unknown[];
            continue;
        }

        const nextValue: Record<string, unknown> | unknown[] = typeof nextSegment === "number" ? [] : {};
        (current as Record<string, unknown>)[key] = nextValue;
        current = nextValue;
    }

    const lastSegment = segments[segments.length - 1]!;
    (current as Record<string, unknown>)[String(lastSegment)] = value;
}

function nextSegmentIsContainer(value: unknown, nextSegment: string | number): boolean {
    if (typeof nextSegment === "number") return Array.isArray(value);
    return isRecord(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
