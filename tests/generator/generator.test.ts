import { describe, expect, it,TestRunner } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Generator } from "../../src/generator/generator";

const TEST_TEMPLATE = `--- MTRGEN ---
name: js-template
filename: <% name %>.js
path: assets/js
--- /MTRGEN ---

document.addEventListener('<% event %>', function() {
    var template = document.querySelector('#<% id="myId" %>');
    var templateContent = template.content;
    template.classList.add('<% classes="TEMPLATE"|lower %>');
    var clone = document.importNode(templateContent, true);
    document.body.appendChild(clone);
});
`;

const PARSED_TEMPLATE = `document.addEventListener('DOMContentLoaded', function() {
    var template = document.querySelector('#my-template');
    var templateContent = template.content;
    template.classList.add('template');
    var clone = document.importNode(templateContent, true);
    document.body.appendChild(clone);
});
`;

const PARSED_FILE = `<?php

declare(strict_types=1);

namespace Matronator\\Mtrgen\\Cli;

use Matronator\\Parsem\\Parser;
use Symfony\\Component\\Console\\Input\\InputArgument;
use Symfony\\Component\\Console\\Input\\InputInterface;
use Symfony\\Component\\Console\\Output\\OutputInterface;

class HelloCommand extends BaseGeneratorCommand
{
    protected static $defaultName = 'hello';
    protected static $defaultDescription = 'Hello world!';

    public function configure(): void
    {
        $this->setAliases(['hi']);
    }

    public function execute(InputInterface $input, OutputInterface $output): int
    {
        parent::execute($input, $output);

        $this->io->newLine();
        return self::SUCCESS;
    }
}
`;

const HEADER_DEFAULTS_TEMPLATE = `--- MTRGEN ---
name: defaults-template
filename: <% name %>.js
path: assets/js
defaults:
    name: MyTemplate
    event: DOMContentLoaded
    id: "my-template"
    classes: 'TEMP'
    cond: true
    cond2: null
    cond3: "null"
--- /MTRGEN ---

document.addEventListener('<% event %>', function() {
    // <% name|lower %>
    var template = document.querySelector('#<% id="myId" %>');
    var templateContent = template.content;
    template.classList.add('<% classes="TEMPLATE"|lower %>');
    var clone = document.importNode(templateContent, true);
    document.body.appendChild(clone);
    <% if $cond %>
    console.log(<% cond %>);
    <% endif %>
    <% if $cond2 %>
    console.log(<% cond2 %>);
    <% endif %>
    <% if $cond3 %>
    console.log(<% cond3 %>);
    <% endif %>
});
`;

const HEADER_DEFAULTS_TEMPLATE_PARSED = `document.addEventListener('DOMContentLoaded', function() {
    // mytemplate
    var template = document.querySelector('#myId');
    var templateContent = template.content;
    template.classList.add('template');
    var clone = document.importNode(templateContent, true);
    document.body.appendChild(clone);
    console.log(true);
    console.log(null);
});
`;

function withTempDir<T>(fn: (tmpDir: string) => T): T {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "mtrgen-js-"));
    try {
        return fn(tmpDir);
    } finally {
        rmSync(tmpDir, { recursive: true, force: true });
    }
}

describe("Generator", () => {
    it("parses template header", () => {
        const header = Generator.getTemplateHeader(TEST_TEMPLATE);
        expect(header.name).toBe("js-template");
        expect(header.filename).toBe("<% name %>.js");
        expect(header.path).toBe("assets/js");
    });

    it("generates a file from a template", () => withTempDir((tmpDir) => {
        const templatesDir = path.join(tmpDir, "templates");
        mkdirSync(templatesDir, { recursive: true });
        const templatePath = path.join(templatesDir, "js-template.js.mtr");
        writeFileSync(templatePath, TEST_TEMPLATE, "utf8");

        Generator.writeFiles(
            Generator.parseAnyFile(templatePath, {
                name: "my-template",
                event: "DOMContentLoaded",
                id: "my-template",
            }),
            { rootDir: tmpDir },
        );

        const outPath = path.join(tmpDir, "assets/js/my-template.js");
        expect(readFileSync(outPath, "utf8")).toBe(PARSED_TEMPLATE);
    }));

    it("generates a PHP file from a template", () => withTempDir((tmpDir) => {
        const templatesDir = path.join(tmpDir, "templates");
        mkdirSync(templatesDir, { recursive: true });

        const commandTemplate = `--- MTRGEN ---
name: command
filename: <% commandName|pascalCase %>Command.php
path: src/Mtrgen/Cli
--- /MTRGEN ---

<?php

declare(strict_types=1);

namespace Matronator\\Mtrgen<% namespace %>;

use Matronator\\Parsem\\Parser;
use Symfony\\Component\\Console\\Input\\InputArgument;
use Symfony\\Component\\Console\\Input\\InputInterface;
use Symfony\\Component\\Console\\Output\\OutputInterface;

class <% commandName|pascalCase %>Command extends BaseGeneratorCommand
{
    protected static $defaultName = '<% commandName %>';
    protected static $defaultDescription = '<% commandDescription %>';

    public function configure(): void
    {
        $this->setAliases(['<% commandAliases %>']);
    }

    public function execute(InputInterface $input, OutputInterface $output): int
    {
        parent::execute($input, $output);

        $this->io->newLine();
        return self::SUCCESS;
    }
}
`;

        const templatePath = path.join(templatesDir, "Command.php.mtr");
        writeFileSync(templatePath, commandTemplate, "utf8");

        Generator.writeFiles(
            Generator.parseAnyFile(templatePath, {
                namespace: "\\Cli",
                commandName: "hello",
                commandAliases: "hi",
                commandDescription: "Hello world!",
            }),
            { rootDir: tmpDir },
        );

        const outPath = path.join(tmpDir, "src/Mtrgen/Cli/HelloCommand.php");
        expect(readFileSync(outPath, "utf8")).toBe(PARSED_FILE);
    }));

    it("extracts default arguments from header", () => {
        expect(Generator.getDefaultArguments(HEADER_DEFAULTS_TEMPLATE)).toEqual({
            name: "MyTemplate",
            event: "DOMContentLoaded",
            id: "my-template",
            classes: "TEMP",
            cond: true,
            cond2: null,
            cond3: "null",
        });
    });

    it("parses template using global defaults (only when inline defaults are missing)", () => withTempDir((tmpDir) => {
        const templatesDir = path.join(tmpDir, "templates");
        mkdirSync(templatesDir, { recursive: true });
        const templatePath = path.join(templatesDir, "defaults.js.mtr");
        writeFileSync(templatePath, HEADER_DEFAULTS_TEMPLATE, "utf8");

        Generator.writeFiles(Generator.parseAnyFile(templatePath), { rootDir: tmpDir });

        const outPath = path.join(tmpDir, "assets/js/MyTemplate.js");
        expect(readFileSync(outPath, "utf8")).toBe(HEADER_DEFAULTS_TEMPLATE_PARSED);
    }));
});
