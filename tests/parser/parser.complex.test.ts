import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Parser } from "../../src/parser/parser";

function readFixture(relativePath: string): string {
    return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("Parser (complex)", () => {
    it("parses a real-life template", () => {
        const input = readFixture("./token.input.clar.mtr");
        const expected1 = readFixture("./token.expected.1.clar");
        const expected2 = readFixture("./token.expected.2.clar") + "\n\n";

        const args1 = {
            name: "asdads",
            editableUri: true,
            userWallet: "SP39DTEJFPPWA3295HEE5NXYGMM7GJ8MA0TQX379",
            tokenName: "asdads",
            tokenSymbol: "ASD",
            tokenSupply: 8,
            tokenDecimals: 3,
            tokenUri: "",
            mintable: false,
            burnable: false,
            initialAmount: 0,
            allowMintToAll: false,
        };

        const args2 = {
            name: "asdads",
            editableUri: true,
            userWallet: "SP39DTEJFPPWA3295HEE5NXYGMM7GJ8MA0TQX379",
            tokenName: "asdads",
            tokenSymbol: "ASD",
            tokenSupply: 0,
            tokenDecimals: 3,
            tokenUri: "",
            mintable: true,
            burnable: false,
            initialAmount: 0,
            allowMintToAll: false,
            mintFixedAmount: false,
            mintAmount: 0,
        };

        expect(Parser.parseString(input, args1)).toBe(expected1);
        expect(Parser.parseString(input, args2)).toBe(expected2);
    });
});
