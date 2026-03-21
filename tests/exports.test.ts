import { describe, expect, it } from "vitest";
import { Generator as RootGenerator, Parser as RootParser } from "../src/index";
import { Generator } from "../src/generator";
import { Parser } from "../src/parser";

describe("Package entrypoints", () => {
    it("exports Parser and Generator from the root entry", () => {
        expect(RootParser).toBe(Parser);
        expect(RootGenerator).toBe(Generator);
    });

    it("exports the subpath entrypoints", () => {
        expect(typeof Parser.parseString).toBe("function");
        expect(typeof Generator.parseTemplate).toBe("function");
    });
});
