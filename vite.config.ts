import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const entries = {
    index: path.resolve(__dirname, "src/index.ts"),
    parser: path.resolve(__dirname, "src/parser/index.ts"),
    generator: path.resolve(__dirname, "src/generator/index.ts"),
    cli: path.resolve(__dirname, "src/cli/index.ts"),
};

export default defineConfig({
    base: "./",
    build: {
        outDir: "./dist",
        emptyOutDir: false,
        minify: "terser",
        lib: {
            entry: entries,
            formats: ["es", "cjs"],
            fileName: (format: string, entryName: string) => `${entryName}.${format === "es" ? "js" : "cjs"}`,
        },
        rollupOptions: {
            external: [/^node:/],
            output: {
                exports: "named",
                preserveModules: false,
            },
        },
    },
    resolve: {
        alias: [
            { find: "@", replacement: path.resolve(__dirname, "src") },
        ],
    },
});
