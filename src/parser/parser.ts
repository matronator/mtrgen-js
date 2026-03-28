import { DefaultOptions, ParserOptions } from "./options";
import { Filters } from "./filters";
import { TemplateHeaders, type DefaultValue, type TemplateDefaults, type TemplateHeader, type TemplateSyntaxVersion } from "../template/header";
import { INVALID_TEMPLATE_LITERAL, parseTemplateLiteral } from "../template/literal";

export const LITERALLY_NULL = Symbol("LITERALLY_NULL");

export type ParserArgs = Record<string, unknown> | Array<Record<string, unknown>>;

type LoopBlockName = "first" | "last" | "sep" | "empty";
type LegacyLoopBlockKeyword = `!${LoopBlockName}` | `/${LoopBlockName}`;
type ModernLoopBlockKeyword = LoopBlockName | `end${LoopBlockName}`;
type LoopBlockOpenKeyword = `!${LoopBlockName}` | LoopBlockName;
type LoopBlockCloseKeyword = `/${LoopBlockName}` | `end${LoopBlockName}`;
type LoopBlockKeyword = LegacyLoopBlockKeyword | ModernLoopBlockKeyword;
type ControlKeyword = "if" | "elseif" | "else" | "endif" | "for" | "endfor" | LoopBlockKeyword;
type NestedBlock = "if" | "for" | LoopBlockName;

type ConditionBranch = {
    condition: string | null;
    content: string;
};

type TagInfo = {
    raw: string;
    inner: string;
    keyword: ControlKeyword | null;
    start: number;
    end: number;
    controlStart: number;
    controlEnd: number;
};

type LoopBindings = {
    item?: string;
    key?: string;
};

type LoopContext = {
    index: number;
    length: number;
    isFirst: boolean;
    isLast: boolean;
};

type ExpressionToken =
    | { type: "identifier"; value: string }
    | { type: "string"; value: string }
    | { type: "number"; value: string }
    | { type: "operator"; value: "===" | "!==" | "==" | "!=" | "<=" | ">=" | "&&" | "||" | "<" | ">" | "!" }
    | { type: "dot"; value: "." }
    | { type: "comma"; value: "," }
    | { type: "paren"; value: "(" | ")" }
    | { type: "bracket"; value: "[" | "]" };

type ExpressionState = {
    tokens: ExpressionToken[];
    index: number;
    args: Array<Record<string, unknown>>;
    syntaxVersion: TemplateSyntaxVersion;
};

type OperatorTokenValue = Extract<ExpressionToken, { type: "operator" }>["value"];

