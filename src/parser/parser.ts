import { DefaultOptions, ParserOptions } from "./options";
import type { ConditionMatch } from "./matches";
import { Filters } from "./filters";
import { TemplateHeaders, type DefaultValue, type TemplateDefaults, type TemplateHeader } from "../template/header";
import { INVALID_TEMPLATE_LITERAL, parseTemplateLiteral } from "../template/literal";

export const LITERALLY_NULL = Symbol("LITERALLY_NULL");

export type ParserArgs = Record<string, unknown> | Array<Record<string, unknown>>;

type ConditionBranch = {
    conditionMatch: RegExpExecArray | null;
    content: string;
};

export class Parser {
    public static VARIABLE_PATTERN = /<%\s?((?!endif|else)[a-zA-Z0-9_]+)(=.*?)?(\|([a-zA-Z0-9_]+?)(?:\:(?:(?:\\?\'|\\?")?.?(?:\\?\'|\\?")?,?)+?)*?)?\s?%>/m;

    public static CONDITION_PATTERN = /(?<all><%\s?if\s(?<condition>(?<negation>!?)(?<left>\S+?)(?:\s*(?<operator>(?:<=|<|===|==|>=|>|!==|!=))\s*(?<right>.+?))?)\s?%>\n?)/m;

    public static COMMENT_PATTERN = /<#\s?(.*?)\s?#>/ms;

    static #CONDITION_BRANCH_PATTERN = /(?<all><%\s?(?<keyword>if|elseif)\s(?<condition>(?<negation>!?)(?<left>\S+?)(?:\s*(?<operator>(?:<=|<|===|==|>=|>|!==|!=))\s*(?<right>.+?))?)\s?%>\n?)/m;
    static #BLOCK_TAG_PATTERN = /<%\s?(elseif|if|else|endif)\b.*?%>\n?/m;

    public static parseString(text: string, args?: ParserArgs, strict?: boolean): string;
    public static parseString(text: string, args?: ParserArgs, options?: ParserOptions): string;
    public static parseString<T>(text: T, args?: ParserArgs, options?: boolean | ParserOptions): T;
    public static parseString(text: unknown, args: ParserArgs = {}, options: boolean | ParserOptions = DefaultOptions): unknown {
        if (typeof text !== "string") return text;

        const normalizedOptions = Parser.#normalizeOptions(options);
        const argsList = Parser.#normalizeArgs(args);
        const header = TemplateHeaders.has(text) ? TemplateHeaders.parse(text) : undefined;
        const templateDefaults = {
            ...(normalizedOptions.templateDefaults ?? {}),
            ...(header?.defaults ?? {}),
        };

        let parsed = header ? TemplateHeaders.strip(text) : text;
        parsed = Parser.removeComments(parsed, normalizedOptions);
        parsed = Parser.parseConditions(parsed, [...argsList, templateDefaults], 0, normalizedOptions);
        parsed = Parser.parseVariables(parsed, argsList, templateDefaults, normalizedOptions);

        return parsed;
    }

    public static getTemplateHeader(input: string): TemplateHeader {
        return TemplateHeaders.parse(input);
    }

    public static getDefaultArguments(input: string): TemplateDefaults {
        return TemplateHeaders.getDefaults(input);
    }

    public static stripTemplateHeader(input: string): string {
        return TemplateHeaders.strip(input);
    }

    public static removeComments(text: string, options: ParserOptions = DefaultOptions): string {
        const pattern = options?.patterns?.comments ?? Parser.COMMENT_PATTERN;
        const flagsSet = new Set(pattern.flags.split(""));
        flagsSet.add("g");
        const re = new RegExp(pattern.source, Array.from(flagsSet).join(""));
        return text.replace(re, "");
    }

    public static parseConditions(text: string, args: Array<Record<string, unknown>>, offset: number = 0, options: ParserOptions = DefaultOptions): string {
        const pattern = options?.patterns?.conditions ?? Parser.CONDITION_PATTERN;
        let parsed = text;

        while (true) {
            const conditionMatch = Parser.#execFrom(parsed, pattern, offset);
            if (!conditionMatch) break;

            const conditionTagStart = conditionMatch.index;
            const conditionStart = Parser.#lineStartIfWhitespaceOnly(parsed, conditionTagStart);
            const insideBlockStart = conditionTagStart + conditionMatch[0].length;

            let endifTagStart: number | null = null;
            let endifTagLength: number | null = null;
            let currentBranchStart = insideBlockStart;
            let currentConditionMatch: RegExpExecArray | null = conditionMatch;
            let nestedOffset = insideBlockStart;
            let nestedIfCount = 0;
            const branches: ConditionBranch[] = [];

            while (true) {
                const tagMatch = Parser.#execFrom(parsed, Parser.#BLOCK_TAG_PATTERN, nestedOffset);
                if (!tagMatch) break;

                const tag = tagMatch[1] as "elseif" | "if" | "else" | "endif";
                const tagStart = tagMatch.index;

                if (tag === "if") {
                    nestedIfCount++;
                    nestedOffset = tagStart + tagMatch[0].length;
                    continue;
                }

                if (tag === "endif") {
                    if (nestedIfCount > 0) {
                        nestedIfCount--;
                        nestedOffset = tagStart + tagMatch[0].length;
                        continue;
                    }

                    endifTagStart = tagStart;
                    endifTagLength = tagMatch[0].length;
                    const branchEnd = Parser.#lineStartIfWhitespaceOnly(parsed, tagStart);
                    branches.push({
                        conditionMatch: currentConditionMatch,
                        content: parsed.slice(currentBranchStart, branchEnd),
                    });
                    break;
                }

                if (nestedIfCount > 0) {
                    nestedOffset = tagStart + tagMatch[0].length;
                    continue;
                }

                const branchEnd = Parser.#lineStartIfWhitespaceOnly(parsed, tagStart);
                branches.push({
                    conditionMatch: currentConditionMatch,
                    content: parsed.slice(currentBranchStart, branchEnd),
                });

                currentConditionMatch = tag === "elseif"
                    ? Parser.#matchConditionBranchTag(tagMatch[0])
                    : null;
                if (tag === "elseif" && !currentConditionMatch) {
                    throw new Error(`Invalid <% elseif %> tag: ${tagMatch[0]}`);
                }

                currentBranchStart = tagStart + tagMatch[0].length;
                nestedOffset = currentBranchStart;
            }

            if (endifTagStart === null || endifTagLength === null) {
                throw new Error("Missing <% endif %> tag.");
            }

            const replaceEnd = endifTagStart + endifTagLength;
            const replaceLength = replaceEnd - conditionStart;
            const replacement = branches.find((branch) =>
                branch.conditionMatch === null || Parser.#getConditionResult(branch.conditionMatch, args),
            )?.content ?? "";

            parsed = Parser.#replaceRange(parsed, conditionStart, replaceLength, replacement);
            offset = conditionStart;
        }

        return parsed;
    }

    public static parseVariables(
        text: string,
        args: Array<Record<string, unknown>>,
        templateDefaults: TemplateDefaults = {},
        options: ParserOptions = DefaultOptions,
    ): string {
        const tagPattern = /<%\s*([\s\S]*?)\s*%>/m;
        let parsed = text;
        let offset = 0;

        while (true) {
            const match = Parser.#execFrom(parsed, tagPattern, offset);
            if (!match) break;

            const full = match[0];
            const inner = (match[1] ?? "").trim();
            const start = match.index;
            const length = full.length;

            if (!inner || inner.startsWith("if ") || inner.startsWith("elseif ") || inner === "else" || inner.startsWith("else ") || inner === "endif" || inner.startsWith("endif ")) {
                offset = start + length;
                continue;
            }

            const replacement = Parser.#evaluateVariableExpression(inner, args, templateDefaults, options);
            parsed = Parser.#replaceRange(parsed, start, length, replacement);
            offset = start + replacement.length;
        }

        return parsed;
    }

    static parseLiteral(raw: string): DefaultValue | typeof LITERALLY_NULL {
        const parsed = parseTemplateLiteral(raw.trim());
        return parsed === INVALID_TEMPLATE_LITERAL ? LITERALLY_NULL : parsed;
    }

    static #replaceRange(text: string, start: number, length: number, replacement: string): string {
        return text.slice(0, start) + replacement + text.slice(start + length);
    }

    static #lineStartIfWhitespaceOnly(text: string, index: number): number {
        const lineStart = text.lastIndexOf("\n", index - 1) + 1;
        const prefix = text.slice(lineStart, index);
        return /^[\t ]*$/.test(prefix) ? lineStart : index;
    }

    static #execFrom(text: string, pattern: RegExp, offset: number): RegExpExecArray | null {
        const flagsSet = new Set(pattern.flags.split(""));
        flagsSet.add("g");
        flagsSet.add("d");
        const flags = Array.from(flagsSet).join("");
        const re = new RegExp(pattern.source, flags);
        re.lastIndex = offset;
        return re.exec(text);
    }

    static #matchConditionBranchTag(tag: string): RegExpExecArray | null {
        return Parser.#CONDITION_BRANCH_PATTERN.exec(tag);
    }

