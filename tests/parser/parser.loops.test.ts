import { describe, expect, it } from "vitest";
import { Parser } from "../../src/parser/parser";

describe("Parser (loops)", () => {
    it("loops through arrays with item bindings", () => {
        const template = "<% for item of $items %><% $item %>,<% endfor %>";

        expect(Parser.parseString(template, { items: ["a", "b", "c"] })).toBe("a,b,c,");
    });

    it("loops through arrays with item and index bindings", () => {
        const template = "<% for [item, index] of $items %><% $index %>:<% $item %>; <% endfor %>";

        expect(Parser.parseString(template, { items: ["a", "b"] })).toBe("0:a; 1:b; ");
    });

    it("supports first, last, and sep loop blocks", () => {
        const template = "<% for item of $items %><% first %>[<% endfirst %><% $item %><% sep %>, <% endsep %><% last %>]<% endlast %><% endfor %>";

        expect(Parser.parseString(template, { items: ["a", "b", "c"] })).toBe("[a, b, c]");
    });

    it("supports empty loop blocks for empty arrays and objects", () => {
        const template = "<% for item of $items %><% $item %><% empty %>none<% endempty %><% endfor %>|<% for [item, key] of $meta %><% $key %>=<% $item %><% empty %>empty-meta<% endempty %><% endfor %>";

        expect(Parser.parseString(template, { items: [], meta: {} })).toBe("none|empty-meta");
    });

    it("does not render empty loop blocks when iterations happen", () => {
        const template = "<% for item of $items %><% $item %><% empty %>none<% endempty %><% endfor %>";

        expect(Parser.parseString(template, { items: ["a", "b"] })).toBe("ab");
    });

    it("loops through objects with item and key bindings", () => {
        const template = "<% for [item, key] of $meta %><% $key %>=<% $item %>; <% endfor %>";

        expect(Parser.parseString(template, { meta: { first: "a", second: "b" } })).toBe("first=a; second=b; ");
    });

    it("supports object iteration with a single item binding", () => {
        const template = "<% for item of $meta %><% $item %>,<% endfor %>";

        expect(Parser.parseString(template, { meta: { first: "a", second: "b" } })).toBe("a,b,");
    });

    it("supports ignored loop bindings", () => {
        const template = "<% for [_, key] of $meta %><% $key %>,<% endfor %><% for [_, index] of $items %><% $index %>,<% endfor %>";

        expect(Parser.parseString(template, {
            meta: { first: "a", second: "b" },
            items: ["x", "y"],
        })).toBe("first,second,0,1,");
    });

    it("uses $-prefixed variables alongside loop block keywords", () => {
        const template = "<% $first %>|<% $last %>|<% $sep %> <% for item of $items %><% first %>(<% endfirst %><% $item %><% sep %>, <% endsep %><% last %>)<% endlast %><% endfor %>";

        expect(Parser.parseString(template, {
            first: "alpha",
            last: "omega",
            sep: "mid",
            items: ["x", "y"],
        })).toBe("alpha|omega|mid (x, y)");
    });

    it("supports nested loops and conditions", () => {
        const template = `<% for [item, index] of $items %>
<% if $item.enabled && $index < $limit %>
<% $item.name %>
<% endif %>
<% endfor %>`;

        expect(Parser.parseString(template, {
            limit: 2,
            items: [
                { name: "alpha", enabled: true },
                { name: "beta", enabled: false },
                { name: "gamma", enabled: true },
            ],
        })).toBe(`alpha
`);
    });
});