export class Parser {
    public static VARIABLE_PATTERN = /<%\s?((?!endif|else)[a-zA-Z0-9_]+)(=.*?)?(\|([a-zA-Z0-9_]+?)(?:\:(?:(?:\\?\'|\\?")?.?(?:\\?\'|\\?")?,?)+?)*?)?\s?%>/m;

    public static CONDITION_PATTERN = /(?<all><%\s*if\s+(?<condition>(?<negation>!?)(?<left>\S+?)(?:\s*(?<operator>(?:<=|<|===|==|>=|>|!==|!=))\s*(?<right>.+?))?)\s*%>\n?)/m;

    public static COMMENT_PATTERN = /<#\s?(.*?)\s?#>/ms;

    static #TAG_PATTERN = /<%\s*([\s\S]*?)\s*%>/m;
    static #CONTROL_KEYWORDS = new Set<ControlKeyword>([
        "if",
        "elseif",
        "else",
        "endif",
        "for",
        "endfor",
        "!first",
        "!last",
        "!sep",
        "!empty",
        "/first",
        "/last",
        "/sep",
        "/empty",
        "first",
        "last",
        "sep",
        "empty",
        "endfirst",
        "endlast",
        "endsep",
        "endempty",
    ]);

    public static parseString(text: string, args?: ParserArgs, strict?: boolean): string;
    public static parseString(text: string, args?: ParserArgs, options?: ParserOptions): string;
    public static parseString<T>(text: T, args?: ParserArgs, options?: boolean | ParserOptions): T;
    public static parseString(text: unknown, args: ParserArgs = {}, options?: boolean | ParserOptions): unknown {
        if (typeof text !== "string") return text;

        const explicitSyntaxVersion = options && typeof options !== "boolean" ? options.syntaxVersion : undefined;
        const normalizedOptions = Parser.#normalizeOptions(options ?? DefaultOptions);
        const argsList = Parser.#normalizeArgs(args);
        const header = TemplateHeaders.has(text) ? TemplateHeaders.parse(text) : undefined;
        const resolvedOptions = {
            ...normalizedOptions,
            syntaxVersion: explicitSyntaxVersion ?? header?.syntax ?? DefaultOptions.syntaxVersion ?? 2,
        };
        const templateDefaults = {
            ...(resolvedOptions.templateDefaults ?? {}),
            ...(header?.defaults ?? {}),
        };

        const stripped = header ? TemplateHeaders.strip(text) : text;
        const uncommented = Parser.removeComments(stripped, resolvedOptions);
        return Parser.#renderTemplate(uncommented, argsList, templateDefaults, resolvedOptions);
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
        const standaloneCommentLine = /^[\t ]*<#([\s\S]*?)#>[\t ]*(?:\r?\n(?:[\t ]*\r?\n)?)?/gm;
        const withoutStandaloneLines = text.replace(standaloneCommentLine, "");

        const flagsSet = new Set(pattern.flags.split(""));
        flagsSet.add("g");
        const re = new RegExp(pattern.source, Array.from(flagsSet).join(""));
        return withoutStandaloneLines.replace(re, "");
    }

    public static parseConditions(text: string, args: Array<Record<string, unknown>>, offset: number = 0, options: ParserOptions = DefaultOptions): string {
        let parsed = text;

        while (true) {
            const tag = Parser.#nextTag(parsed, offset, options);
            if (!tag) break;
            if (tag.keyword !== "if") {
                offset = tag.end;
                continue;
            }

            const block = Parser.#findIfBlock(parsed, tag, options);
            const replacement = Parser.#renderConditionBranches(block.branches, args, options);
            parsed = Parser.#replaceRange(parsed, tag.controlStart, block.afterEnd - tag.controlStart, replacement);
            offset = tag.controlStart + replacement.length;
        }

        return parsed;
    }

    public static parseVariables(
        text: string,
        args: Array<Record<string, unknown>>,
        templateDefaults: TemplateDefaults = {},
        options: ParserOptions = DefaultOptions,
    ): string {
        let parsed = text;
        let offset = 0;

        while (true) {
            const tag = Parser.#nextTag(parsed, offset, options);
            if (!tag) break;

            if (tag.keyword && Parser.#CONTROL_KEYWORDS.has(tag.keyword)) {
                offset = tag.end;
                continue;
            }

            const replacement = Parser.#evaluateVariableExpression(tag.inner, args, templateDefaults, options);
            parsed = Parser.#replaceRange(parsed, tag.start, tag.end - tag.start, replacement);
            offset = tag.start + replacement.length;
        }

        return parsed;
    }

    static parseLiteral(raw: string): DefaultValue | typeof LITERALLY_NULL {
        const parsed = parseTemplateLiteral(raw.trim());
        return parsed === INVALID_TEMPLATE_LITERAL ? LITERALLY_NULL : parsed;
    }

    static #renderTemplate(
        text: string,
        args: Array<Record<string, unknown>>,
        templateDefaults: TemplateDefaults,
        options: ParserOptions,
        loopContext?: LoopContext,
    ): string {
        let parsed = text;
        let offset = 0;
        const expressionArgs = [ ...args, templateDefaults ];

        while (true) {
            const tag = Parser.#nextTag(parsed, offset, options);
            if (!tag) break;

            if (tag.keyword === "if") {
                const block = Parser.#findIfBlock(parsed, tag, options);
                const branch = block.branches.find((candidate) =>
                    candidate.condition === null || Parser.#evaluateCondition(candidate.condition, expressionArgs, options.syntaxVersion ?? 2),
                );
                const replacement = branch
                    ? Parser.#renderTemplate(branch.content, args, templateDefaults, options, loopContext)
                    : "";

                parsed = Parser.#replaceRange(parsed, tag.controlStart, block.afterEnd - tag.controlStart, replacement);
                offset = tag.controlStart + replacement.length;
                continue;
            }

            if (tag.keyword === "for") {
                const block = Parser.#findForBlock(parsed, tag, options);
                const replacement = Parser.#renderForBlock(tag.inner, block.content, expressionArgs, templateDefaults, options);
                parsed = Parser.#replaceRange(parsed, tag.controlStart, block.afterEnd - tag.controlStart, replacement);
                offset = tag.controlStart + replacement.length;
                continue;
            }

            if (tag.keyword && Parser.#isLoopBlockOpenKeyword(tag.keyword)) {
                if (!loopContext) {
                    throw new Error(`Unexpected <% ${tag.keyword} %> tag outside <% for %> block.`);
                }

                const block = Parser.#findLoopBlock(parsed, tag, options);
                const replacement = Parser.#shouldRenderLoopBlock(tag.keyword, loopContext)
                    ? Parser.#renderTemplate(block.content, args, templateDefaults, options, loopContext)
                    : "";

                parsed = Parser.#replaceRange(parsed, tag.controlStart, block.afterEnd - tag.controlStart, replacement);
                offset = tag.controlStart + replacement.length;
                continue;
            }

            if (tag.keyword && Parser.#isLoopBlockCloseKeyword(tag.keyword)) {
                throw new Error(`Unexpected <% ${tag.keyword} %> tag.`);
            }

            if (tag.keyword && Parser.#CONTROL_KEYWORDS.has(tag.keyword)) {
                offset = tag.end;
                continue;
            }

            const replacement = Parser.#evaluateVariableExpression(tag.inner, args, templateDefaults, options);
            parsed = Parser.#replaceRange(parsed, tag.start, tag.end - tag.start, replacement);
            offset = tag.start + replacement.length;
        }

        return parsed;
    }

    static #renderConditionBranches(
        branches: ConditionBranch[],
        args: Array<Record<string, unknown>>,
        options: ParserOptions,
    ): string {
        const branch = branches.find((candidate) =>
            candidate.condition === null || Parser.#evaluateCondition(candidate.condition, args, options.syntaxVersion ?? 2),
        );
        if (!branch) return "";
        return Parser.parseConditions(branch.content, args, 0, options);
    }

