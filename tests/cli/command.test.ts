import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/command";

const TEMPLATE = `--- MTRGEN ---
name: cli-template
filename: <% name|pascalCase %>.ts
path: src/<% folder="components" %>
defaults:
    title: "Hello"
--- /MTRGEN ---

export const title = "<% title %>";
`;

async function withTempDir<T>(fn: (tmpDir: string) => Promise<T> | T): Promise<T> {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "mtrgen-cli-"));
    try {
        return await fn(tmpDir);
    } finally {
        rmSync(tmpDir, { recursive: true, force: true });
    }
}

describe("CLI", () => {
    it("generates a file from a template path", async () => withTempDir(async (tmpDir) => {
        const templatePath = path.join(tmpDir, "Component.ts.mtr");
        const outputDir = path.join(tmpDir, "output");
        mkdirSync(outputDir, { recursive: true });
        writeFileSync(templatePath, TEMPLATE, "utf8");

        const stdout: string[] = [];
        const exitCode = await runCli(
            ["generate", templatePath, "--arg", "name=button", "--arg", "folder=ui", "--out-dir", outputDir],
            { stdout: (line) => stdout.push(line), stderr: () => {} },
        );

        expect(exitCode).toBe(0);
        expect(readFileSync(path.join(outputDir, "src/ui/Button.ts"), "utf8")).toBe('export const title = "Hello";\n');
        expect(stdout[0]).toContain("Generated");
    }));

    it("supports data files and dry runs", async () => withTempDir(async (tmpDir) => {
        const templatePath = path.join(tmpDir, "Component.ts.mtr");
        const outputDir = path.join(tmpDir, "output");
        const dataPath = path.join(tmpDir, "component.json");
        writeFileSync(templatePath, TEMPLATE, "utf8");
        writeFileSync(dataPath, JSON.stringify({ name: "alert-box", title: "Warning" }), "utf8");

        const stdout: string[] = [];
        const exitCode = await runCli(
            ["generate", templatePath, "--data", dataPath, "--dry-run", "--out-dir", outputDir],
            { stdout: (line) => stdout.push(line), stderr: () => {} },
        );

        expect(exitCode).toBe(0);
        expect(stdout[0]).toContain("Would generate");
        expect(existsSync(path.join(outputDir, "src/components/AlertBox.ts"))).toBe(false);
    }));
});
