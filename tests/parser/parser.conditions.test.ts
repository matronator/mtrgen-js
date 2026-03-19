import { describe, expect, it } from "vitest";
import { Parser } from "../../src/parser/parser";

describe("Parser (conditions)", () => {
    it("parses a simple condition", () => {
        const template = "<% if $foo === true %><% bar %> <% endif %>World!";
        const args1 = { foo: true, bar: "Hello" };
        const args2 = { foo: false, bar: "Hello" };

        expect(Parser.parseString(template, args1)).toBe("Hello World!");
        expect(Parser.parseString(template, args2)).toBe("World!");
    });

    it("parses nested conditions", () => {
        const template = "<% if $foo === true %>Hello<% if $bar === true %> Cruel<% endif %><% endif %> World!";
        expect(Parser.parseString(template, { foo: true, bar: true })).toBe("Hello Cruel World!");
        expect(Parser.parseString(template, { foo: true, bar: false })).toBe("Hello World!");
        expect(Parser.parseString(template, { foo: false, bar: true })).toBe(" World!");
        expect(Parser.parseString(template, { foo: false, bar: false })).toBe(" World!");
    });

    it("parses nested numeric conditions", () => {
        const template = '<% if $foo === "asdf" %>Hello<% if $bar === 2 %> Cruel<% endif %><% endif %> World!';
        expect(Parser.parseString(template, { foo: "asdf", bar: 2 })).toBe("Hello Cruel World!");
        expect(Parser.parseString(template, { foo: "asdf", bar: 1 })).toBe("Hello World!");
        expect(Parser.parseString(template, { foo: 2, bar: 2 })).toBe(" World!");
        expect(Parser.parseString(template, { foo: 2, bar: 1 })).toBe(" World!");
    });

    it("keeps new lines consistent", () => {
        const template1 = `Hello
        <% if false %>
        Amazing
        <% endif %>
        World!`;

        const expected1 = `Hello
        World!`;

        const template2 = `Hello
        <% if true %>
        Amazing
        <% endif %>
        World!`;

        const expected2 = `Hello
        Amazing
        World!`;

        expect(Parser.parseString(template1, {})).toBe(expected1);
        expect(Parser.parseString(template2, {})).toBe(expected2);
    });

    it("parses else blocks", () => {
        const template1 = "Hello<% if false %> Amazing<% else %> Cruel<% endif %> World!";
        const template2 = "Hello<% if true %> Amazing<% else %> Cruel<% endif %> World!";
        expect(Parser.parseString(template1)).toBe("Hello Cruel World!");
        expect(Parser.parseString(template2)).toBe("Hello Amazing World!");
    });

    it("parses nested if/else", () => {
        const template1 = "Hello<% if false %> Amazing<% else %> Cruel<% if true %> World!<% endif %><% endif %>";
        const template2 = "Hello<% if true %> Amazing<% else %> Cruel<% if false %> World!<% endif %><% endif %>";
        expect(Parser.parseString(template1)).toBe("Hello Cruel World!");
        expect(Parser.parseString(template2)).toBe("Hello Amazing");
    });

    it("parses double nested if/else", () => {
        const template1 = "Hello<% if false %> Amazing<% else %> Cruel<% if false %> World!<% else %> Universe!<% endif %><% endif %>";
        const template2 = "Hello<% if true %> Amazing<% else %> Cruel<% if false %> World!<% else %> Universe!<% endif %><% endif %>";
        const template3 = "Hello<% if false %> Amazing<% else %> Cruel<% if true %> World!<% else %> Universe!<% endif %><% endif %>";
        expect(Parser.parseString(template1)).toBe("Hello Cruel Universe!");
        expect(Parser.parseString(template2)).toBe("Hello Amazing");
        expect(Parser.parseString(template3)).toBe("Hello Cruel World!");
    });

    it("parses double nested if/else/else", () => {
        const template1 = "Hello<% if false %> Amazing<% else %> Cruel<% if false %> World<% else %> Universe<% endif %><% if false %>!<% else %>?<% endif %><% endif %>";
        const template2 = "Hello<% if false %> Amazing<% else %> Cruel<% if true %> World<% else %> Universe<% endif %><% if false %>!<% else %>?<% endif %><% endif %>";
        const template3 = "Hello<% if false %> Amazing<% else %> Cruel<% if true %> World!<% else %> Universe<% if false %> Milky Way!<% else %> Andromeda!<% endif %><% endif %><% endif %>";
        const template4 = "Hello<% if false %> Amazing<% else %> Cruel<% if false %> World!<% else %> Universe<% if true %> Milky Way!<% else %> Andromeda!<% endif %><% endif %><% endif %>";

        expect(Parser.parseString(template1)).toBe("Hello Cruel Universe?");
        expect(Parser.parseString(template2)).toBe("Hello Cruel World?");
        expect(Parser.parseString(template3)).toBe("Hello Cruel World!");
        expect(Parser.parseString(template4)).toBe("Hello Cruel Universe Milky Way!");
    });

    it("parses empty if/else blocks", () => {
        const template1 = "Hello<% if false %><% else %> Cruel<% endif %> World!";
        const template2 = "Hello<% if true %> Amazing<% else %><% endif %> World!";
        const template3 = "Hello<% if true %><% else %> Cruel<% endif %> World!";
        const template4 = "Hello<% if false %> Amazing<% else %><% endif %> World!";

        expect(Parser.parseString(template1)).toBe("Hello Cruel World!");
        expect(Parser.parseString(template2)).toBe("Hello Amazing World!");
        expect(Parser.parseString(template3)).toBe("Hello World!");
        expect(Parser.parseString(template4)).toBe("Hello World!");
    });

    it("supports negated conditions and negated variables", () => {
        const template1 = "Hello<% if !false %> Amazing<% endif %> World!";
        const template2 = "Hello<% if !true %> Amazing<% else %> Cruel<% endif %> World!";
        expect(Parser.parseString(template1)).toBe("Hello Amazing World!");
        expect(Parser.parseString(template2)).toBe("Hello Cruel World!");

        const template3 = "Hello<% if !$foo %> Amazing<% endif %> World!";
        const template4 = "Hello<% if !$foo %> Amazing<% else %> Cruel<% endif %> World!";
        expect(Parser.parseString(template3, { foo: null })).toBe("Hello Amazing World!");
        expect(Parser.parseString(template4, { foo: true })).toBe("Hello Cruel World!");
    });

    it("supports negation syntax", () => {
        const template1 = "<% if $true %>not negated<% endif %>";
        const template2 = "<% if !$false %>negated<% endif %>";
        const template3 = "<% if !$true %>negated<% endif %>";
        const template4 = "<% if true %>literal<% endif %>";

        expect(Parser.parseString(template1, { true: true })).toBe("not negated");
        expect(Parser.parseString(template2, { false: false })).toBe("negated");
        expect(Parser.parseString(template3, { true: true })).toBe("");
        expect(Parser.parseString(template4)).toBe("literal");
    });

    it("parses a real-world nested condition sample", () => {
        const template = `<% if $mintable === true %>
(define-public (mint (amount uint) (recipient principal))
(begin
<% if !$allowMintToAll %>
    (asserts! (is-eq tx-sender CONTRACT_OWNER) ERR_OWNER_ONLY)
<% endif %>
    (ft-mint? <% name|kebabCase %> amount recipient)
)
)
<% endif %>
`;

        const expected1 = `(define-public (mint (amount uint) (recipient principal))
(begin
    (asserts! (is-eq tx-sender CONTRACT_OWNER) ERR_OWNER_ONLY)
    (ft-mint? hello-world amount recipient)
)
)
`;

        const expected3 = `(define-public (mint (amount uint) (recipient principal))
(begin
    (ft-mint? hello-world amount recipient)
)
)
`;

        const args1 = { mintable: true, allowMintToAll: false, name: "HelloWorld" };
        const args2 = { mintable: false, allowMintToAll: true, name: "HelloWorld" };
        const args3 = { mintable: true, allowMintToAll: true, name: "HelloWorld" };

        expect(Parser.parseString(template, args1)).toBe(expected1);
        expect(Parser.parseString(template, args2)).toBe("");
        expect(Parser.parseString(template, args3)).toBe(expected3);
    });

    it("variables on both sides of a condition", () => {
        const template = "Hello<% if $foo === $bar %> Cruel<% endif %> World!";
        expect(Parser.parseString(template, { foo: "Hello", bar: "Hello" })).toBe("Hello Cruel World!");
        expect(Parser.parseString(template, { foo: "Hello", bar: "World" })).toBe("Hello World!");
    });

    it("variable is an object", () => {
        const template = "Hello <% if $var.name === 'world' %>world<% endif %>!";
        const args = { var: { name: "world" } };

        expect(Parser.parseString(template, args)).toBe("Hello world!");
    });

    it("variable is an array", () => {
        const template = "Hello <% if $var[0] === 'world' %>world<% endif %>!";
        const args = { var: ["world"] };

        expect(Parser.parseString(template, args)).toBe("Hello world!");
    });
});
