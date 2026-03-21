module.exports = {
    compilationOptions: {
        preferredConfigPath: "./tsconfig.json",
    },
    entries: [
        {
            filePath: "./src/index.ts",
            outFile: "./dist/index.d.ts",
            noCheck: false,
        },
        {
            filePath: "./src/parser/index.ts",
            outFile: "./dist/parser.d.ts",
            noCheck: false,
        },
        {
            filePath: "./src/generator/index.ts",
            outFile: "./dist/generator.d.ts",
            noCheck: false,
        },
    ],
};
