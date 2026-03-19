import { DefaultOptions, PatternOptions, ParserOptions } from "./options";
import { Parser } from "./parser";

export class Engine {
    private strict = true;
    private trimBeforeBlocks = false;
    private trimAfterBlocks = false;
    private patterns: PatternOptions = {};

    constructor(options: ParserOptions = DefaultOptions) {
        this.options = options;
    }

    public get options(): ParserOptions {
        return {
            strict: this.strict,
            patterns: this.patterns,
            trimBeforeBlocks: this.trimBeforeBlocks,
            trimAfterBlocks: this.trimAfterBlocks,
        };
    }
    public set options(options: ParserOptions) {
        this.strict = options.strict;
        this.patterns = options.patterns;
        this.trimBeforeBlocks = options.trimBeforeBlocks ?? false;
        this.trimAfterBlocks = options.trimAfterBlocks ?? false;
    }

    public parse(text: string, args: Array<Record<string, unknown>> = []): string {
        return Parser.parseString(text, args, this.options);
    }
}
