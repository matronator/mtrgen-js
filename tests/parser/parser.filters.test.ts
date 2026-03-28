import { describe, expect, it } from "vitest";
import { Parser } from "../../src/parser/parser";

describe("Parser (filters)", () => {
    it("parses pascalCase", () => {
        const template = "<% $var|pascalCase %>";
        expect(Parser.parseString(template, { var: "hello world" })).toBe("HelloWorld");
        expect(Parser.parseString(template, { var: "hello-world" })).toBe("HelloWorld");
        expect(Parser.parseString(template, { var: "hello_world. And HTML idk." })).toBe("HelloWorld.AndHTMLIdk.");
    });

    it("parses titleCase", () => {
        const template = "<% $var|titleCase %>";
        expect(Parser.parseString(template, { var: "hello world" })).toBe("Hello World");
        expect(Parser.parseString(template, { var: "hello-world" })).toBe("Hello-World");
        expect(Parser.parseString(template, { var: "hello_world. And HTML idk." })).toBe("Hello World. And HTML Idk.");
    });

    it("parses truncate", () => {
        const template1 = "<% $var|truncate:10 %>";
        const template2 = '<% $var|truncate:10,"-" %>';

        expect(Parser.parseString(template1, { var: "hello world" })).toBe("hello worl...");
        expect(Parser.parseString(template1, { var: "hello" })).toBe("hello");
        expect(Parser.parseString(template1, { var: "hello_world. And HTML idk." })).toBe("hello_worl...");

        expect(Parser.parseString(template2, { var: "hello world" })).toBe("hello worl-");
        expect(Parser.parseString(template2, { var: "hello" })).toBe("hello");
        expect(Parser.parseString(template2, { var: "hello_world. And HTML idk." })).toBe("hello_worl-");
    });

    it("chains filters", () => {
        const template1 = '<% $var|truncate:3,""|upper %>';
        const template2 = '<% $var|truncate:3,"|"|upper %>';

        expect(Parser.parseString(template1, { var: "Hello" })).toBe("HEL");
        expect(Parser.parseString(template2, { var: "Hello" })).toBe("HEL|");
    });
});
