export interface ParserOptions {
    strict: boolean;
    patterns: PatternOptions;
    trimBeforeBlocks?: boolean;
    trimAfterBlocks?: boolean;
}

export interface PatternOptions {
    variables?: RegExp;
    conditions?: RegExp;
    comments?: RegExp;
}

export const DefaultOptions: ParserOptions = {
    strict: true,
    patterns: {},
};
