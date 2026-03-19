/// <reference types="vitest/config" />
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from './vite.config';
import { UserConfig } from "vite";

export default mergeConfig(viteConfig, defineConfig({
    test: {
        projects: [
            {
                test: {
                    include: [
                        'test/unit/**/*.{test,spec}.ts',
                        'test/**/*.unit.{test,spec}.ts',
                        'test/unit/*.{test,spec}.ts',
                        'test/**/*.{test,spec}.ts',
                        'test/*.{test,spec}.ts',
                        'tests/unit/**/*.{test,spec}.ts',
                        'tests/**/*.unit.{test,spec}.ts',
                        'tests/unit/*.{test,spec}.ts',
                        'tests/**/*.{test,spec}.ts',
                        'tests/*.{test,spec}.ts',
                    ],
                    name: 'unit',
                    environment: 'node',
                },
            },
        ],
        reporters: [
            ['default', { outputFile: './test-results.txt' }],
            ['json', { outputFile: './test-results.json' }]
        ],
        outputFile: {
            json: './test-results.json',
            default: './test-results.txt',
        },
        coverage: {
            exclude: ['dts-bundle-generator.config.ts', 'vitest.setup.ts', 'vitest-canvas-mock.ts', 'test-coverage/**', 'coverage/**'],
            reporter: [
                ['html-spa', { file: './test-coverage-spa.html', subdir: 'html-spa', projectRoot: './' }],
                ['html', { file: './test-coverage.html', subdir: 'html', projectRoot: './' }],
                ['json', { file: './test-coverage.json', subdir: 'json', projectRoot: './' }],
                ['text', { file: './test-coverage.txt', subdir: 'text', projectRoot: './' }],
            ],
            reportsDirectory: './test-coverage',
            reportOnFailure: true,
        },
        globals: true,
        environment: "node",
    },
}) as UserConfig);
