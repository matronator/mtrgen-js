import { describe, expect, it } from "vitest";
import { Parser } from "../../src/parser/parser";

describe("Parser (variables)", () => {
    it("returns non-string values as-is", () => {
        const values: unknown[] = [
            1,
            true,
            null,
            -30,
            0,
            ["sumting"],
            { idk: "lol" },
            1.23456789,
        ];

        for (const value of values) {
            expect(Parser.parseString(value)).toBe(value);
        }
    });

    it("parses a template with variable + filter", () => {
        const template = "test <% mate|pow:3 %> and with a <%filter|upper%>";
        const args = { mate: 2, filter: "lol" };

        const parsed = Parser.parseString(template, args);

        expect(parsed).not.toContain("<%");
        expect(parsed).not.toContain("%>");
        expect(parsed).toBe("test 8 and with a LOL");
    });

    it("parses a filter with arguments", () => {
        const template = "<% var|substring:1,4 %>";
        const args = { var: "abcdef" };

        expect(Parser.parseString(template, args)).toBe("bcd");
    });

    it("parses the default filter", () => {
        const template = "<% var|pascalCase %>";
        const args = { var: "hello world" };

        expect(Parser.parseString(template, args)).toBe("HelloWorld");
    });

    it("parses default values", () => {
        const template = 'Hello <% var="world" %>!';
        expect(Parser.parseString(template, {})).toBe("Hello world!");
    });

    it("parses default value types like PHP string-casts", () => {
        const template = 'Hello <% var="world" %><% var2=1 %><% var3=true %><% var4=null %>';
        expect(Parser.parseString(template, {})).toBe("Hello world1true");
    });

    it("parses empty default values when strict is false", () => {
        const template1 = "Hello <% var= %>!";
        const template2 = "Hello <% var=|upper %>!";

        expect(Parser.parseString(template1, {}, false)).toBe("Hello !");
        expect(Parser.parseString(template2, {}, false)).toBe("Hello !");
    });

    it("ignores default value when argument exists", () => {
        const template = 'Hello <% var="world" %>!';
        const args = { var: "mate" };

        expect(Parser.parseString(template, args)).toBe("Hello mate!");
    });

    it("applies filter to default value", () => {
        const template1 = 'Hello <% var="world"|truncate:2 %>!';
        const template2 = 'Hello <% var="world"|truncate:2,"" %>!';
        const template3 = 'Hello <% var=""|truncate:2 %>!';

        expect(Parser.parseString(template1, {})).toBe("Hello wo...!");
        expect(Parser.parseString(template2, {})).toBe("Hello wo!");
        expect(Parser.parseString(template3, {})).toBe("Hello !");
    });

    it("variable is an object", () => {
        const template = "<% var.greetings %> <% var.name %>!";
        const args = { var: { greetings: "Hello", name: "world" } };

        expect(Parser.parseString(template, args)).toBe("Hello world!");
    });

    it("variable is an array", () => {
        const template = "<% var[0] %> <% var[1] %>!";
        const args = { var: ["Hello", "world"] };

        expect(Parser.parseString(template, args)).toBe("Hello world!");
    });
});
