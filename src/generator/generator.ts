import { DefaultValue, HEADER_PATTERN, TemplateDefaults, TemplateHeader } from "./header";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { LITERALLY_NULL,
Parser } from "../parser/parser";

const HEADER_LINE_TRIM_RE = /^[ \\/\t\r\n\x00\x0B]+|[ \\/\t\r\n\x00\x0B]+$/g;
const REQUIRED_HEADER_FIELDS = ["name", "filename", "path"] as const;
type RequiredHeaderField = (typeof REQUIRED_HEADER_FIELDS)[number];
const HEADER_BLOCK_REMOVE_RE = /^--- MTRGEN ---[\s\S]*?--- \/MTRGEN ---\s*/m;

export interface GeneratedFile {
    filePath: string;
    contents: string;
}

export class Generator {
    static getTemplateHeader(input: string): TemplateHeader {
        const headerBlock = Generator.#extractHeaderBlock(input);
        const { fields, defaults } = Generator.#parseHeaderBlock(headerBlock);

        const missing = REQUIRED_HEADER_FIELDS.filter((field) => !fields[field]);
        if (missing.length > 0) {
            throw new Error(`Template header is missing required properties: ${missing.join(", ")}.`);
        }

        return {
            name: fields.name!,
            filename: fields.filename!,
            path: fields.path!,
            ...(defaults ? { defaults } : {}),
        };
    }

    static getDefaultArguments(input: string): TemplateDefaults {
        return Generator.getTemplateHeader(input).defaults ?? {};
    }

    static parseAnyFile(templatePath: string, args: Record<string, unknown> = {}): GeneratedFile[] {
        const template = readFileSync(templatePath, "utf8");
        return [Generator.parseTemplate(template, args)];
    }

    static parseTemplate(template: string, args: Record<string, unknown> = {}): GeneratedFile {
        const header = Generator.getTemplateHeader(template);
        const bodyTemplate = Generator.#stripHeader(template);

        const requiredVariables = new Set<string>([
            ...Generator.#collectVariablesWithoutInlineDefaults(header.filename),
            ...Generator.#collectVariablesWithoutInlineDefaults(header.path),
            ...Generator.#collectVariablesWithoutInlineDefaults(bodyTemplate),
        ]);

        const effectiveArgs: Record<string, unknown> = { ...args };
        for (const [key, value] of Object.entries(header.defaults ?? {})) {
            if (!(key in effectiveArgs) && requiredVariables.has(key)) {
                effectiveArgs[key] = value;
            }
        }

        const parsedFilename = Parser.parseString(header.filename, effectiveArgs);
        const parsedPath = Parser.parseString(header.path, effectiveArgs);
        const contents = Parser.parseString(bodyTemplate, effectiveArgs);

        return {
            filePath: path.posix.join(parsedPath, parsedFilename),
            contents,
        };
    }

    static writeFiles(files: GeneratedFile[], options: { rootDir?: string } = {}): void {
        const rootDir = options.rootDir ?? process.cwd();

        for (const file of files) {
            const absolutePath = path.resolve(rootDir, file.filePath);
            mkdirSync(path.dirname(absolutePath), { recursive: true });
            writeFileSync(absolutePath, file.contents, "utf8");
        }
    }

    static #extractHeaderBlock(input: string): string {
        // First capture group contains the block content between the markers.
        const match = input.match(HEADER_PATTERN);
        const header = match?.[1];
        if (!header) throw new Error("Template header was not found.");
        return header;
    }

    static #parseHeaderBlock(headerBlock: string): {
        fields: Partial<Record<RequiredHeaderField, string>>;
        defaults?: TemplateDefaults;
    } {
        const rawLines = headerBlock.split(/\r?\n/);
        const fields: Partial<Record<RequiredHeaderField, string>> = {};

        let defaultsLineIndex: number | null = null;
        for (let i = 0; i < rawLines.length; i++) {
            const line = Generator.#trimHeaderLine(rawLines[i] ?? "");
            if (!line) continue;

            const kv = Generator.#parseKeyValue(line);
            if (!kv) continue;

            if (kv.key === "defaults") {
                defaultsLineIndex = i;
                break;
            }

            if (Generator.#isRequiredHeaderField(kv.key)) {
                fields[kv.key] = kv.value;
            }
        }

        const defaults = defaultsLineIndex === null
            ? undefined
            : Generator.#parseDefaults(rawLines, defaultsLineIndex);

        return { fields, ...(defaults ? { defaults } : {}) };
    }

    static #parseDefaults(rawLines: string[], defaultsLineIndex: number): TemplateDefaults | undefined {
        // PHP legacy behavior took `array_slice($lines, 5)`; keep compatibility by not starting before line 5. NOPE 4
        const start = Math.max(defaultsLineIndex + 1, 4);
        const entries: Array<[string, DefaultValue]> = [];

        for (const raw of rawLines.slice(start)) {
            const trimmed = raw.trim();
            if (!trimmed) continue;
            const kv = Generator.#parseKeyValue(trimmed);
            if (!kv) continue;
            if (!kv.key) continue;
            let value = Parser.parseLiteral(kv.value);
            if (value === LITERALLY_NULL) value = null;
            entries.push([kv.key, value]);
        }

        if (entries.length === 0) return undefined;
        return Object.fromEntries(entries);
    }

    static #trimHeaderLine(line: string): string {
        // Equivalent to PHP: trim($line, " /\t\n\r\0\x0B\\");
        return line.replace(HEADER_LINE_TRIM_RE, "");
    }

    static #stripHeader(template: string): string {
        return template.replace(HEADER_BLOCK_REMOVE_RE, "");
    }

    static #collectVariablesWithoutInlineDefaults(template: string): string[] {
        const variables = new Set<string>();
        const re = /<%\s*([\s\S]*?)\s*%>/g;

        for (const match of template.matchAll(re)) {
            const inner = (match[1] ?? "").trim();
            if (!inner) continue;
            if (inner.startsWith("if ") || inner === "else" || inner.startsWith("else ") || inner === "endif" || inner.startsWith("endif ")) {
                continue;
            }

            const [variablePart] = inner.split("|", 1);
            if (!variablePart) continue;

            const namePart = variablePart.includes("=") ? variablePart.slice(0, variablePart.indexOf("=")).trim() : variablePart.trim();
            if (!namePart || variablePart.includes("=")) continue;

            const baseMatch = /^[a-zA-Z0-9_]+/.exec(namePart);
            if (!baseMatch) continue;
            variables.add(baseMatch[0]);
        }

        return Array.from(variables);
    }

    static #parseKeyValue(line: string): { key: string; value: string } | null {
        const idx = line.indexOf(":");
        if (idx === -1) return null;

        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        return key ? { key, value } : null;
    }

    static #isRequiredHeaderField(key: string): key is RequiredHeaderField {
        return (REQUIRED_HEADER_FIELDS as readonly string[]).includes(key);
    }
}
