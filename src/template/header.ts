import { INVALID_TEMPLATE_LITERAL, parseTemplateLiteral, type TemplateLiteralValue } from "./literal";

export const HEADER_PATTERN = /^--- MTRGEN ---([\s\S]*?)--- \/MTRGEN ---\s*/m;
export const HEADER_BLOCK_REMOVE_RE = /^--- MTRGEN ---[\s\S]*?--- \/MTRGEN ---\s*/m;

const HEADER_LINE_TRIM_RE = /^[ \\/\t\r\n\x00\x0B]+|[ \\/\t\r\n\x00\x0B]+$/g;
const REQUIRED_HEADER_FIELDS = ["name", "filename", "path"] as const;

type RequiredHeaderField = (typeof REQUIRED_HEADER_FIELDS)[number];

export type DefaultValue = TemplateLiteralValue;
export type TemplateDefaults = Record<string, DefaultValue>;
export type TemplateSyntaxVersion = 1 | 2;

export interface TemplateHeader {
    name: string;
    filename: string;
    path: string;
    syntax?: TemplateSyntaxVersion;
    defaults?: TemplateDefaults;
}

export class TemplateHeaders {
    static has(input: string): boolean {
        return HEADER_PATTERN.test(input);
    }

    static parse(input: string): TemplateHeader {
        const headerBlock = TemplateHeaders.#extractHeaderBlock(input);
        const { fields, syntax, defaults } = TemplateHeaders.#parseHeaderBlock(headerBlock);

        const missing = REQUIRED_HEADER_FIELDS.filter((field) => !fields[field]);
        if (missing.length > 0) {
            throw new Error(`Template header is missing required properties: ${missing.join(", ")}.`);
        }

        return {
            name: fields.name!,
            filename: fields.filename!,
            path: fields.path!,
            ...(syntax !== undefined ? { syntax } : {}),
            ...(defaults ? { defaults } : {}),
        };
    }

    static strip(input: string): string {
        return input.replace(HEADER_BLOCK_REMOVE_RE, "");
    }

    static getDefaults(input: string): TemplateDefaults {
        return TemplateHeaders.parse(input).defaults ?? {};
    }

    static #extractHeaderBlock(input: string): string {
        const header = input.match(HEADER_PATTERN)?.[1];
        if (!header) throw new Error("Template header was not found.");
        return header;
    }

    static #parseHeaderBlock(headerBlock: string): {
        fields: Partial<Record<RequiredHeaderField, string>>;
        syntax?: TemplateSyntaxVersion;
        defaults?: TemplateDefaults;
    } {
        const rawLines = headerBlock.split(/\r?\n/);
        const fields: Partial<Record<RequiredHeaderField, string>> = {};
        let syntax: TemplateSyntaxVersion | undefined;
        let defaultsLineIndex: number | null = null;

        for (let i = 0; i < rawLines.length; i++) {
            const line = TemplateHeaders.#trimHeaderLine(rawLines[i] ?? "");
            if (!line) continue;

            const kv = TemplateHeaders.#parseKeyValue(line);
            if (!kv) continue;

            if (kv.key === "defaults") {
                defaultsLineIndex = i;
                break;
            }

            if (kv.key === "syntax") {
                syntax = TemplateHeaders.#parseSyntaxVersion(kv.value);
                continue;
            }

            if (TemplateHeaders.#isRequiredHeaderField(kv.key)) {
                fields[kv.key] = kv.value;
            }
        }

        const defaults = defaultsLineIndex === null
            ? undefined
            : TemplateHeaders.#parseDefaults(rawLines, defaultsLineIndex);

        return { fields, ...(syntax !== undefined ? { syntax } : {}), ...(defaults ? { defaults } : {}) };
    }

    static #parseSyntaxVersion(raw: string): TemplateSyntaxVersion {
        if (raw === "1" || raw === "2") return Number(raw) as TemplateSyntaxVersion;
        throw new Error(`Invalid template syntax version "${raw}".`);
    }

    static #parseDefaults(rawLines: string[], defaultsLineIndex: number): TemplateDefaults | undefined {
        const entries: Array<[string, DefaultValue]> = [];

        for (let i = defaultsLineIndex + 1; i < rawLines.length; i++) {
            const trimmed = (rawLines[i] ?? "").trim();
            if (!trimmed) continue;

            const kv = TemplateHeaders.#parseKeyValue(trimmed);
            if (!kv?.key) continue;

            let value = kv.value;
            while (TemplateHeaders.#needsContinuation(value) && i + 1 < rawLines.length) {
                i++;
                const continuation = (rawLines[i] ?? "").trim();
                if (!continuation) continue;
                value += `\n${continuation}`;
            }

            const parsed = parseTemplateLiteral(value);
            entries.push([kv.key, parsed === INVALID_TEMPLATE_LITERAL ? value : parsed]);
        }

        return entries.length > 0 ? Object.fromEntries(entries) : undefined;
    }

    static #needsContinuation(value: string): boolean {
        let bracketDepth = 0;
        let braceDepth = 0;
        let inSingle = false;
        let inDouble = false;
        let escaping = false;

        for (const char of value) {
            if (escaping) {
                escaping = false;
                continue;
            }

            if (char === "\\") {
                escaping = true;
                continue;
            }

            if (char === "'" && !inDouble) {
                inSingle = !inSingle;
                continue;
            }

            if (char === "\"" && !inSingle) {
                inDouble = !inDouble;
                continue;
            }

            if (inSingle || inDouble) continue;
            if (char === "[") bracketDepth++;
            if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1);
            if (char === "{") braceDepth++;
            if (char === "}") braceDepth = Math.max(0, braceDepth - 1);
        }

        return inSingle || inDouble || bracketDepth > 0 || braceDepth > 0;
    }

    static #parseKeyValue(line: string): { key: string; value: string } | null {
        const index = line.indexOf(":");
        if (index === -1) return null;

        const key = line.slice(0, index).trim();
        const value = line.slice(index + 1).trim();
        return key ? { key, value } : null;
    }

    static #trimHeaderLine(line: string): string {
        return line.replace(HEADER_LINE_TRIM_RE, "");
    }

    static #isRequiredHeaderField(key: string): key is RequiredHeaderField {
        return (REQUIRED_HEADER_FIELDS as readonly string[]).includes(key);
    }
}