    static #getConditionResult(match: RegExpExecArray, args: Array<Record<string, unknown>>): boolean {
        const groups = (match.groups ?? {}) as ConditionMatch;
        const leftToken = groups.left ?? "";
        const negated = (groups.negation ?? "") === "!";

        const leftValue = Parser.#resolveToken(leftToken, args);
        const operator = groups.operator;
        if (!operator) {
            const truthy = Boolean(leftValue);
            return negated ? !truthy : truthy;
        }

        const rightToken = groups.right ?? "";
        const rightValue = Parser.#resolveToken(rightToken, args);

        let result: boolean;
        switch (operator) {
            case "===":
                result = leftValue === rightValue;
                break;
            case "!==":
                result = leftValue !== rightValue;
                break;
            case "==":
                result = (leftValue as unknown) == (rightValue as unknown);
                break;
            case "!=":
                result = (leftValue as unknown) != (rightValue as unknown);
                break;
            case "<":
                result = Parser.#compare(leftValue, rightValue) < 0;
                break;
            case "<=":
                result = Parser.#compare(leftValue, rightValue) <= 0;
                break;
            case ">":
                result = Parser.#compare(leftValue, rightValue) > 0;
                break;
            case ">=":
                result = Parser.#compare(leftValue, rightValue) >= 0;
                break;
        }

