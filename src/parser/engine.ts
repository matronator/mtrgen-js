import { DefaultOptions, PatternOptions, ParserOptions } from "./options";
import { Parser } from "./parser";
import type { TemplateDefaults } from "../template/header";

export class Engine {
    private strict = true;
    private trimBeforeBlocks = false;
    private trimAfterBlocks = false;
    private patterns: PatternOptions = {};
    private templateDefaults: TemplateDefaults = {};

    constructor(options: ParserOptions = DefaultOptions) {
        this.options = options;
    }

    public get options(): ParserOptions {
        return {
            strict: this.strict,
            patterns: this.patterns,
            trimBeforeBlocks: this.trimBeforeBlocks,
            trimAfterBlocks: this.trimAfterBlocks,
            templateDefaults: this.templateDefaults,
        };
    }
    public set options(options: ParserOptions) {
        this.strict = options.strict ?? true;
        this.patterns = options.patterns ?? {};
        this.trimBeforeBlocks = options.trimBeforeBlocks ?? false;
        this.trimAfterBlocks = options.trimAfterBlocks ?? false;
        this.templateDefaults = options.templateDefaults ?? {};
    }

    public parse(text: string, args: Array<Record<string, unknown>> = []): string {
        return Parser.parseString(text, args, this.options);
    }
}
