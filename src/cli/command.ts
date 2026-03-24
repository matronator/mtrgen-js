import { readFileSync } from "node:fs";
import path from "node:path";
import packageJson from "../../package.json";
import { Generator } from "../generator/generator";
import { INVALID_TEMPLATE_LITERAL, parseTemplateLiteral } from "../template/literal";

type CliWriter = (message: string) => void;

export interface RunCliOptions {
    cwd?: string;
    stdout?: CliWriter;
    stderr?: CliWriter;
}

type GenerateCommandOptions = {
    templatePath: string;
    outDir?: string;
    dataPath?: string;
    argAssignments: string[];
    dryRun: boolean;
};

const VERSION = typeof packageJson.version === "string" ? packageJson.version : "0.0.0";

const GLOBAL_HELP = `mtrgen <command>

Commands:
  generate <template-path>  Generate files from an MTRGEN template

Options:
  -h, --help                Show help
  -v, --version             Show version

Examples:
  mtrgen generate ./templates/component.ts.mtr --arg name=Button
  mtrgen generate ./templates/component.ts.mtr --data ./component.json --out-dir ./src
`;

const GENERATE_HELP = `mtrgen generate <template-path>

Options:
  -o, --out-dir <dir>       Output root directory (default: current working directory)
  -d, --data <file>         JSON file with template arguments
  -a, --arg <key=value>     Template argument, repeatable
      --dry-run             Print the files that would be generated
  -h, --help                Show help

Examples:
  mtrgen generate ./templates/component.ts.mtr --arg name=Button --arg folder=components
  mtrgen generate ./templates/component.ts.mtr --data ./component.json --out-dir ./src
`;

export async function runCli(argv: string[], options: RunCliOptions = {}): Promise<number> {
    const stdout = options.stdout ?? console.log;
    const stderr = options.stderr ?? console.error;

    try {
        const command = argv[0];

        if (!command || command === "-h" || command === "--help" || command === "help") {
            stdout(GLOBAL_HELP);
            return 0;
        }

        if (command === "-v" || command === "--version" || command === "version") {
            stdout(VERSION);
            return 0;
        }

        if (command === "generate") {
            const parsed = parseGenerateCommand(argv.slice(1));
            if ("help" in parsed) {
                stdout(GENERATE_HELP);
                return 0;
            }

            return runGenerateCommand(parsed, {
                cwd: options.cwd,
                stdout,
            });
        }

        throw new Error(`Unknown command "${command}".`);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        stderr(`Error: ${message}`);
        stderr("");
        stderr(GLOBAL_HELP);
        return 1;
    }
}

function parseGenerateCommand(argv: string[]): GenerateCommandOptions | { help: true } {
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

        if (templatePath) {
            throw new Error(`Unexpected argument "${token}".`);
        }

        templatePath = token;
    }

    if (!templatePath) {
        throw new Error("Missing template path. Usage: mtrgen generate <template-path>");
    }

    return {
        templatePath,
        outDir,
        dataPath,
        argAssignments,
        dryRun,
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

function runGenerateCommand(command: GenerateCommandOptions, options: Required<Pick<RunCliOptions, "stdout">> & { cwd?: string }): number {
    const cwd = options.cwd ?? process.cwd();
    const templateArgs = buildTemplateArgs(command, cwd);
    const generatedFiles = Generator.parseAnyFile(path.resolve(cwd, command.templatePath), templateArgs);

    if (command.dryRun) {
        for (const file of generatedFiles) {
            const destination = path.resolve(command.outDir ? path.resolve(cwd, command.outDir) : cwd, file.filePath);
            options.stdout(`Would generate ${destination}`);
        }
        return 0;
    }

    Generator.writeFiles(generatedFiles, {
        rootDir: command.outDir ? path.resolve(cwd, command.outDir) : cwd,
    });

    for (const file of generatedFiles) {
        const destination = path.resolve(command.outDir ? path.resolve(cwd, command.outDir) : cwd, file.filePath);
        options.stdout(`Generated ${destination}`);
    }

    return 0;
}

function buildTemplateArgs(command: GenerateCommandOptions, cwd: string): Record<string, unknown> {
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