        return negated ? !result : result;
    }

    static #compare(a: unknown, b: unknown): number {
        const aNum = Parser.#toNumberOrNull(a);
        const bNum = Parser.#toNumberOrNull(b);
        if (aNum !== null && bNum !== null) return aNum - bNum;

        const aStr = String(a);
        const bStr = String(b);
        if (aStr === bStr) return 0;
        return aStr < bStr ? -1 : 1;
    }

    static #toNumberOrNull(value: unknown): number | null {
        if (typeof value === "number" && Number.isFinite(value)) return value;
        if (typeof value !== "string") return null;

        const trimmed = value.trim();
        if (!trimmed) return null;

        const asNumber = Number(trimmed);
        return Number.isFinite(asNumber) ? asNumber : null;
    }

    static #resolveToken(token: string, args: Array<Record<string, unknown>>): unknown {
        const literal = Parser.parseLiteral(token);
        if (literal !== LITERALLY_NULL) return literal;

        let keyPath = token.trim();
        if (!keyPath) return undefined;
        if (keyPath.startsWith("$")) keyPath = keyPath.slice(1);

        const { base, segments } = Parser.#splitKeyPath(keyPath);
        if (!base) return undefined;

        let current: unknown = undefined;
        for (const candidate of args) {
            if (Object.prototype.hasOwnProperty.call(candidate, base)) {
                current = candidate[base];
                break;
            }
        }
        if (current === undefined) return undefined;

        for (const segment of segments) {
            if (current === null || current === undefined) return undefined;
            if (typeof current !== "object" && typeof current !== "function") return undefined;
            current = (current as Record<string, unknown>)[String(segment)];
        }

        return current;
    }

    static #normalizeArgs(args: ParserArgs): Array<Record<string, unknown>> {
        return Array.isArray(args) ? args : [args];
    }

    static #normalizeOptions(options: boolean | ParserOptions): ParserOptions {
        if (typeof options === "boolean") return { ...DefaultOptions, strict: options };

        return {
            ...DefaultOptions,
            ...options,
            patterns: { ...DefaultOptions.patterns, ...(options.patterns ?? {}) },
            templateDefaults: {
                ...(DefaultOptions.templateDefaults ?? {}),
                ...(options.templateDefaults ?? {}),
            },
        };
    }

    static #evaluateVariableExpression(
        expression: string,
        args: Array<Record<string, unknown>>,
        templateDefaults: TemplateDefaults,
        options: ParserOptions,
    ): string {
        const [variablePart, ...filterParts] = Parser.#splitTopLevel(expression, "|").filter(Boolean);
        if (!variablePart) return "";

        const equalsIndex = variablePart.indexOf("=");
        const variableName = (equalsIndex === -1 ? variablePart : variablePart.slice(0, equalsIndex)).trim();
        if (!variableName) return "";

        const defaultRaw = equalsIndex === -1 ? undefined : variablePart.slice(equalsIndex + 1);
        const hasDefault = defaultRaw !== undefined;

        let value = Parser.#resolveToken(variableName, args);
        if (value === undefined && hasDefault) {
            value = Parser.#parseDefaultValue(defaultRaw ?? "", options);
        }
        if (value === undefined) {
            value = Parser.#resolveToken(variableName, [templateDefaults]);
        }

        if (value === undefined) {
            if (options.strict) throw new Error(`Unknown variable "${variableName}".`);
            value = "";
        }

        for (const filterExpression of filterParts) {
            value = Parser.#applyFilter(filterExpression, value, options);
        }

        return Parser.#toString(value);
    }

    static #splitKeyPath(input: string): { base: string; segments: Array<string | number> } {
        const trimmed = input.trim();
        const baseMatch = /^[a-zA-Z0-9_]+/.exec(trimmed);
        if (!baseMatch) return { base: "", segments: [] };

        const base = baseMatch[0];
        const segments: Array<string | number> = [];
        let index = base.length;

        while (index < trimmed.length) {
            const current = trimmed[index];
            if (current === ".") {
                index++;
                const propMatch = /^[a-zA-Z0-9_]+/.exec(trimmed.slice(index));
                if (!propMatch) break;
                segments.push(propMatch[0]);
                index += propMatch[0].length;
                continue;
            }

            if (current === "[") {
                const close = trimmed.indexOf("]", index + 1);
                if (close === -1) break;

                const inside = trimmed.slice(index + 1, close).trim();
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
                    break;
                }

                index = close + 1;
                continue;
            }

            break;
        }

        return { base, segments };
    }

    static #parseDefaultValue(raw: string, options: ParserOptions): unknown {
        const trimmed = raw.trim();
        if (trimmed === "") return "";

        const parsed = Parser.parseLiteral(trimmed);
        if (parsed !== LITERALLY_NULL) return parsed;

        if (options.strict) throw new Error(`Invalid default value "${raw}".`);
        return trimmed;
    }

    static #applyFilter(filterExpression: string, value: unknown, options: ParserOptions): unknown {
        const trimmed = filterExpression.trim();
        if (!trimmed) return value;

        const separatorIndex = trimmed.indexOf(":");
        const name = (separatorIndex === -1 ? trimmed : trimmed.slice(0, separatorIndex)).trim();
        const args = separatorIndex === -1 ? [] : Parser.#parseFilterArgs(trimmed.slice(separatorIndex + 1));

        if (!Filters.has(name)) {
            if (options.strict) throw new Error(`Unknown filter "${name}".`);
            return value;
        }

        const filter = Filters.apply[name];
        if (!filter) {
            if (options.strict) throw new Error(`Unknown filter "${name}".`);
            return value;
        }

        return filter(value, args);
    }

    static #parseFilterArgs(raw: string): unknown[] {
        const tokens = Parser.#splitTopLevel(raw, ",");

        return tokens.map((token) => {
            const parsed = Parser.parseLiteral(token);
            if (parsed !== LITERALLY_NULL) return parsed;

            const maybeString = token.trim();
            if (
                (maybeString.startsWith("'") && maybeString.endsWith("'")) ||
                (maybeString.startsWith("\"") && maybeString.endsWith("\""))
            ) {
                return maybeString.slice(1, -1).replace(/\\(['"])/g, "$1");
            }

            return maybeString;
        });
    }

    static #splitTopLevel(raw: string, separator: string): string[] {
        const tokens: string[] = [];
        let current = "";
        let inSingle = false;
        let inDouble = false;
        let escaping = false;
        let bracketDepth = 0;
        let braceDepth = 0;
        let parenDepth = 0;

        for (const char of raw) {
            if (escaping) {
                current += char;
                escaping = false;
                continue;
            }

            if (char === "\\") {
                escaping = true;
                current += char;
                continue;
            }

            if (char === "'" && !inDouble) {
                inSingle = !inSingle;
                current += char;
                continue;
            }

            if (char === "\"" && !inSingle) {
                inDouble = !inDouble;
                current += char;
                continue;
            }

            if (!inSingle && !inDouble) {
                if (char === "[") bracketDepth++;
                if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1);
                if (char === "{") braceDepth++;
                if (char === "}") braceDepth = Math.max(0, braceDepth - 1);
                if (char === "(") parenDepth++;
                if (char === ")") parenDepth = Math.max(0, parenDepth - 1);

                if (char === separator && bracketDepth === 0 && braceDepth === 0 && parenDepth === 0) {
                    tokens.push(current.trim());
                    current = "";
                    continue;
                }
            }

            current += char;
        }

        if (current.trim() !== "" || raw.endsWith(separator)) {
            tokens.push(current.trim());
        }

        return tokens;
    }

    static #toString(value: unknown): string {
        if (value === null || value === undefined) return "";
        if (typeof value === "boolean") return value ? "true" : "false";
        return String(value);
    }
}
