import crypto from 'crypto';

export type EncodeOptions = 'base64' | 'hex' | 'url' | 'json' | 'yaml';

export class Filters {
    public static GLOBAL_FILTERS = [
        'upper', 'lower', 'upperFirst', 'lowerFirst',
        'first', 'last',
        'camelCase', 'snakeCase', 'kebabCase', 'pascalCase', 'titleCase',
        'length',
        'reverse', 'random', 'shuffle',
        'truncate', 'trim', 'substring',
        'url', 'stripTags', 'nl2br',
        'escape', 'unescape', 'hash', 'rot13', 'encode', 'decode',
        'pow', 'ceil', 'floor', 'round',
    ];

    static has(name: string): boolean {
        return this.GLOBAL_FILTERS.includes(name);
    }

    static #capitalizePreserveRest(word: string): string {
        if (!word) return word;
        return word[0].toUpperCase() + word.slice(1);
    }

    static apply: Record<string, (value: unknown, args: unknown[]) => unknown> = {
        upper: (v) => Filters.upper(String(v)),
        lower: (v) => Filters.lower(String(v)),
        upperFirst: (v) => Filters.upperFirst(String(v)),
        lowerFirst: (v) => Filters.lowerFirst(String(v)),
        first: (v) => Filters.first(Array.isArray(v) ? v : String(v)),
        last: (v) => Filters.last(Array.isArray(v) ? v : String(v)),
        camelCase: (v) => Filters.camelCase(String(v)),
        snakeCase: (v) => Filters.snakeCase(String(v)),
        kebabCase: (v) => Filters.kebabCase(String(v)),
        pascalCase: (v) => Filters.pascalCase(String(v)),
        titleCase: (v) => Filters.titleCase(String(v)),
        length: (v) => Filters.length(Array.isArray(v) ? v : String(v)),
        reverse: (v) => Filters.reverse(Array.isArray(v) ? v : String(v)),
        random: (v) => Filters.random(Array.isArray(v) ? v : String(v)),
        shuffle: (v) => Filters.shuffle(Array.isArray(v) ? v : String(v)),
        truncate: (v, args) => Filters.truncate(String(v), Number(args[0]), args[1] !== undefined ? String(args[1]) : undefined),
        trim: (v, args) => Filters.trim(String(v), ['left', 'right', 'both'].includes(String(args[0])) ? args[0] as 'left' | 'right' | 'both' : 'both'),
        substring: (v, args) => Filters.substring(String(v), Number(args[0]), args[1] !== undefined ? Number(args[1]) : undefined),
        url: (v) => Filters.url(String(v)),
        stripTags: (v) => Filters.stripTags(String(v)),
        nl2br: (v, args) => Filters.nl2br(String(v), args[0] !== undefined ? Boolean(args[0]) : undefined),
        escape: (v) => Filters.escape(String(v)),
        unescape: (v) => Filters.unescape(String(v)),
        hash: (v, args) => Filters.hash(String(v), args[0] !== undefined ? String(args[0]) : undefined),
        rot13: (v) => Filters.rot13(String(v)),
        encode: (v, args) => Filters.encode(String(v), args[0] !== undefined ? String(args[0]) as EncodeOptions : undefined),
        decode: (v, args) => Filters.decode(String(v), args[0] !== undefined ? String(args[0]) as EncodeOptions : undefined),
        pow: (v, args) => Filters.pow(Number(v), args[0] !== undefined ? Number(args[0]) : undefined),
        ceil: (v) => Filters.ceil(Number(v)),
        floor: (v) => Filters.floor(Number(v)),
        round: (v) => Filters.round(Number(v)),
    };

    static upper(value: unknown): string {
        return String(value).toUpperCase();
    }

    static lower(value: unknown): string {
        return String(value).toLowerCase();
    }

    static upperFirst(value: unknown): string {
        return String(value).charAt(0).toUpperCase() + String(value).slice(1);
    }

    static lowerFirst(value: unknown): string {
        return String(value).charAt(0).toLowerCase() + String(value).slice(1);
    }

    static first(value: string|unknown[]): unknown {
        return Array.isArray(value) ? value[0] : String(value).charAt(0);
    }

    static last(value: string|unknown[]): unknown {
        return Array.isArray(value) ? value[value.length - 1] : String(value).charAt(String(value).length - 1);
    }

    static camelCase(value: unknown): string {
        return String(value).charAt(0).toLowerCase() + String(value).slice(1);
    }

    static snakeCase(value: unknown): string {
        return String(value).replace(/([A-Z])/g, "_$1").toLowerCase();
    }

    static kebabCase(input: unknown): string {
        const normalized = String(input)
            .replace(/[_\s]+/g, "-")
            .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
            .replace(/-+/g, "-")
            .replace(/[^a-zA-Z0-9-]/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "");
        return normalized.toLowerCase();
    }

    static pascalCase(input: unknown): string {
        // Collapse separators (space, underscore, hyphen) and capitalize word starts.
        // Preserve punctuation like '.' but remove surrounding whitespace.
        const cleaned = String(input).replace(/\s*\.\s*/g, ".");
        const parts = cleaned.split(/[\s_-]+/g).filter(Boolean);
        return parts.map(Filters.#capitalizePreserveRest).join("");
    }

    static titleCase(input: unknown): string {
        // Convert underscores to spaces, keep hyphens, and capitalize word starts.
        const normalized = String(input).replace(/_/g, " ");
        return normalized.replace(/[A-Za-z][A-Za-z0-9]*/g, (word) => Filters.#capitalizePreserveRest(word));
    }

    static length(value: string|unknown[]): number {
        return Array.isArray(value) ? value.length : String(value).length;
    }

    static reverse(value: string|unknown[]): string|unknown[] {
        return Array.isArray(value) ? value.slice().reverse() : value.split("").reverse().join("");
    }

    static random<T>(value: string|T): string|T {
        return Array.isArray(value) ? value[Math.floor(Math.random() * value.length)] : String(value).charAt(Math.floor(Math.random() * String(value).length));
    }

    static shuffle<T>(value: string|T[]): string|T[] {
        return Array.isArray(value) ? value.sort(() => Math.random() - 0.5) : String(value).split("").sort(() => Math.random() - 0.5).join("");
    }

    static truncate(value: unknown, limit: number, suffix = "..."): string {
        return String(value).length > limit ? String(value).slice(0, limit) + suffix : String(value);
    }

    static trim(value: unknown, sides: "left" | "right" | "both" = 'both'): string {
        if (sides === "left") return String(value).trimStart();
        if (sides === "right") return String(value).trimEnd();
        return String(value).trim();
    }

    static substring(value: unknown, start: number, end?: number): string {
        return String(value).substring(start, end);
    }

    static url(value: unknown): string {
        return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&apos;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/ /g, "-");
    }

    static stripTags(value: unknown): string {
        return String(value).replace(/<[^>]*>/g, "");
    }

    static nl2br(value: unknown, xhtmlSyntax?: boolean): string {
        return String(value).replace(/\r\n/g, xhtmlSyntax ? "<br />" : "<br>").replace(/\n/g, xhtmlSyntax ? "<br />" : "<br>");
    }

    static escape(value: unknown): string {
        return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&apos;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    static unescape(value: unknown): string {
        return String(value).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    }

    static hash(value: unknown, algo: string = 'md5', secret?: string): string {
        const hash = crypto.createHash(algo);
        hash.update(String(value) + secret);
        return hash.digest('hex');
    }

    static rot13(value: unknown): string {
        return String(value).replace(/[a-zA-Z]/g, (char) => {
            const code = char.charCodeAt(0);
            return String.fromCharCode((code >= 65 && code <= 77) || (code >= 97 && code <= 109) ? code + 13 : code - 13);
        });
    }

    static encode(value: unknown, encoding: EncodeOptions = 'base64'): string {
        switch (encoding) {
            case 'base64':
                return Buffer.from(String(value)).toString('base64');
            case 'hex':
                return Buffer.from(String(value)).toString('hex');
            case 'url':
                return Filters.url(value);
            default:
                return 'Not implemented';
        }
    }

    static decode(value: unknown, encoding: EncodeOptions = 'base64'): string {
        switch (encoding) {
            case 'base64':
                return Buffer.from(String(value), 'base64').toString();
            case 'hex':
                return Buffer.from(String(value), 'hex').toString();
            case 'url':
                return Filters.unescape(value);
            default:
                return 'Not implemented';
        }
    }

    static pow(value: unknown, exp: number = 2): number {
        if (!Number.isFinite(value) || !Number.isFinite(exp)) return 0;
        return Math.pow(Number(value), exp);
    }

    static ceil(value: unknown): number {
        if (!Number.isFinite(value)) return 0;
        return Math.ceil(Number(value));
    }

    static floor(value: unknown): number {
        if (!Number.isFinite(value)) return 0;
        return Math.floor(Number(value));
    }

    static round(value: unknown): number {
        if (!Number.isFinite(value)) return 0;
        return Math.round(Number(value));
    }
}
