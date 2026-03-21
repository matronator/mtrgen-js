export type EncodeOptions = "base64" | "hex" | "url" | "json" | "yaml";

type BinaryLike = { from(input: string, encoding?: "base64" | "hex"): { toString(encoding?: "base64" | "hex"): string } };

export class Filters {
    public static GLOBAL_FILTERS = [
        "upper", "lower", "upperFirst", "lowerFirst",
        "first", "last",
        "camelCase", "snakeCase", "kebabCase", "pascalCase", "titleCase",
        "length",
        "reverse", "random", "shuffle",
        "truncate", "trim", "substring",
        "url", "stripTags", "nl2br",
        "escape", "unescape", "hash", "rot13", "encode", "decode",
        "pow", "ceil", "floor", "round",
    ];

    static #textEncoder: TextEncoder | null | undefined;
    static #textDecoder: TextDecoder | null | undefined;

    static has(name: string): boolean {
        return this.GLOBAL_FILTERS.includes(name);
    }

    static #capitalizePreserveRest(word: string): string {
        return word ? word[0].toUpperCase() + word.slice(1) : word;
    }

    static #getBuffer(): BinaryLike | null {
        const buffer = globalThis.Buffer as BinaryLike | undefined;
        return buffer?.from ? buffer : null;
    }

    static #getTextEncoder(): TextEncoder | null {
        if (Filters.#textEncoder !== undefined) return Filters.#textEncoder;
        Filters.#textEncoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
        return Filters.#textEncoder;
    }

    static #getTextDecoder(): TextDecoder | null {
        if (Filters.#textDecoder !== undefined) return Filters.#textDecoder;
        Filters.#textDecoder = typeof TextDecoder !== "undefined" ? new TextDecoder() : null;
        return Filters.#textDecoder;
    }

    static #utf8Encode(input: string): Uint8Array {
        const encoder = Filters.#getTextEncoder();
        if (encoder) return encoder.encode(input);

        const bytes = new Uint8Array(input.length);
        for (let i = 0; i < input.length; i++) {
            bytes[i] = input.charCodeAt(i) & 0xff;
        }
        return bytes;
    }

    static #utf8Decode(input: Uint8Array): string {
        const decoder = Filters.#getTextDecoder();
        if (decoder) return decoder.decode(input);

        return Array.from(input, (byte) => String.fromCharCode(byte)).join("");
    }

    static #bytesToBase64(bytes: Uint8Array): string {
        const buffer = Filters.#getBuffer();
        if (buffer) return buffer.from(Filters.#utf8Decode(bytes)).toString("base64");

        if (typeof btoa === "function") {
            let binary = "";
            for (const byte of bytes) binary += String.fromCharCode(byte);
            return btoa(binary);
        }

        return "";
    }

    static #base64ToBytes(value: string): Uint8Array {
        const buffer = Filters.#getBuffer();
        if (buffer) {
            const decoded = buffer.from(value, "base64").toString();
            return Filters.#utf8Encode(decoded);
        }

        if (typeof atob === "function") {
            const binary = atob(value);
            return Uint8Array.from(binary, (char) => char.charCodeAt(0));
        }

        return new Uint8Array();
    }

    static #bytesToHex(bytes: Uint8Array): string {
        return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    }

    static #hexToBytes(value: string): Uint8Array {
        const normalized = value.trim();
        if (normalized.length % 2 !== 0) return new Uint8Array();

        const bytes = new Uint8Array(normalized.length / 2);
        for (let i = 0; i < normalized.length; i += 2) {
            const byte = Number.parseInt(normalized.slice(i, i + 2), 16);
            if (Number.isNaN(byte)) return new Uint8Array();
            bytes[i / 2] = byte;
        }
        return bytes;
    }

    static #fallbackHash(value: string, algo: string): string {
        let hash = 2166136261;
        const input = `${algo}:${value}`;

        for (let i = 0; i < input.length; i++) {
            hash ^= input.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }

        return (hash >>> 0).toString(16).padStart(8, "0");
    }

    static apply: Record<string, (value: unknown, args: unknown[]) => unknown> = {
        upper: (value) => Filters.upper(value),
        lower: (value) => Filters.lower(value),
        upperFirst: (value) => Filters.upperFirst(value),
        lowerFirst: (value) => Filters.lowerFirst(value),
        first: (value) => Filters.first(Array.isArray(value) ? value : String(value)),
        last: (value) => Filters.last(Array.isArray(value) ? value : String(value)),
        camelCase: (value) => Filters.camelCase(value),
        snakeCase: (value) => Filters.snakeCase(value),
        kebabCase: (value) => Filters.kebabCase(value),
        pascalCase: (value) => Filters.pascalCase(value),
        titleCase: (value) => Filters.titleCase(value),
        length: (value) => Filters.length(Array.isArray(value) ? value : String(value)),
        reverse: (value) => Filters.reverse(Array.isArray(value) ? value : String(value)),
        random: (value) => Filters.random(Array.isArray(value) ? value : String(value)),
        shuffle: (value) => Filters.shuffle(Array.isArray(value) ? value : String(value)),
        truncate: (value, args) => Filters.truncate(value, Number(args[0]), args[1] !== undefined ? String(args[1]) : undefined),
        trim: (value, args) => Filters.trim(value, ["left", "right", "both"].includes(String(args[0])) ? args[0] as "left" | "right" | "both" : "both"),
        substring: (value, args) => Filters.substring(value, Number(args[0]), args[1] !== undefined ? Number(args[1]) : undefined),
        url: (value) => Filters.url(value),
        stripTags: (value) => Filters.stripTags(value),
        nl2br: (value, args) => Filters.nl2br(value, args[0] !== undefined ? Boolean(args[0]) : undefined),
        escape: (value) => Filters.escape(value),
        unescape: (value) => Filters.unescape(value),
        hash: (value, args) => Filters.hash(value, args[0] !== undefined ? String(args[0]) : undefined),
        rot13: (value) => Filters.rot13(value),
        encode: (value, args) => Filters.encode(value, args[0] !== undefined ? String(args[0]) as EncodeOptions : undefined),
        decode: (value, args) => Filters.decode(value, args[0] !== undefined ? String(args[0]) as EncodeOptions : undefined),
        pow: (value, args) => Filters.pow(value, args[0] !== undefined ? Number(args[0]) : undefined),
        ceil: (value) => Filters.ceil(value),
        floor: (value) => Filters.floor(value),
        round: (value) => Filters.round(value),
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

    static first(value: string | unknown[]): unknown {
        return Array.isArray(value) ? value[0] : String(value).charAt(0);
    }

    static last(value: string | unknown[]): unknown {
        return Array.isArray(value) ? value[value.length - 1] : String(value).charAt(String(value).length - 1);
    }

    static camelCase(value: unknown): string {
        return String(value).charAt(0).toLowerCase() + String(value).slice(1);
    }

    static snakeCase(value: unknown): string {
        return String(value).replace(/([A-Z])/g, "_$1").toLowerCase();
    }

    static kebabCase(input: unknown): string {
        return String(input)
            .replace(/[_\s]+/g, "-")
            .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
            .replace(/-+/g, "-")
            .replace(/[^a-zA-Z0-9-]/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "")
            .toLowerCase();
    }

    static pascalCase(input: unknown): string {
        const cleaned = String(input).replace(/\s*\.\s*/g, ".");
        const parts = cleaned.split(/[\s_-]+/g).filter(Boolean);
        return parts.map(Filters.#capitalizePreserveRest).join("");
    }

    static titleCase(input: unknown): string {
        return String(input)
            .replace(/_/g, " ")
            .replace(/[A-Za-z][A-Za-z0-9]*/g, (word) => Filters.#capitalizePreserveRest(word));
    }

    static length(value: string | unknown[]): number {
        return Array.isArray(value) ? value.length : String(value).length;
    }

    static reverse(value: string | unknown[]): string | unknown[] {
        return Array.isArray(value) ? value.slice().reverse() : value.split("").reverse().join("");
    }

    static random<T>(value: string | T[]): string | T | undefined {
        if (Array.isArray(value)) return value[Math.floor(Math.random() * value.length)];
        return String(value).charAt(Math.floor(Math.random() * String(value).length));
    }

    static shuffle<T>(value: string | T[]): string | T[] {
        return Array.isArray(value)
            ? value.slice().sort(() => Math.random() - 0.5)
            : String(value).split("").sort(() => Math.random() - 0.5).join("");
    }

    static truncate(value: unknown, limit: number, suffix = "..."): string {
        const text = String(value);
        return text.length > limit ? text.slice(0, limit) + suffix : text;
    }

    static trim(value: unknown, sides: "left" | "right" | "both" = "both"): string {
        if (sides === "left") return String(value).trimStart();
        if (sides === "right") return String(value).trimEnd();
        return String(value).trim();
    }

    static substring(value: unknown, start: number, end?: number): string {
        return String(value).substring(start, end);
    }

    static url(value: unknown): string {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&apos;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/ /g, "-");
    }

    static stripTags(value: unknown): string {
        return String(value).replace(/<[^>]*>/g, "");
    }

    static nl2br(value: unknown, xhtmlSyntax?: boolean): string {
        return String(value)
            .replace(/\r\n/g, xhtmlSyntax ? "<br />" : "<br>")
            .replace(/\n/g, xhtmlSyntax ? "<br />" : "<br>");
    }

    static escape(value: unknown): string {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&apos;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    static unescape(value: unknown): string {
        return String(value)
            .replace(/&amp;/g, "&")
            .replace(/&quot;/g, "\"")
            .replace(/&apos;/g, "'")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">");
    }

    static hash(value: unknown, algo = "md5", secret = ""): string {
        return Filters.#fallbackHash(String(value) + secret, algo);
    }

    static rot13(value: unknown): string {
        return String(value).replace(/[a-zA-Z]/g, (char) => {
            const code = char.charCodeAt(0);
            return String.fromCharCode((code >= 65 && code <= 77) || (code >= 97 && code <= 109) ? code + 13 : code - 13);
        });
    }

    static encode(value: unknown, encoding: EncodeOptions = "base64"): string {
        switch (encoding) {
            case "base64":
                return Filters.#bytesToBase64(Filters.#utf8Encode(String(value)));
            case "hex":
                return Filters.#bytesToHex(Filters.#utf8Encode(String(value)));
            case "url":
                return Filters.url(value);
            default:
                return "Not implemented";
        }
    }

    static decode(value: unknown, encoding: EncodeOptions = "base64"): string {
        switch (encoding) {
            case "base64":
                return Filters.#utf8Decode(Filters.#base64ToBytes(String(value)));
            case "hex":
                return Filters.#utf8Decode(Filters.#hexToBytes(String(value)));
            case "url":
                return Filters.unescape(value);
            default:
                return "Not implemented";
        }
    }

    static pow(value: unknown, exp = 2): number {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue) || !Number.isFinite(exp)) return 0;
        return Math.pow(numericValue, exp);
    }

    static ceil(value: unknown): number {
        const numericValue = Number(value);
        return Number.isFinite(numericValue) ? Math.ceil(numericValue) : 0;
    }

    static floor(value: unknown): number {
        const numericValue = Number(value);
        return Number.isFinite(numericValue) ? Math.floor(numericValue) : 0;
    }

    static round(value: unknown): number {
        const numericValue = Number(value);
        return Number.isFinite(numericValue) ? Math.round(numericValue) : 0;
    }
}
