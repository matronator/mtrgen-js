import path from 'path';
import { defineConfig } from 'vite';

const fileName = {
    mtrgen: {
        es: `mtrgen.esm.js`,
        cjs: `mtrgen.cjs`,
        iife: `mtrgen.iife.js`,
    },
};

const config = {
  mtrgen: {
    entry: path.resolve(__dirname, "src/index.ts"),
    name: 'MTRGen',
    fileName: (format: string, entryName: string) => fileName[entryName][format],
  },
};

const rollupInputs = {
    mtrgen: {
        "mtrgen": path.resolve(__dirname, "src/index.ts"),
    },
}

const currentConfig = config[process.env.LIB_NAME ?? 'mtrgen'];
const currentInput = rollupInputs[process.env.LIB_NAME ?? 'mtrgen'];

if (currentConfig === undefined || currentInput === undefined) {
  throw new Error('LIB_NAME is not defined or is not valid');
}

const formats = Object.keys(fileName.mtrgen) as Array<keyof typeof fileName.mtrgen>;

export default defineConfig({
    base: "./",
    build: {
        outDir: "./dist",
        lib: {
            ...currentConfig,
            formats,
        },
        emptyOutDir: false,
        minify: 'terser',
        rollupOptions: {
            output: {
                exports: 'named',
                cleanDir: true,
                esModule: true,
                preserveModules: false,
            },
            input: currentInput,
        }
    },
    resolve: {
        alias: [
            { find: "@", replacement: path.resolve(__dirname, "src") },
        ],
    },
});
