# MTRGen.js

![MTRGen Logo](.github/logo.png)

#### [Official Website](https://mtrgen.matronator.cz) | [Documentation](https://mtrgen.matronator.cz/public/docs/) | [Template Repository](https://mtrgen.matronator.cz/repository) | [PHP version](https://github.com/matronator/MTRGen)

`mtrgen` is a template-driven file generator for Node.js and browser. It ships both as a TypeScript library and as a CLI so you can generate files from `.mtr` templates in code or directly from the terminal.

This is a port of the original PHP libraries [MTRGen](https://github.com/matronator/MTRGen) and [Pars'Em](https://github.com/matronator/parsem).

Node.js 20 or newer is recommended for development, releases, and CLI usage.

## Install

Library:

```sh
npm install mtrgen
```

CLI:

```sh
npm install --global mtrgen
```

Or run it without a global install:

```sh
npx mtrgen generate ./templates/component.ts.mtr --arg name=Button
```

## CLI

The package exposes the `mtrgen` command:

```sh
mtrgen <command> [options]
```

Available commands:

- `generate`, `gen`: generate from a saved template name or from `--path <file>`.
- `save`, `s`: save a local `.mtr` template into the local store.
- `saved`, `ls`: list templates in the local store.
- `remove`, `rm`: remove a template from the local store.
- `repair`, `r`: remove broken entries from the local store.
- `add`, `a`: download a template from the online registry into the local store.
- `use`, `u`: generate directly from an online registry template.
- `login`, `in`: log into the online registry and save the access token locally.
- `signup`, `sign`: create a registry account.
- `publish`, `pub`: publish a local or saved template to the online registry.
- `help [command]`: show global help or command help.
- `list`: list the available commands.
- `-v`, `--version`: print the package version.

The local template store and login profile are saved under `~/.mtrgen`.

### Generate

```sh
mtrgen generate [name] [key=value ...]
mtrgen generate --path <template-path> [options]
```

Supported options for `generate` and `use`:

- `-o, --out-dir <dir>`: output root directory. Defaults to the current working directory.
- `-d, --data <file>`: path to a JSON file with template arguments.
- `-a, --arg <key=value>`: inline template argument. Repeat this flag to pass multiple values.
- `--dry-run`: print the target file paths without writing anything.
- `-h, --help`: show command help.

Examples:

```sh
mtrgen generate --path ./templates/component.ts.mtr --arg name=Button --arg folder=components
mtrgen generate ButtonTemplate name=Button folder=components
mtrgen generate ButtonTemplate --data ./component.json --out-dir ./src
mtrgen use vendor/component name=Button --out-dir ./src
```

Inline CLI argument values use the same literal parser as template defaults when possible:

- strings: `name=Button`
- quoted strings: `title="Hello world"`
- booleans: `enabled=true`
- numbers: `count=3`
- `null`: `value=null`
- arrays: `items=["one", "two"]`
- objects: `meta={folder: "ui", nested: {enabled: true}}`

Nested keys are supported in CLI arguments:

```sh
mtrgen generate ./template.mtr --arg meta.folder=components --arg items[0]=Button
```

### Template Store

```sh
mtrgen save ./templates/component.ts.mtr --alias ButtonTemplate
mtrgen saved
mtrgen remove ButtonTemplate
mtrgen repair
```

### Online Registry

The registry-backed commands use `https://mtrgen.matronator.cz/api`.

```sh
mtrgen signup my-user Password123
mtrgen login my-user Password123
mtrgen add vendor/component
mtrgen use vendor/component name=Button
mtrgen publish ButtonTemplate
mtrgen publish --path ./templates/component.ts.mtr
```

## Template Format

Every generator template starts with an `MTRGEN` header:

```txt
--- MTRGEN ---
name: component
filename: <% name|pascalCase %>.tsx
path: src/<% folder="components" %>
defaults:
    title: "Hello"
    enabled: true
--- /MTRGEN ---

export const title = "<% title %>";
```

Required header fields:

- `name`: template name.
- `filename`: output filename template.
- `path`: output directory template.

Optional header fields:

- `defaults`: global default values available to the filename, path, and template body.

## Variables

Variable tags use `<% ... %>`:

```txt
Hello <% name %>!
```

Variables support inline defaults:

```txt
Hello <% name="world" %>!
```

Lookup supports nested properties and array indexes:

```txt
<% user.name %>
<% user.profile.handle %>
<% items[0] %>
<% meta["folder"] %>
```

## Default Value Precedence

When the same value exists in multiple places, precedence is:

1. explicit runtime arguments
2. inline variable defaults like `<% name="Button" %>`
3. header defaults in the `defaults:` block

## Literals

Template defaults and CLI values can use these literal forms:

- strings: `"hello"` or `'hello'`
- numbers: `1`, `3.14`, `-2`
- booleans: `true`, `false`
- null: `null`
- arrays: `[1, "two", true, null]`
- objects: `{folder: "ui", nested: {enabled: true}}`

Multiline arrays and objects are supported inside the header `defaults:` block.

## Filters

Filters are chained with `|`:

```txt
<% name|pascalCase %>
<% title|truncate:30,"..." %>
<% foo|truncate:3,""|upper %>
```

Available filters:

- text casing: `upper`, `lower`, `upperFirst`, `lowerFirst`, `camelCase`, `snakeCase`, `kebabCase`, `pascalCase`, `titleCase`
- collection helpers: `first`, `last`, `length`, `reverse`, `random`, `shuffle`
- string shaping: `truncate`, `trim`, `substring`, `stripTags`, `nl2br`
- encoding and escaping: `url`, `escape`, `unescape`, `hash`, `rot13`, `encode`, `decode`
- math helpers: `pow`, `ceil`, `floor`, `round`

Examples:

```txt
<% name|upper %>
<% componentName|pascalCase %>
<% body|truncate:120,"..." %>
<% url|encode:"base64" %>
<% count|pow:2 %>
```

## Conditions

Conditional blocks use `if`, `elseif`, `else`, and `endif`:

```txt
<% if $enabled %>
enabled
<% else %>
disabled
<% endif %>
```

Supported comparison operators:

- `===`
- `!==`
- `==`
- `!=`
- `<`
- `<=`
- `>`
- `>=`

Conditions support:

- variable lookups with `$name`
- nested lookups like `$user.name` or `$items[0]`
- literal comparisons
- negation with `!`
- nested condition blocks

Example:

```txt
<% if $kind === "service" %>
export class <% name|pascalCase %>Service {}
<% elseif !$enabled %>
// disabled
<% else %>
export const <% name %> = true;
<% endif %>
```

## Comments

Comments are removed from the final output:

```txt
<# this will not be rendered #>
```

Multiline comments are supported too.

## Library Usage

```ts
import { Generator, Parser } from "mtrgen";

const template = `--- MTRGEN ---
name: component
filename: <% name|pascalCase %>.ts
path: src/components
--- /MTRGEN ---

export const name = "<% name %>";
`;

const file = Generator.parseTemplate(template, { name: "button" });
console.log(file.filePath);
console.log(file.contents);

console.log(Parser.parseString("Hello <% name %>!", { name: "world" }));
```

Generate from a template file and write it to disk:

```ts
import { Generator } from "mtrgen";

const files = Generator.parseAnyFile("./templates/component.ts.mtr", {
    name: "button",
    folder: "ui",
});

Generator.writeFiles(files, {
    rootDir: process.cwd(),
});
```

## Publishing To npm

This repository is already set up with [`np`](https://github.com/sindresorhus/np) for releases.

Recommended release flow:

```sh
npm run build
npm run test
npm run pack:check
npm run release:preview
npm run release
```

What is configured:

- `np` is installed as a dev dependency.
- releases are expected from the `main` branch.
- the publish-safe default test command is `vitest run`.
- the package exposes the `mtrgen` binary through the `bin` field in `package.json`.

After the package is published, users can run:

```sh
npm install --global mtrgen
mtrgen generate ./template.mtr --arg name=Button
```

## CLI Package Options

If you want to grow the CLI beyond the current lightweight built-in parser, these TypeScript-friendly packages are strong options:

- `commander`: mature, very popular, built-in TypeScript types, great for classic subcommand CLIs.
- `yargs`: powerful argument parsing and help generation, especially strong for larger option-heavy CLIs.
- `citty`: modern lightweight builder from the UnJS ecosystem.
- `clipanion`: strongly typed command classes and validation-oriented command design.

For the current codebase, the shipped CLI is intentionally zero-dependency because the command surface is still small and the existing generator API is simple.

## Development

```sh
npm run build
npm run test
```
