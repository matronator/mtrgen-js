import { describe, expect, it } from "vitest";
import { Parser } from "../../src/parser/parser";

const HEADER_TEMPLATE = `--- MTRGEN ---
name: parser-template
filename: <% $title="LocalTitle" %>.txt
path: output
defaults:
    title: "GlobalTitle"
    branch: "elseif"
    list: [1, "string", true, null, "whatever"]
    meta: {a: true, b: "hello", c: 12, d: [1,2,3,4], nested: {a: true, b: 'lol'}}
--- /MTRGEN ---

title=<% $title="LocalBody" %>
second=<% $list[1] %>
truthy=<% $meta.a %>
nested=<% $meta.nested.b %>
<% if $branch === "if" %>IF<% elseif $branch === "elseif" %>ELSEIF<% else %>ELSE<% endif %>
`;

const HEADER_TEMPLATE_FORMATTED = `--- MTRGEN ---
name: parser-template
filename: <% $title="LocalTitle" %>.txt
path: output
defaults:
    title: "GlobalTitle"
    branch: "elseif"
    list: [1, "string", true, null, "whatever"]
    meta: {
        a: true,
        b: "hello",
        c: 12,
        d: [1,2,3,4],
        nested: {
            a: true,
            b: 'lol'
        }
    }
--- /MTRGEN ---

title=<% $title="LocalBody" %>
second=<% $list[1] %>
truthy=<% $meta.a %>
nested=<% $meta.nested.b %>
<% if $branch === "if" %>IF<% elseif $branch === "elseif" %>ELSEIF<% else %>ELSE<% endif %>
`;

const LEGACY_SYNTAX_HEADER_TEMPLATE = `--- MTRGEN ---
name: legacy-template
syntax: 1
filename: <% name %>.txt
path: output
--- /MTRGEN ---

Hello <% name %>!
`;

describe("Parser (template headers)", () => {
    it("parses template headers and strips them from the output", () => {
        expect(Parser.getTemplateHeader(HEADER_TEMPLATE)).toEqual({
            name: "parser-template",
            filename: '<% $title="LocalTitle" %>.txt',
            path: "output",
            defaults: {
                title: "GlobalTitle",
                branch: "elseif",
                list: [1, "string", true, null, "whatever"],
                meta: {
                    a: true,
                    b: "hello",
                    c: 12,
                    d: [1, 2, 3, 4],
                    nested: {
                        a: true,
                        b: "lol",
                    },
                },
            },
        });

        expect(Parser.getDefaultArguments(HEADER_TEMPLATE)).toEqual({
            title: "GlobalTitle",
            branch: "elseif",
            list: [1, "string", true, null, "whatever"],
            meta: {
                a: true,
                b: "hello",
                c: 12,
                d: [1, 2, 3, 4],
                nested: {
                    a: true,
                    b: "lol",
                },
            },
        });

        expect(Parser.stripTemplateHeader(HEADER_TEMPLATE)).toBe(`title=<% $title="LocalBody" %>
second=<% $list[1] %>
truthy=<% $meta.a %>
nested=<% $meta.nested.b %>
<% if $branch === "if" %>IF<% elseif $branch === "elseif" %>ELSEIF<% else %>ELSE<% endif %>
`);
    });

    it("uses global defaults from the header and lets local defaults override them", () => {
        expect(Parser.parseString(HEADER_TEMPLATE)).toBe(`title=LocalBody
second=string
truthy=true
nested=lol
ELSEIF`);
    });

    it("lets explicit arguments override local and global defaults", () => {
        expect(Parser.parseString(HEADER_TEMPLATE, {
            title: "UserTitle",
            branch: "if",
            list: [1, "custom", false],
            meta: {
                a: false,
                nested: {
                    b: "user",
                },
            },
        })).toBe(`title=UserTitle
second=custom
truthy=false
nested=user
IF`);
    });

    it("test formatting defaults with whitespace like JSON", () => {
        expect(Parser.parseString(HEADER_TEMPLATE_FORMATTED)).toBe(`title=LocalBody
second=string
truthy=true
nested=lol
ELSEIF`);
    });

    it("supports syntax: 1 in the header for legacy templates", () => {
        expect(Parser.getTemplateHeader(LEGACY_SYNTAX_HEADER_TEMPLATE)).toEqual({
            name: "legacy-template",
            syntax: 1,
            filename: "<% name %>.txt",
            path: "output",
        });

        expect(Parser.parseString(LEGACY_SYNTAX_HEADER_TEMPLATE, { name: "world" })).toBe(`Hello world!
`);
    });
});
