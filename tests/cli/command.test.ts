import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runCli } from "../../src/cli/command";

const TEMPLATE = `--- MTRGEN ---
name: cli-template
filename: <% $name|pascalCase %>.ts
path: src/<% $folder="components" %>
defaults:
    title: "Hello"
--- /MTRGEN ---

export const title = "<% $title %>";
`;

const REMOTE_TEMPLATE = `--- MTRGEN ---
name: remote-component
filename: <% $name|pascalCase %>.tsx
path: app/<% $folder="widgets" %>
--- /MTRGEN ---

export const component = "<% $name %>";
`;

async function withTempDir<T>(fn: (tmpDir: string) => Promise<T> | T): Promise<T> {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "mtrgen-cli-"));
    try {
        return await fn(tmpDir);
    } finally {
        rmSync(tmpDir, { recursive: true, force: true });
    }
}

function getStoreHomeDir(tmpDir: string): string {
    return path.join(tmpDir, ".mtrgen-home");
}

function createJsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            "Content-Type": "application/json",
        },
    });
}

function readFormBody(init: RequestInit | undefined): URLSearchParams {
    const body = init?.body;
    return body instanceof URLSearchParams ? body : new URLSearchParams(String(body ?? ""));
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
            {
                stdout: (line) => stdout.push(line),
                stderr: () => {},
                storeHomeDir: getStoreHomeDir(tmpDir),
            },
        );

        expect(exitCode).toBe(0);
        expect(readFileSync(path.join(outputDir, "src/ui/Button.ts"), "utf8")).toBe('export const title = "Hello";\n');
        expect(stdout[0]).toContain("Generated");
    }));

    it("saves templates and generates from the local store", async () => withTempDir(async (tmpDir) => {
        const templatePath = path.join(tmpDir, "Component.ts.mtr");
        const outputDir = path.join(tmpDir, "generated");
        writeFileSync(templatePath, TEMPLATE, "utf8");

        const stdout: string[] = [];
        const storeHomeDir = getStoreHomeDir(tmpDir);

        expect(await runCli(["save", templatePath, "--alias", "ButtonTemplate"], {
            stdout: (line) => stdout.push(line),
            stderr: () => {},
            storeHomeDir,
        })).toBe(0);

        expect(await runCli(["gen", "ButtonTemplate", "name=button", "folder=ui", "--out-dir", outputDir], {
            stdout: (line) => stdout.push(line),
            stderr: () => {},
            storeHomeDir,
        })).toBe(0);

        expect(readFileSync(path.join(outputDir, "src/ui/Button.ts"), "utf8")).toBe('export const title = "Hello";\n');
        expect(stdout.some((line) => line.includes("Template 'ButtonTemplate' added"))).toBe(true);
        expect(stdout.some((line) => line.includes("Generated"))).toBe(true);
    }));

    it("lists, repairs, and removes saved templates", async () => withTempDir(async (tmpDir) => {
        const templatePath = path.join(tmpDir, "Component.ts.mtr");
        writeFileSync(templatePath, TEMPLATE, "utf8");

        const storeHomeDir = getStoreHomeDir(tmpDir);
        const stdout: string[] = [];

        await runCli(["save", templatePath, "--alias", "Alpha"], {
            stdout: (line) => stdout.push(line),
            stderr: () => {},
            storeHomeDir,
        });
        await runCli(["save", templatePath, "--alias", "Beta"], {
            stdout: (line) => stdout.push(line),
            stderr: () => {},
            storeHomeDir,
        });

        expect(await runCli(["saved"], {
            stdout: (line) => stdout.push(line),
            stderr: () => {},
            storeHomeDir,
        })).toBe(0);

        expect(stdout).toContain("Saved templates:");
        expect(stdout).toContain("- Alpha");
        expect(stdout).toContain("- Beta");

        unlinkSync(path.join(storeHomeDir, "templates", "Component.ts.mtr"));

        expect(await runCli(["repair"], {
            stdout: (line) => stdout.push(line),
            stderr: () => {},
            storeHomeDir,
        })).toBe(0);
        expect(stdout.some((line) => line.includes("Local store repaired. Removed 2 stale templates."))).toBe(true);

        expect(await runCli(["saved"], {
            stdout: (line) => stdout.push(line),
            stderr: () => {},
            storeHomeDir,
        })).toBe(0);
        expect(stdout.at(-1)).toBe("No saved templates.");

        await runCli(["save", templatePath, "--alias", "Gamma"], {
            stdout: (line) => stdout.push(line),
            stderr: () => {},
            storeHomeDir,
        });
        expect(await runCli(["remove", "Gamma"], {
            stdout: (line) => stdout.push(line),
            stderr: () => {},
            storeHomeDir,
        })).toBe(0);
        expect(stdout).toContain("Template 'Gamma' removed!");
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
            {
                stdout: (line) => stdout.push(line),
                stderr: () => {},
                storeHomeDir: getStoreHomeDir(tmpDir),
            },
        );

        expect(exitCode).toBe(0);
        expect(stdout[0]).toContain("Would generate");
        expect(existsSync(path.join(outputDir, "src/components/AlertBox.ts"))).toBe(false);
    }));

    it("supports registry-backed commands", async () => withTempDir(async (tmpDir) => {
        const storeHomeDir = getStoreHomeDir(tmpDir);
        const stdout: string[] = [];
        const publishedBodies: URLSearchParams[] = [];

        const fetchImplementation = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
            const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

            if (url.endsWith("/signup")) {
                return new Response("", { status: 200, statusText: "OK" });
            }

            if (url.endsWith("/login")) {
                const params = readFormBody(init);
                expect(params.get("username")).toBe("tester");
                expect(params.get("password")).toBe("Password123");
                expect(params.get("duration")).toBe("24");
                return createJsonResponse({ status: "success", token: "secret-token" });
            }

            if (url.endsWith("/templates/vendor/component/get")) {
                return new Response(REMOTE_TEMPLATE, {
                    status: 200,
                    headers: {
                        "Content-Type": "text/plain",
                        "X-Template-Filename": "remote-component.ts.mtr",
                    },
                });
            }

            if (url.endsWith("/templates") && init?.method === "POST") {
                const params = readFormBody(init);
                publishedBodies.push(params);
                return createJsonResponse({ status: "success" });
            }

            throw new Error(`Unhandled fetch request: ${url}`);
        });

        expect(await runCli(["signup", "tester", "Password123"], {
            stdout: (line) => stdout.push(line),
            stderr: () => {},
            storeHomeDir,
            apiUrl: "https://mtrgen.matronator.cz/api",
            fetchImplementation,
        })).toBe(0);

        expect(await runCli(["login", "tester", "Password123"], {
            stdout: (line) => stdout.push(line),
            stderr: () => {},
            storeHomeDir,
            apiUrl: "https://mtrgen.matronator.cz/api",
            fetchImplementation,
        })).toBe(0);

        expect(await runCli(["add", "vendor/component"], {
            stdout: (line) => stdout.push(line),
            stderr: () => {},
            storeHomeDir,
            apiUrl: "https://mtrgen.matronator.cz/api",
            fetchImplementation,
        })).toBe(0);

        const generatedDir = path.join(tmpDir, "generated");
        expect(await runCli(["generate", "vendor/component", "name=alert-box", "--out-dir", generatedDir], {
            stdout: (line) => stdout.push(line),
            stderr: () => {},
            storeHomeDir,
            apiUrl: "https://mtrgen.matronator.cz/api",
            fetchImplementation,
        })).toBe(0);

        expect(readFileSync(path.join(generatedDir, "app/widgets/AlertBox.tsx"), "utf8")).toBe('export const component = "alert-box";\n');

        const useDir = path.join(tmpDir, "use-output");
        expect(await runCli(["use", "vendor/component", "name=toast", "--out-dir", useDir], {
            stdout: (line) => stdout.push(line),
            stderr: () => {},
            storeHomeDir,
            apiUrl: "https://mtrgen.matronator.cz/api",
            fetchImplementation,
        })).toBe(0);

        expect(readFileSync(path.join(useDir, "app/widgets/Toast.tsx"), "utf8")).toBe('export const component = "toast";\n');

        expect(await runCli(["publish", "vendor/component"], {
            stdout: (line) => stdout.push(line),
            stderr: () => {},
            storeHomeDir,
            apiUrl: "https://mtrgen.matronator.cz/api",
            fetchImplementation,
        })).toBe(0);

        expect(stdout).toContain("User tester created. You may now login.");
        expect(stdout).toContain("Logged in as tester.");
        expect(stdout).toContain("Template 'vendor/component' was added to the local store!");
        expect(stdout.some((line) => line.includes("published as 'tester/remote-component'"))).toBe(true);

        expect(publishedBodies).toHaveLength(1);
        expect(publishedBodies[0].get("username")).toBe("tester");
        expect(publishedBodies[0].get("name")).toBe("remote-component");
        expect(publishedBodies[0].get("filename")).toBe("remote-component.ts.mtr");
        expect(publishedBodies[0].get("contents")).toContain("name: remote-component");
    }));
});
