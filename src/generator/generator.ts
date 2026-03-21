import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Parser } from "../parser/parser";
import { TemplateHeaders, type TemplateDefaults, type TemplateHeader } from "../template/header";

export interface GeneratedFile {
    filePath: string;
    contents: string;
}

export class Generator {
    static getTemplateHeader(input: string): TemplateHeader {
        return TemplateHeaders.parse(input);
    }

    static getDefaultArguments(input: string): TemplateDefaults {
        return TemplateHeaders.getDefaults(input);
    }

    static parseAnyFile(templatePath: string, args: Record<string, unknown> = {}): GeneratedFile[] {
        const template = readFileSync(templatePath, "utf8");
        return [Generator.parseTemplate(template, args)];
    }

    static parseTemplate(template: string, args: Record<string, unknown> = {}): GeneratedFile {
        const header = Generator.getTemplateHeader(template);
        const templateDefaults = header.defaults ?? {};

        const parsedFilename = Parser.parseString(header.filename, args, { templateDefaults });
        const parsedPath = Parser.parseString(header.path, args, { templateDefaults });
        const contents = Parser.parseString(TemplateHeaders.strip(template), args, { templateDefaults });

        return {
            filePath: path.posix.join(parsedPath, parsedFilename),
            contents,
        };
    }

    static writeFiles(files: GeneratedFile[], options: { rootDir?: string } = {}): void {
        const rootDir = options.rootDir ?? process.cwd();

        for (const file of files) {
            const absolutePath = path.resolve(rootDir, file.filePath);
            mkdirSync(path.dirname(absolutePath), { recursive: true });
            writeFileSync(absolutePath, file.contents, "utf8");
        }
    }
}
