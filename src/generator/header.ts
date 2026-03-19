export const HEADER_PATTERN = /^--- MTRGEN ---(.+)--- \/MTRGEN ---/ms;

export interface TemplateHeader {
    name: string;
    filename: string;
    path: string;
    defaults?: TemplateDefaults;
}

export type DefaultValue = string|boolean|number|null;

export type TemplateDefaults = Record<string, DefaultValue>;
