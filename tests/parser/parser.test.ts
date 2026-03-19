import { describe, expect, it } from "vitest";
import { Parser } from "../../src/parser/parser";

describe("Parser (comments)", () => {
    it("removes comments", () => {
        const template1 = "Hello <# This is a comment #>World!";
        const template2 = "Hello <#This is a comment#>World!";
        const expected = "Hello World!";

        expect(Parser.parseString(template1)).toBe(expected);
        expect(Parser.parseString(template2)).toBe(expected);
    });

    it("removes comments even with conditions and variables inside", () => {
        const template = "Hello <# This is a comment <% if $condition %> #>World!<# <% $variable %> <% endif %> #>";
        const expected = "Hello World!";

        expect(Parser.parseString(template)).toBe(expected);
        expect(Parser.parseString(template, { condition: true, variable: "test" })).toBe(expected);
    });

    it("removes multiline comments", () => {
        const template = `Hello <# This is a comment
        that spans multiple lines #>World!`;
        const expected = "Hello World!";

        expect(Parser.parseString(template)).toBe(expected);
    });

    it("removes empty comments", () => {
        const template1 = "Hello <# #>World!";
        const template2 = "Hello <##>World!";
        const expected = "Hello World!";

        expect(Parser.parseString(template1)).toBe(expected);
        expect(Parser.parseString(template2)).toBe(expected);
    });

    it("removes nested comments", () => {
        const template = "Hello <# This is a comment <# that is nested #>World!";
        const expected = "Hello World!";

        expect(Parser.parseString(template)).toBe(expected);
    });
});
