import { DefaultOptions, ParserOptions } from "./options";
import type { ConditionMatch } from "./matches";
import { Filters } from './filters';
import { DefaultValue } from "@/generator/header";

export const LITERALLY_NULL = "⚠︎__:-␀LITERALLY_NULL␀-:__⚠︎" as const;

export type ParserArgs = Record<string, unknown> | Array<Record<string, unknown>>;

export class Parser {
    public static VARIABLE_PATTERN = /<%\s?((?!endif|else)[a-zA-Z0-9_]+)(=.*?)?(\|([a-zA-Z0-9_]+?)(?:\:(?:(?:\\?\'|\\?")?.?(?:\\?\'|\\?")?,?)+?)*?)?\s?%>/m;

    public static CONDITION_PATTERN = /(?<all><%\s?if\s(?<condition>(?<negation>!?)(?<left>\S+?)(?:\s*(?<operator>(?:<=|<|===|==|>=|>|!==|!=))\s*(?<right>.+?))?)\s?%>\n?)/m;

    public static COMMENT_PATTERN = /<#\s?(.*?)\s?#>/ms;

    static #LITERALLY_NULL = LITERALLY_NULL;

    public static parseString(text: string, args?: ParserArgs, strict?: boolean): string;
    public static parseString(text: string, args?: ParserArgs, options?: ParserOptions): string;
    public static parseString<T>(text: T, args?: ParserArgs, options?: boolean | ParserOptions): T;
    public static parseString(text: unknown, args: ParserArgs = {}, options: boolean | ParserOptions = DefaultOptions): unknown {
        if (typeof text !== "string") return text;

        const normalizedOptions = Parser.#normalizeOptions(options);
        const argsList = Parser.#normalizeArgs(args);

        let parsed = text;
        parsed = Parser.removeComments(parsed, normalizedOptions);
        parsed = Parser.parseConditions(parsed, argsList, 0, normalizedOptions);
        parsed = Parser.parseVariables(parsed, argsList, normalizedOptions);

        return parsed;
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
            const conditionLength = conditionMatch[0].length;
            const conditionStart = Parser.#lineStartIfWhitespaceOnly(parsed, conditionTagStart);
            const insideBlockStart = conditionTagStart + conditionLength;

            const conditionResult = Parser.#getConditionResult(conditionMatch, args);

            let hasElse = false;
            let elseTagStart: number | null = null;
            let elseTagLength: number | null = null;
            let endifTagStart: number | null = null;
            let endifTagLength: number | null = null;

            let nestedOffset = insideBlockStart;
            let nestedIfCount = 0;

            const tagPattern = /<%\s?(if|else|endif)\s?.*?%>\n?/m;
            while (true) {
                const tagMatch = Parser.#execFrom(parsed, tagPattern, nestedOffset);
                if (!tagMatch) break;

                const tag = tagMatch[1] as "if" | "else" | "endif";
                const tagStart = tagMatch.index;

                if (tag === "if") {
                    nestedIfCount++;
                } else if (tag === "endif") {
                    if (nestedIfCount === 0) {
                        endifTagStart = tagStart;
                        endifTagLength = tagMatch[0].length;
                        break;
                    }
                    nestedIfCount--;
                } else if (tag === "else" && nestedIfCount === 0) {
                    hasElse = true;
                    elseTagStart = tagStart;
                    elseTagLength = tagMatch[0].length;
                }

                nestedOffset = tagStart + tagMatch[0].length;
            }

            if (endifTagStart === null || endifTagLength === null) {
                throw new Error("Missing <% endif %> tag.");
            }

            const endifLineStart = Parser.#lineStartIfWhitespaceOnly(parsed, endifTagStart);
            const replaceEnd = endifTagStart + endifTagLength;
            const replaceLength = replaceEnd - conditionStart;

            if (hasElse) {
                if (elseTagStart === null || elseTagLength === null) {
                    throw new Error("Internal error: else tag was not fully captured.");
                }
                const elseLineStart = Parser.#lineStartIfWhitespaceOnly(parsed, elseTagStart);
                const insideBlock = parsed.slice(insideBlockStart, elseLineStart);
                const elseBlock = parsed.slice(elseTagStart + elseTagLength, endifLineStart);
                parsed = Parser.#replaceRange(parsed, conditionStart, replaceLength, conditionResult ? insideBlock : elseBlock);
            } else {
                const insideBlock = parsed.slice(insideBlockStart, endifLineStart);
                parsed = Parser.#replaceRange(parsed, conditionStart, replaceLength, conditionResult ? insideBlock : "");
            }

            offset = conditionStart;
        }

        return parsed;
    }

    public static parseVariables(text: string, args: Array<Record<string, unknown>>, options: ParserOptions = DefaultOptions): string {
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

            if (!inner || inner.startsWith("if ") || inner === "else" || inner.startsWith("else ") || inner === "endif" || inner.startsWith("endif ")) {
                offset = start + length;
                continue;
            }

            const replacement = Parser.#evaluateVariableExpression(inner, args, options);
            parsed = Parser.#replaceRange(parsed, start, length, replacement);
            offset = start + replacement.length;
        }

        return parsed;
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
        if (literal !== Parser.#LITERALLY_NULL) return literal;

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

    static parseLiteral(raw: string): DefaultValue | typeof LITERALLY_NULL {
        const value = raw.trim();
        if (!value) return Parser.#LITERALLY_NULL;

        if (value === "null") return null;
        if (value === "true") return true;
        if (value === "false") return false;

        if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
            const inner = value.slice(1, -1);
            return inner.replace(/\\(['"])/g, "$1");
        }

        const asNumber = Number(value);
        if (Number.isFinite(asNumber) && value !== "") return asNumber;

        return Parser.#LITERALLY_NULL;
    }

    static #normalizeArgs(args: ParserArgs): Array<Record<string, unknown>> {
        if (Array.isArray(args)) return args;
        return [args];
    }

    static #normalizeOptions(options: boolean | ParserOptions): ParserOptions {
        if (typeof options === "boolean") return { ...DefaultOptions, strict: options };

        return {
            ...DefaultOptions,
            ...options,
            patterns: { ...DefaultOptions.patterns, ...(options.patterns ?? {}) },
        };
    }

    static #evaluateVariableExpression(expression: string, args: Array<Record<string, unknown>>, options: ParserOptions): string {
        const [variablePart, ...filterParts] = expression.split("|").map((s) => s.trim()).filter(Boolean);
        if (!variablePart) return "";

        const equalsIndex = variablePart.indexOf("=");
        const variableName = (equalsIndex === -1 ? variablePart : variablePart.slice(0, equalsIndex)).trim();
        if (!variableName) return "";

        const defaultRaw = equalsIndex === -1 ? undefined : variablePart.slice(equalsIndex + 1);
        const hasDefault = defaultRaw !== undefined;

        const resolved = Parser.#resolveToken(variableName, args);
        let value: unknown = resolved;

        if (value === undefined) {
            if (!hasDefault) {
                if (options.strict) throw new Error(`Unknown variable "${variableName}".`);
                value = "";
            } else {
                value = Parser.#parseDefaultValue(defaultRaw ?? "", options);
            }
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

        let i = base.length;
        while (i < trimmed.length) {
            const ch = trimmed[i];
            if (ch === ".") {
                i++;
                const propMatch = /^[a-zA-Z0-9_]+/.exec(trimmed.slice(i));
                if (!propMatch) break;
                segments.push(propMatch[0]);
                i += propMatch[0].length;
                continue;
            }

            if (ch === "[") {
                const close = trimmed.indexOf("]", i + 1);
                if (close === -1) break;
                const inside = trimmed.slice(i + 1, close).trim();
                if (/^\d+$/.test(inside)) {
                    segments.push(Number(inside));
                } else if (
                    (inside.startsWith("'") && inside.endsWith("'")) ||
                    (inside.startsWith('"') && inside.endsWith('"'))
                ) {
                    segments.push(inside.slice(1, -1).replace(/\\(['"])/g, "$1"));
                } else if (inside.length > 0) {
                    segments.push(inside);
                } else {
                    break;
                }
                i = close + 1;
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
        if (parsed !== Parser.#LITERALLY_NULL) return parsed;

        if (options.strict) throw new Error(`Invalid default value "${raw}".`);
        return trimmed;
    }

    static #applyFilter(filterExpression: string, value: unknown, options: ParserOptions): unknown {
        const trimmed = filterExpression.trim();
        if (!trimmed) return value;

        const [nameRaw, argRaw] = trimmed.split(":");
        const name = nameRaw.trim();
        const args = argRaw === undefined ? [] : Parser.#parseFilterArgs(argRaw);

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
        const tokens: string[] = [];
        let current = "";
        let inSingle = false;
        let inDouble = false;
        let escaping = false;

        for (const ch of raw) {
            if (escaping) {
                current += ch;
                escaping = false;
                continue;
            }
            if (ch === "\\") {
                escaping = true;
                current += ch;
                continue;
            }
            if (ch === "'" && !inDouble) {
                inSingle = !inSingle;
                current += ch;
                continue;
            }
            if (ch === '"' && !inSingle) {
                inDouble = !inDouble;
                current += ch;
                continue;
            }
            if (ch === "," && !inSingle && !inDouble) {
                tokens.push(current.trim());
                current = "";
                continue;
            }
            current += ch;
        }

        if (current.trim() !== "" || raw.endsWith(",")) tokens.push(current.trim());

        return tokens.map((t) => {
            const parsed = Parser.parseLiteral(t);
            if (parsed !== Parser.#LITERALLY_NULL) return parsed;

            const maybeStr = t.trim();
            if ((maybeStr.startsWith("'") && maybeStr.endsWith("'")) || (maybeStr.startsWith('"') && maybeStr.endsWith('"'))) {
                return maybeStr.slice(1, -1).replace(/\\(['"])/g, "$1");
            }

            return maybeStr;
        });
    }

    static #toString(value: unknown): string {
        if (value === null || value === undefined) return "";
        if (typeof value === "boolean") return value ? "true" : "false";
        return String(value);
    }
}
