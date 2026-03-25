import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { TemplateHeaders } from "../template/header";

interface TemplateStoreData {
    templates: Record<string, string>;
}

export interface TemplateStoreOptions {
    homeDir?: string;
}

export interface StoredTemplate {
    fileName: string;
    filePath: string;
    contents: string;
}

export class TemplateStore {
    readonly homeDir: string;
    readonly templateDir: string;
    readonly storePath: string;

    constructor(options: TemplateStoreOptions = {}) {
        this.homeDir = path.resolve(options.homeDir ?? path.join(os.homedir(), ".mtrgen"));
        this.templateDir = path.join(this.homeDir, "templates");
        this.storePath = path.join(this.homeDir, "templates.json");

        mkdirSync(this.templateDir, { recursive: true });
        if (!existsSync(this.storePath)) {
            this.#writeStore({ templates: {} });
        }
    }

    save(templatePath: string, alias?: string): string {
        const absolutePath = path.resolve(templatePath);
        if (!existsSync(absolutePath)) {
            throw new Error(`Template file not found: ${absolutePath}`);
        }

        const contents = readFileSync(absolutePath, "utf8");
        const header = TemplateHeaders.parse(contents);
        const templateName = (alias ?? header.name).trim();

        if (!templateName) {
            throw new Error("Template name cannot be empty.");
        }

        const fileName = path.basename(absolutePath);
        this.#saveEntry(templateName, fileName);
        copyFileSync(absolutePath, path.join(this.templateDir, fileName));

        return templateName;
    }

    saveRemote(name: string, fileName: string, contents: string): string {
        const templateName = name.trim();
        const normalizedFileName = path.basename(fileName.trim());

        if (!templateName) {
            throw new Error("Template name cannot be empty.");
        }

        if (!normalizedFileName) {
            throw new Error("Template file name cannot be empty.");
        }

        this.#saveEntry(templateName, normalizedFileName);
        writeFileSync(path.join(this.templateDir, normalizedFileName), contents, "utf8");

        return templateName;
    }

    listNames(): string[] {
        return Object.keys(this.#readStore().templates).sort((left, right) => left.localeCompare(right));
    }

    has(name: string): boolean {
        return this.#readStore().templates[name] !== undefined;
    }

    getFullPath(name: string): string | undefined {
        const fileName = this.getFileName(name);
        if (!fileName) return undefined;

        const filePath = path.join(this.templateDir, fileName);
        return existsSync(filePath) ? filePath : undefined;
    }

    getFileName(name: string): string | undefined {
        return this.#readStore().templates[name];
    }

    load(name: string): StoredTemplate | undefined {
        const fileName = this.getFileName(name);
        if (!fileName) return undefined;

        const filePath = path.join(this.templateDir, fileName);
        if (!existsSync(filePath)) return undefined;

        return {
            fileName,
            filePath,
            contents: readFileSync(filePath, "utf8"),
        };
    }

    remove(name: string): boolean {
        const store = this.#readStore();
        const fileName = store.templates[name];
        if (!fileName) return false;

        delete store.templates[name];
        this.#writeStore(store);
        rmSync(path.join(this.templateDir, fileName), { force: true });

        return true;
    }

    repair(): string[] {
        const store = this.#readStore();
        const removed: string[] = [];

        for (const [name, fileName] of Object.entries(store.templates)) {
            if (!existsSync(path.join(this.templateDir, fileName))) {
                delete store.templates[name];
                removed.push(name);
            }
        }

        if (removed.length > 0) {
            this.#writeStore(store);
        }

        return removed;
    }

    #readStore(): TemplateStoreData {
        const raw = readFileSync(this.storePath, "utf8");
        const parsed = JSON.parse(raw) as Partial<TemplateStoreData> | null;

        if (!parsed || typeof parsed !== "object" || !parsed.templates || typeof parsed.templates !== "object") {
            return { templates: {} };
        }

        return {
            templates: Object.fromEntries(
                Object.entries(parsed.templates).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
            ),
        };
    }

    #writeStore(data: TemplateStoreData): void {
        writeFileSync(this.storePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    }

    #saveEntry(name: string, fileName: string): void {
        const store = this.#readStore();
        store.templates[name] = fileName;
        this.#writeStore(store);
    }
}