    static #renderForBlock(
        rawTag: string,
        content: string,
        args: Array<Record<string, unknown>>,
        templateDefaults: TemplateDefaults,
        options: ParserOptions,
    ): string {
        const statement = rawTag.replace(/^for\b/, "").trim();
        const separator = Parser.#findForSeparator(statement);
        if (separator === -1) {
            throw new Error(`Invalid <% for %> tag: ${rawTag}`);
        }

        const bindings = Parser.#parseLoopBindings(statement.slice(0, separator), options.syntaxVersion ?? 2);
        const iterableExpression = statement.slice(separator + 4).trim();
        if (!iterableExpression) {
            throw new Error(`Invalid <% for %> tag: ${rawTag}`);
        }

        const iterable = Parser.#evaluateExpression(iterableExpression, args, options.syntaxVersion ?? 2);
        if (Array.isArray(iterable) || (iterable && typeof iterable === "object")) {
            const iterations = Array.isArray(iterable)
                ? iterable.map((item, index) => ({ item, key: index }))
                : Object.entries(iterable).map(([key, item]) => ({ item, key }));

            if (iterations.length === 0) {
                return Parser.#renderEmptyLoopBlocks(content, args, templateDefaults, options);
            }

            return iterations.map(({ item, key }, index) => {
                const scope = Parser.#createLoopScope(bindings, item, key);
                const loopContext: LoopContext = {
                    index,
                    length: iterations.length,
                    isFirst: index === 0,
                    isLast: index === iterations.length - 1,
                };

                return Parser.#renderTemplate(content, [scope, ...args], templateDefaults, options, loopContext);
            }).join("");
        }

        return "";
    }

    static #renderEmptyLoopBlocks(
        text: string,
        args: Array<Record<string, unknown>>,
        templateDefaults: TemplateDefaults,
        options: ParserOptions,
    ): string {
        let parsed = "";
        let offset = 0;

        while (true) {
            const tag = Parser.#nextTag(text, offset, options);
            if (!tag) break;

            if (tag.keyword === "if") {
                const block = Parser.#findIfBlock(text, tag, options);
                const branch = block.branches.find((candidate) =>
                    candidate.condition === null || Parser.#evaluateCondition(candidate.condition, [...args, templateDefaults], options.syntaxVersion ?? 2),
                );
                if (branch) {
                    parsed += Parser.#renderEmptyLoopBlocks(branch.content, args, templateDefaults, options);
                }
                offset = block.afterEnd;
                continue;
            }

            if (tag.keyword === "for") {
                const block = Parser.#findForBlock(text, tag, options);
                offset = block.afterEnd;
                continue;
            }

            if (tag.keyword && Parser.#isLoopBlockOpenKeyword(tag.keyword)) {
                const block = Parser.#findLoopBlock(text, tag, options);
                if (Parser.#getLoopBlockName(tag.keyword) === "empty") {
                    parsed += Parser.#renderTemplate(block.content, args, templateDefaults, options);
                }
                offset = block.afterEnd;
                continue;
            }

            if (tag.keyword && (Parser.#isLoopBlockCloseKeyword(tag.keyword) || Parser.#CONTROL_KEYWORDS.has(tag.keyword))) {
                offset = tag.end;
                continue;
            }

            offset = tag.end;
        }

        return parsed;
    }

    static #createLoopScope(bindings: LoopBindings, item: unknown, key: unknown): Record<string, unknown> {
        const scope: Record<string, unknown> = {};
        if (bindings.item && bindings.item !== "_") scope[bindings.item] = item;
        if (bindings.key && bindings.key !== "_") scope[bindings.key] = key;
        return scope;
    }

    static #findForSeparator(statement: string): number {
        let inSingle = false;
        let inDouble = false;
        let escaping = false;
        let bracketDepth = 0;
        let parenDepth = 0;

        for (let index = 0; index < statement.length; index++) {
            const char = statement[index];

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
            if (char === "(") parenDepth++;
            if (char === ")") parenDepth = Math.max(0, parenDepth - 1);

            if (bracketDepth === 0 && parenDepth === 0 && statement.startsWith(" of ", index)) {
                return index;
            }
        }

        return -1;
    }

    static #parseLoopBindings(raw: string, syntaxVersion: TemplateSyntaxVersion): LoopBindings {
        const trimmed = raw.trim();
        if (!trimmed) throw new Error("Missing loop bindings.");

        if (!trimmed.startsWith("[")) {
            return { item: Parser.#normalizeBindingName(trimmed, syntaxVersion) };
        }

        if (!trimmed.endsWith("]")) {
            throw new Error(`Invalid loop bindings "${raw}".`);
        }

        const parts = Parser.#splitTopLevel(trimmed.slice(1, -1), ",");
        if (parts.length !== 2) {
            throw new Error(`Invalid loop bindings "${raw}".`);
        }

        return {
            item: Parser.#normalizeBindingName(parts[0] ?? "", syntaxVersion),
            key: Parser.#normalizeBindingName(parts[1] ?? "", syntaxVersion),
        };
    }

    static #normalizeBindingName(raw: string, syntaxVersion: TemplateSyntaxVersion): string {
        const trimmed = raw.trim();
        if (syntaxVersion === 2 && trimmed.startsWith("$")) {
            throw new Error(`Loop bindings must be bare identifiers. Use "${trimmed.slice(1)}" instead of "${trimmed}".`);
        }

        const normalized = trimmed.replace(/^\$/, "");
        if (normalized === "_") return normalized;
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized)) {
            throw new Error(`Invalid loop variable "${raw}".`);
        }
        return normalized;
    }

    static #nextTag(text: string, offset: number, options: ParserOptions): TagInfo | null {
        const match = Parser.#execFrom(text, Parser.#TAG_PATTERN, offset);
        if (!match) return null;

        const raw = match[0];
        const inner = (match[1] ?? "").trim();
        const start = match.index;
        const end = start + raw.length;
        const keyword = Parser.#parseTagKeyword(inner, options.syntaxVersion ?? 2);
        const standaloneControlTag = keyword ? Parser.#isStandaloneControlTag(text, start, end) : false;
        const shouldConsumeTrailingLineBreak = keyword ? Parser.#isLineSuffixWhitespaceOnly(text, end) : false;
        const controlStart = standaloneControlTag ? Parser.#lineStartIfWhitespaceOnly(text, start) : start;
        const controlEnd = shouldConsumeTrailingLineBreak ? Parser.#consumeTrailingLineBreak(text, end) : end;

        return {
            raw,
            inner,
            keyword,
            start,
            end,
            controlStart,
            controlEnd,
        };
    }

    static #parseTagKeyword(inner: string, syntaxVersion: TemplateSyntaxVersion): ControlKeyword | null {
        if (syntaxVersion === 2) {
            const modernLoopKeywordMatch = /^(first|last|sep|empty|endfirst|endlast|endsep|endempty)$/.exec(inner);
            if (modernLoopKeywordMatch) {
                return inner as ControlKeyword;
            }
        }

        const legacyLoopKeywordMatch = /^(?:!(first|last|sep|empty)|\/(first|last|sep|empty))$/.exec(inner);
        if (legacyLoopKeywordMatch) {
            return inner as LegacyLoopBlockKeyword;
        }

        const keywordMatch = /^(if|elseif|else|endif|for|endfor)\b/.exec(inner);
        return (keywordMatch?.[1] as ControlKeyword | undefined) ?? null;
    }

    static #consumeTrailingLineBreak(text: string, end: number): number {
        if (text.startsWith("\r\n", end)) return end + 2;
        if (text[end] === "\n") return end + 1;
        return end;
    }

    static #isStandaloneControlTag(text: string, start: number, end: number): boolean {
        const lineStart = text.lastIndexOf("\n", start - 1) + 1;
        const lineEndIndex = text.indexOf("\n", end);
        const lineEnd = lineEndIndex === -1 ? text.length : lineEndIndex;
        const prefix = text.slice(lineStart, start);
        const suffix = text.slice(end, lineEnd);
        return /^[\t ]*$/.test(prefix) && /^[\t ]*$/.test(suffix);
    }

    static #isLineSuffixWhitespaceOnly(text: string, end: number): boolean {
        const lineEndIndex = text.indexOf("\n", end);
        const lineEnd = lineEndIndex === -1 ? text.length : lineEndIndex;
        return /^[\t ]*$/.test(text.slice(end, lineEnd));
    }

    static #findIfBlock(text: string, openTag: TagInfo, options: ParserOptions): { branches: ConditionBranch[]; afterEnd: number } {
        let cursor = openTag.controlEnd;
        let currentCondition: string | null = Parser.#parseConditionTag(openTag.inner, "if");
        let currentContentStart = openTag.controlEnd;
        const branches: ConditionBranch[] = [];
        const nestedBlocks: NestedBlock[] = [];
        let seenElse = false;

        while (true) {
            const tag = Parser.#nextTag(text, cursor, options);
            if (!tag) throw new Error("Missing <% endif %> tag.");

            cursor = tag.end;
            if (!tag.keyword) continue;

            if (Parser.#pushNestedBlock(nestedBlocks, tag.keyword)) {
                continue;
            }

            if (Parser.#isClosingKeyword(tag.keyword)) {
                if (nestedBlocks.length > 0) {
                    if (Parser.#consumeNestedClosingTag(nestedBlocks, tag.keyword)) {
                        continue;
                    }

                    throw new Error(`Unexpected <% ${tag.keyword} %> tag inside <% if %> block.`);
                }

                if (tag.keyword === "endfor") {
                    throw new Error("Unexpected <% endfor %> tag inside <% if %> block.");
                }
                if (Parser.#isLoopBlockCloseKeyword(tag.keyword)) {
                    throw new Error(`Unexpected <% ${tag.keyword} %> tag inside <% if %> block.`);
                }

                branches.push({
                    condition: currentCondition,
                    content: text.slice(currentContentStart, tag.controlStart),
                });

                return { branches, afterEnd: tag.controlEnd };
            }

            if (nestedBlocks.length > 0) continue;

            if (tag.keyword === "else") {
                if (seenElse) throw new Error("Unexpected repeated <% else %> tag.");
                seenElse = true;
            } else if (seenElse) {
                throw new Error("Unexpected <% elseif %> tag after <% else %>.");
            }

            branches.push({
                condition: currentCondition,
                content: text.slice(currentContentStart, tag.controlStart),
            });

            currentCondition = tag.keyword === "elseif" ? Parser.#parseConditionTag(tag.inner, "elseif") : null;
            currentContentStart = tag.controlEnd;
            cursor = tag.controlEnd;
        }
    }

    static #findForBlock(text: string, openTag: TagInfo, options: ParserOptions): { content: string; afterEnd: number } {
        let cursor = openTag.controlEnd;
        const nestedBlocks: NestedBlock[] = [];

        while (true) {
            const tag = Parser.#nextTag(text, cursor, options);
            if (!tag) throw new Error("Missing <% endfor %> tag.");

            cursor = tag.end;
            if (!tag.keyword) continue;

            if (Parser.#pushNestedBlock(nestedBlocks, tag.keyword)) {
                continue;
            }

            if (Parser.#isClosingKeyword(tag.keyword)) {
                if (nestedBlocks.length > 0) {
                    if (Parser.#consumeNestedClosingTag(nestedBlocks, tag.keyword)) {
                        continue;
                    }

                    throw new Error(`Unexpected <% ${tag.keyword} %> tag inside <% for %> block.`);
                }

                if (tag.keyword === "endif") {
                    throw new Error("Unexpected <% endif %> tag inside <% for %> block.");
                }
                if (Parser.#isLoopBlockCloseKeyword(tag.keyword)) {
                    throw new Error(`Unexpected <% ${tag.keyword} %> tag inside <% for %> block.`);
                }

                return {
                    content: text.slice(openTag.controlEnd, tag.controlStart),
                    afterEnd: tag.controlEnd,
                };
            }
        }
    }

    static #findLoopBlock(text: string, openTag: TagInfo, options: ParserOptions): { content: string; afterEnd: number } {
        if (!openTag.keyword || !Parser.#isLoopBlockOpenKeyword(openTag.keyword)) {
            throw new Error(`Invalid loop block tag: ${openTag.raw}`);
        }

        const closingKeyword = Parser.#getLoopBlockClosingKeyword(openTag.keyword);
        let cursor = openTag.controlEnd;
        const nestedBlocks: NestedBlock[] = [];

        while (true) {
            const tag = Parser.#nextTag(text, cursor, options);
            if (!tag) throw new Error(`Missing <% ${closingKeyword} %> tag.`);

            cursor = tag.end;
            if (!tag.keyword) continue;

            if (Parser.#pushNestedBlock(nestedBlocks, tag.keyword)) {
                continue;
            }

            if (Parser.#isClosingKeyword(tag.keyword)) {
                if (nestedBlocks.length > 0) {
                    if (Parser.#consumeNestedClosingTag(nestedBlocks, tag.keyword)) {
                        continue;
                    }

                    throw new Error(`Unexpected <% ${tag.keyword} %> tag inside <% ${openTag.keyword} %> block.`);
                }

                if (tag.keyword === closingKeyword) {
                    return {
                        content: text.slice(openTag.controlEnd, tag.controlStart),
                        afterEnd: tag.controlEnd,
                    };
                }

                throw new Error(`Unexpected <% ${tag.keyword} %> tag inside <% ${openTag.keyword} %> block.`);
            }
        }
    }

    static #pushNestedBlock(nestedBlocks: NestedBlock[], keyword: ControlKeyword): boolean {
        if (keyword === "if" || keyword === "for") {
            nestedBlocks.push(keyword);
            return true;
        }

        if (Parser.#isLoopBlockOpenKeyword(keyword)) {
            nestedBlocks.push(Parser.#getLoopBlockName(keyword));
            return true;
        }

        return false;
    }

    static #consumeNestedClosingTag(nestedBlocks: NestedBlock[], keyword: ControlKeyword): boolean {
        const expected = nestedBlocks[nestedBlocks.length - 1];
        if (!expected) return false;

        if ((keyword === "endif" && expected === "if") || (keyword === "endfor" && expected === "for")) {
            nestedBlocks.pop();
            return true;
        }

        if (
            expected !== "if" &&
            expected !== "for" &&
            Parser.#isLoopBlockCloseKeyword(keyword) &&
            Parser.#getLoopBlockName(keyword) === expected
        ) {
            nestedBlocks.pop();
            return true;
        }

        return false;
    }

    static #isClosingKeyword(keyword: ControlKeyword): keyword is "endif" | "endfor" | LoopBlockCloseKeyword {
        return keyword === "endif" || keyword === "endfor" || Parser.#isLoopBlockCloseKeyword(keyword);
    }

    static #isLoopBlockOpenKeyword(keyword: ControlKeyword): keyword is LoopBlockOpenKeyword {
        return keyword === "!first" || keyword === "!last" || keyword === "!sep" || keyword === "!empty"
            || keyword === "first" || keyword === "last" || keyword === "sep" || keyword === "empty";
    }

    static #isLoopBlockCloseKeyword(keyword: ControlKeyword): keyword is LoopBlockCloseKeyword {
        return keyword === "/first" || keyword === "/last" || keyword === "/sep" || keyword === "/empty"
            || keyword === "endfirst" || keyword === "endlast" || keyword === "endsep" || keyword === "endempty";
    }

    static #getLoopBlockName(keyword: LoopBlockKeyword): LoopBlockName {
        if (keyword.startsWith("!")) return keyword.slice(1) as LoopBlockName;
        if (keyword.startsWith("/")) return keyword.slice(1) as LoopBlockName;
        if (keyword.startsWith("end")) return keyword.slice(3) as LoopBlockName;
        return keyword as LoopBlockName;
    }

    static #getLoopBlockClosingKeyword(keyword: LoopBlockOpenKeyword): LoopBlockCloseKeyword {
        const name = Parser.#getLoopBlockName(keyword);
        if (keyword.startsWith("!")) return `/${name}` as `/${LoopBlockName}`;
        return `end${name}` as `end${LoopBlockName}`;
    }

    static #shouldRenderLoopBlock(keyword: LoopBlockOpenKeyword, loopContext: LoopContext): boolean {
        switch (Parser.#getLoopBlockName(keyword)) {
            case "first":
                return loopContext.isFirst;
            case "last":
                return loopContext.isLast;
            case "sep":
                return !loopContext.isLast;
            case "empty":
                return false;
        }
    }

    static #parseConditionTag(inner: string, keyword: "if" | "elseif"): string {
        const condition = inner.replace(new RegExp(`^${keyword}\\b`), "").trim();
        if (!condition) throw new Error(`Invalid <% ${keyword} %> tag.`);
        return condition;
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

    static #evaluateCondition(expression: string, args: Array<Record<string, unknown>>, syntaxVersion: TemplateSyntaxVersion): boolean {
        return Boolean(Parser.#evaluateExpression(expression, args, syntaxVersion));
    }

    static #evaluateExpression(expression: string, args: Array<Record<string, unknown>>, syntaxVersion: TemplateSyntaxVersion): unknown {
        const tokens = Parser.#tokenizeExpression(expression);
        if (tokens.length === 0) return undefined;

        const state: ExpressionState = { tokens, index: 0, args, syntaxVersion };
        const value = Parser.#parseOrExpression(state);
        if (state.index !== tokens.length) {
            throw new Error(`Invalid expression "${expression}".`);
        }

        return value;
    }

    static #tokenizeExpression(expression: string): ExpressionToken[] {
        const tokens: ExpressionToken[] = [];
        let index = 0;

        while (index < expression.length) {
            const char = expression[index];
            if (/\s/.test(char)) {
                index++;
                continue;
            }

            const slice = expression.slice(index);
            const multiOperator = /^(===|!==|&&|\|\||<=|>=|==|!=)/.exec(slice);
            if (multiOperator) {
                tokens.push({ type: "operator", value: multiOperator[1] as OperatorTokenValue });
                index += multiOperator[1].length;
                continue;
            }

            if (["<", ">", "!"].includes(char)) {
                tokens.push({ type: "operator", value: char as OperatorTokenValue });
                index++;
                continue;
            }

            if (char === ".") {
                tokens.push({ type: "dot", value: "." });
                index++;
                continue;
            }

            if (char === ",") {
                tokens.push({ type: "comma", value: "," });
                index++;
                continue;
            }

            if (char === "(" || char === ")") {
                tokens.push({ type: "paren", value: char });
                index++;
                continue;
            }

            if (char === "[" || char === "]") {
                tokens.push({ type: "bracket", value: char });
                index++;
                continue;
            }

            if (char === "'" || char === "\"") {
                const parsed = Parser.#readStringToken(expression, index, char);
                tokens.push({ type: "string", value: parsed.value });
                index = parsed.nextIndex;
                continue;
            }

            const numberMatch = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(slice);
            if (numberMatch) {
                tokens.push({ type: "number", value: numberMatch[0] });
                index += numberMatch[0].length;
                continue;
            }

            const identifierMatch = /^\$?[A-Za-z_][A-Za-z0-9_]*/.exec(slice);
            if (identifierMatch) {
                tokens.push({ type: "identifier", value: identifierMatch[0] });
                index += identifierMatch[0].length;
                continue;
            }

            throw new Error(`Invalid expression "${expression}".`);
        }

        return tokens;
    }

    static #readStringToken(input: string, start: number, quote: "'" | "\""): { value: string; nextIndex: number } {
        let result = "";
        let index = start + 1;

        while (index < input.length) {
            const current = input[index];
            if (current === quote) {
                return { value: result, nextIndex: index + 1 };
            }

            if (current !== "\\") {
                result += current;
                index++;
                continue;
            }

            const escaped = input[index + 1];
            if (escaped === undefined) break;

            const escapedValue = (() => {
                switch (escaped) {
                    case "n":
                        return "\n";
                    case "r":
                        return "\r";
                    case "t":
                        return "\t";
                    case "\\":
                        return "\\";
                    case "\"":
                        return "\"";
                    case "'":
                        return "'";
                    default:
                        return escaped;
                }
            })();

            result += escapedValue;
            index += 2;
        }

        throw new Error(`Unterminated string literal in expression "${input}".`);
    }

    static #parseOrExpression(state: ExpressionState): unknown {
        let value = Parser.#parseAndExpression(state);

        while (Parser.#matchOperator(state, "||")) {
            const right = Parser.#parseAndExpression(state);
            value = value || right;
        }

        return value;
    }

    static #parseAndExpression(state: ExpressionState): unknown {
        let value = Parser.#parseComparisonExpression(state);

        while (Parser.#matchOperator(state, "&&")) {
            const right = Parser.#parseComparisonExpression(state);
            value = value && right;
        }

        return value;
    }

    static #parseComparisonExpression(state: ExpressionState): unknown {
        let value = Parser.#parseUnaryExpression(state);

        while (true) {
            const operator = Parser.#peekOperator(state, ["===", "!==", "==", "!=", "<=", "<", ">=", ">"]);
            if (!operator) return value;

            state.index++;
            const right = Parser.#parseUnaryExpression(state);

            switch (operator) {
                case "===":
                    value = value === right;
                    break;
                case "!==":
                    value = value !== right;
                    break;
                case "==":
                    value = (value as unknown) == (right as unknown);
                    break;
                case "!=":
                    value = (value as unknown) != (right as unknown);
                    break;
                case "<":
                    value = Parser.#compare(value, right) < 0;
                    break;
                case "<=":
                    value = Parser.#compare(value, right) <= 0;
                    break;
                case ">":
                    value = Parser.#compare(value, right) > 0;
                    break;
                case ">=":
                    value = Parser.#compare(value, right) >= 0;
                    break;
            }
        }
    }

    static #parseUnaryExpression(state: ExpressionState): unknown {
        if (Parser.#matchOperator(state, "!")) {
            return !Boolean(Parser.#parseUnaryExpression(state));
        }

        return Parser.#parsePrimaryExpression(state);
    }

    static #parsePrimaryExpression(state: ExpressionState): unknown {
        const token = state.tokens[state.index];
        if (!token) throw new Error("Unexpected end of expression.");

        if (token.type === "paren" && token.value === "(") {
            state.index++;
            const value = Parser.#parseOrExpression(state);
            Parser.#expectToken(state, "paren", ")");
            return value;
        }

        if (token.type === "string") {
            state.index++;
            return token.value;
        }

        if (token.type === "number") {
            state.index++;
            return Number(token.value);
        }

        if (token.type === "identifier") {
            return Parser.#parseLookupExpression(state);
        }

        throw new Error("Unexpected token in expression.");
    }

    static #parseLookupExpression(state: ExpressionState): unknown {
        const token = state.tokens[state.index];
        if (!token || token.type !== "identifier") {
            throw new Error("Expected identifier.");
        }

        state.index++;
        if (!token.value.startsWith("$")) {
            if (token.value === "true") return true;
            if (token.value === "false") return false;
            if (token.value === "null") return null;
            if (state.syntaxVersion === 2) {
                throw new Error(`Bare variable references are not allowed in syntax v2 expressions. Use "$${token.value}".`);
            }
        }

        const base = token.value.startsWith("$") ? token.value.slice(1) : token.value;
        let current = Parser.#resolveBaseValue(base, state.args);

        while (true) {
            const next = state.tokens[state.index];
            if (!next) break;

            if (next.type === "dot") {
                state.index++;
                const propertyToken = state.tokens[state.index];
                if (!propertyToken || propertyToken.type !== "identifier") {
                    throw new Error("Expected property name after '.'.");
                }

                state.index++;
                current = Parser.#resolveProperty(current, propertyToken.value.startsWith("$") ? propertyToken.value.slice(1) : propertyToken.value);
                continue;
            }

            if (next.type === "bracket" && next.value === "[") {
                state.index++;
                const key = Parser.#parseLookupBracketKey(state);
                Parser.#expectToken(state, "bracket", "]");
                current = Parser.#resolveProperty(current, key);
                continue;
            }

            break;
        }

        return current;
    }

    static #parseLookupBracketKey(state: ExpressionState): unknown {
        const token = state.tokens[state.index];
        const next = state.tokens[state.index + 1];

        if (token?.type === "identifier" && !token.value.startsWith("$") && next?.type === "bracket" && next.value === "]") {
            state.index++;
            return token.value;
        }

        return Parser.#parseOrExpression(state);
    }

    static #peekOperator(
        state: ExpressionState,
        candidates: Array<"===" | "!==" | "==" | "!=" | "<=" | "<" | ">=" | ">" | "&&" | "||" | "!">,
    ): ExpressionToken["value"] | null {
        const token = state.tokens[state.index];
        if (token?.type !== "operator") return null;
        return candidates.includes(token.value) ? token.value : null;
    }

    static #matchOperator(
        state: ExpressionState,
        operator: "===" | "!==" | "==" | "!=" | "<=" | "<" | ">=" | ">" | "&&" | "||" | "!",
    ): boolean {
        if (Parser.#peekOperator(state, [operator]) !== operator) return false;
        state.index++;
        return true;
    }

    static #expectToken(
        state: ExpressionState,
        type: ExpressionToken["type"],
        value?: ExpressionToken["value"],
    ): ExpressionToken {
        const token = state.tokens[state.index];
        if (!token || token.type !== type || (value !== undefined && token.value !== value)) {
            throw new Error("Unexpected token in expression.");
        }

        state.index++;
        return token;
    }

    static #resolveBaseValue(base: string, args: Array<Record<string, unknown>>): unknown {
        for (const candidate of args) {
            if (Object.prototype.hasOwnProperty.call(candidate, base)) {
                return candidate[base];
            }
        }

        return undefined;
    }

    static #resolveProperty(value: unknown, key: unknown): unknown {
        if (value === null || value === undefined) return undefined;
        if (typeof value !== "object" && typeof value !== "function") return undefined;
        return (value as Record<string, unknown>)[String(key)];
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

    static #resolveToken(token: string, args: Array<Record<string, unknown>>, syntaxVersion: TemplateSyntaxVersion): unknown {
        const literal = Parser.parseLiteral(token);
        if (literal !== LITERALLY_NULL) return literal;

        const trimmed = token.trim();
        if (!trimmed) return undefined;
        return Parser.#evaluateExpression(trimmed, args, syntaxVersion);
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
        if ((options.syntaxVersion ?? 2) === 2 && !variableName.startsWith("$")) {
            throw new Error(`Bare variable references are not allowed in syntax v2. Use "$${variableName}" instead of "${variableName}".`);
        }

        const defaultRaw = equalsIndex === -1 ? undefined : variablePart.slice(equalsIndex + 1);
        const hasDefault = defaultRaw !== undefined;

        let value = Parser.#resolveToken(variableName, args, options.syntaxVersion ?? 2);
        if (value === undefined && hasDefault) {
            value = Parser.#parseDefaultValue(defaultRaw ?? "", options);
        }
        if (value === undefined) {
            value = Parser.#resolveToken(variableName, [templateDefaults, ...args], options.syntaxVersion ?? 2);
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

        if (Parser.#isPlainObject(value)) {
            const json = Parser.#safeJsonStringify(value);
            return json ?? String(value);
        }

        return String(value);
    }

    static #safeJsonStringify(value: unknown): string | null {
        try {
            return JSON.stringify(value);
        } catch {
            return null;
        }
    }

    static #isPlainObject(value: unknown): value is Record<string, unknown> {
        if (!value || typeof value !== "object") return false;
        const prototype = Object.getPrototypeOf(value);
        return prototype === Object.prototype || prototype === null;
    }
}
