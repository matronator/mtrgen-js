export type TemplateLiteralValue =
    | string
    | boolean
    | number
    | null
    | TemplateLiteralValue[]
    | { [key: string]: TemplateLiteralValue };

export const INVALID_TEMPLATE_LITERAL = Symbol("INVALID_TEMPLATE_LITERAL");

class LiteralParser {
    #index = 0;

    constructor(private readonly input: string) {}

    parse(): TemplateLiteralValue | typeof INVALID_TEMPLATE_LITERAL {
        this.#skipWhitespace();
        const value = this.#parseValue();
        if (value === INVALID_TEMPLATE_LITERAL) return value;

        this.#skipWhitespace();
        return this.#index === this.input.length ? value : INVALID_TEMPLATE_LITERAL;
    }

    #parseValue(): TemplateLiteralValue | typeof INVALID_TEMPLATE_LITERAL {
        this.#skipWhitespace();

        const current = this.input[this.#index];
        if (current === undefined) return INVALID_TEMPLATE_LITERAL;
        if (current === "'" || current === "\"") return this.#parseString(current);
        if (current === "[") return this.#parseArray();
        if (current === "{") return this.#parseObject();

        if (this.#consumeKeyword("true")) return true;
        if (this.#consumeKeyword("false")) return false;
        if (this.#consumeKeyword("null")) return null;

        const numberValue = this.#parseNumber();
        if (numberValue !== INVALID_TEMPLATE_LITERAL) return numberValue;

        return INVALID_TEMPLATE_LITERAL;
    }

    #parseString(quote: "'" | "\""): string | typeof INVALID_TEMPLATE_LITERAL {
        this.#index++;
        let result = "";

        while (this.#index < this.input.length) {
            const current = this.input[this.#index++];
            if (current === quote) return result;
            if (current !== "\\") {
                result += current;
                continue;
            }

            const escaped = this.input[this.#index++];
            if (escaped === undefined) return INVALID_TEMPLATE_LITERAL;

            switch (escaped) {
                case "n":
                    result += "\n";
                    break;
                case "r":
                    result += "\r";
                    break;
                case "t":
                    result += "\t";
                    break;
                case "\\":
                    result += "\\";
                    break;
                case "'":
                    result += "'";
                    break;
                case "\"":
                    result += "\"";
                    break;
                default:
                    result += escaped;
                    break;
            }
        }

        return INVALID_TEMPLATE_LITERAL;
    }

    #parseArray(): TemplateLiteralValue[] | typeof INVALID_TEMPLATE_LITERAL {
        this.#index++;
        const result: TemplateLiteralValue[] = [];

        while (true) {
            this.#skipWhitespace();
            if (this.input[this.#index] === "]") {
                this.#index++;
                return result;
            }

            const value = this.#parseValue();
            if (value === INVALID_TEMPLATE_LITERAL) return INVALID_TEMPLATE_LITERAL;
            result.push(value);

            this.#skipWhitespace();
            const current = this.input[this.#index];
            if (current === ",") {
                this.#index++;
                continue;
            }
            if (current === "]") {
                this.#index++;
                return result;
            }

            return INVALID_TEMPLATE_LITERAL;
        }
    }

    #parseObject(): { [key: string]: TemplateLiteralValue } | typeof INVALID_TEMPLATE_LITERAL {
        this.#index++;
        const result: Record<string, TemplateLiteralValue> = {};

        while (true) {
            this.#skipWhitespace();
            if (this.input[this.#index] === "}") {
                this.#index++;
                return result;
            }

            const key = this.#parseObjectKey();
            if (key === INVALID_TEMPLATE_LITERAL) return INVALID_TEMPLATE_LITERAL;

            this.#skipWhitespace();
            if (this.input[this.#index] !== ":") return INVALID_TEMPLATE_LITERAL;
            this.#index++;

            const value = this.#parseValue();
            if (value === INVALID_TEMPLATE_LITERAL) return INVALID_TEMPLATE_LITERAL;
            result[key] = value;

            this.#skipWhitespace();
            const current = this.input[this.#index];
            if (current === ",") {
                this.#index++;
                continue;
            }
            if (current === "}") {
                this.#index++;
                return result;
            }

            return INVALID_TEMPLATE_LITERAL;
        }
    }

    #parseObjectKey(): string | typeof INVALID_TEMPLATE_LITERAL {
        const current = this.input[this.#index];
        if (current === "'" || current === "\"") return this.#parseString(current);

        const match = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(this.input.slice(this.#index));
        if (!match) return INVALID_TEMPLATE_LITERAL;

        this.#index += match[0].length;
        return match[0];
    }

    #parseNumber(): number | typeof INVALID_TEMPLATE_LITERAL {
        const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(this.input.slice(this.#index));
        if (!match) return INVALID_TEMPLATE_LITERAL;

        const next = this.input[this.#index + match[0].length];
        if (next !== undefined && /[a-zA-Z0-9_]/.test(next)) return INVALID_TEMPLATE_LITERAL;

        const value = Number(match[0]);
        if (!Number.isFinite(value)) return INVALID_TEMPLATE_LITERAL;

        this.#index += match[0].length;
        return value;
    }

    #consumeKeyword(keyword: "true" | "false" | "null"): boolean {
        if (!this.input.startsWith(keyword, this.#index)) return false;

        const next = this.input[this.#index + keyword.length];
        if (next !== undefined && /[a-zA-Z0-9_]/.test(next)) return false;

        this.#index += keyword.length;
        return true;
    }

    #skipWhitespace(): void {
        while (this.#index < this.input.length && /\s/.test(this.input[this.#index]!)) {
            this.#index++;
        }
    }
}

export function parseTemplateLiteral(raw: string): TemplateLiteralValue | typeof INVALID_TEMPLATE_LITERAL {
    return new LiteralParser(raw.trim()).parse();
}
