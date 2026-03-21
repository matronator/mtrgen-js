import type { TemplateDefaults } from "../template/header";

export interface ParserOptions {
    strict?: boolean;
    patterns?: PatternOptions;
    trimBeforeBlocks?: boolean;
    trimAfterBlocks?: boolean;
    templateDefaults?: TemplateDefaults;
}

export interface PatternOptions {
    variables?: RegExp;
    conditions?: RegExp;
    comments?: RegExp;
}

export const DefaultOptions: ParserOptions = {
    strict: true,
    patterns: {},
    templateDefaults: {},
};
