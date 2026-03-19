const config = {
    compilationOptions: {
        preferredConfigPath: './tsconfig.json',
    },
    entries: [
        {
            filePath: "./src/index.ts",
            outFile: "./dist/mtrgen.d.ts",
            noCheck: false,
        },
    ],
};

module.exports = config;
