# MTRGen Template Language Specification

This document defines the concrete syntax and evaluation rules implemented by the current `mtrgen-js` parser.

## 1. Scope

An MTRGen template is a text document with:

- an optional `MTRGEN` header block
- a template body made of plain text, comments, variable tags, and conditional blocks

The same expression syntax is used in the header `filename` and `path` fields and in the template body.

## 2. Processing Model

When `Parser.parseString()` evaluates a template, it processes it in this order:

1. If an `MTRGEN` header is present, parse it and collect header defaults.
2. Remove the header from the template body.
3. Remove all comment tags.
4. Evaluate conditional blocks recursively.
5. Evaluate variable tags and filter chains.

Default value precedence is:

1. explicit runtime arguments
2. inline variable defaults such as `<% $name="Button" %>`
3. header defaults from `defaults:`

## 3. Template Structure

### 3.1 Header

The optional header is delimited by these markers:

```txt
--- MTRGEN ---
...
--- /MTRGEN ---
```

Recognized top-level header fields are:

- `name`: required
- `filename`: required
- `path`: required
- `syntax`: optional
- `defaults`: optional

Example:

```txt
--- MTRGEN ---
name: component
filename: <% $name|pascalCase %>.tsx
path: src/<% $folder="components" %>
defaults:
    folder: "components"
    title: "Hello"
--- /MTRGEN ---
```

Header rules:

- `name`, `filename`, and `path` must be present and non-empty.
- `filename` and `path` are template fragments and are parsed with the same comment, condition, variable, and filter rules as the body.
- `defaults:` starts a defaults block. Every following non-empty `key: value` line until `--- /MTRGEN ---` belongs to that defaults block.
- Because of that rule, top-level header fields should appear before `defaults:`.
- Unknown top-level header fields are accepted but ignored.

### 3.2 Defaults Block

Each defaults entry is a `key: value` pair:

```txt
defaults:
    enabled: true
    retries: 3
    meta: {kind: "service", tags: ["core", "api"]}
```

Defaults block rules:

- A default value is parsed as a template literal when possible.
- If a default value is not a valid literal, it is kept as a raw string.
- Arrays and objects may span multiple lines.
- Multiline continuation continues until quotes and `[]` / `{}` pairs are balanced.

## 4. Body Syntax

The body is free-form text with embedded tags.

### 4.1 Plain Text

Any text outside tags is emitted unchanged.

### 4.2 Comments

Comment tags use `<# ... #>`:

```txt
Hello <# ignored #>world
```

Comment rules:

- Comments are removed before conditions or variables are evaluated.
- Comments may span multiple lines.
- The first `#>` closes the comment.
- Nested `<#` sequences inside a comment are treated as plain comment text, not as nested comments.

### 4.3 Variable Tags

Variable tags use `<% ... %>`:

```txt
<% $name %>
<% $user.profile.handle %>
<% $items[0] %>
<% $meta["folder"] %>
<% $meta[$field] %>
<% $title="Hello" %>
<% $name|pascalCase %>
```

A variable expression has this form:

```txt
lookup [= default] {| filter}
```

Rules:

- By default, the lookup must start with `$`.
- If the lookup resolves to `undefined`, the inline default is used when present.
- If the value is still `undefined`, the parser checks header defaults.
- In strict mode, an unresolved variable raises an error.
- In non-strict mode, an unresolved variable expands to an empty string.
- Templates may opt into legacy bare lookups with `syntax: 1` in the `MTRGEN` header.

#### Lookups

Lookups resolve against runtime arguments and may traverse nested values:

- dot access: `$user.name`
- numeric index: `$items[0]`
- quoted property index: `$meta["folder"]`, `$meta['folder']`
- bare bracket property: `$meta[folder]`
- dynamic bracket expression: `$meta[$field]`, `$items[$index]`

Lookup rules:

- The lookup base and dot segments use `[A-Za-z0-9_]+`.
- Bare bracket identifiers remain literal property names. `meta[foo]` means property `"foo"`.
- Bracket expressions may also use literals or lookups. `meta[$field]` uses the current value of `$field` as the key.
- Resolution returns `undefined` if any intermediate segment is `null`, `undefined`, or not object-like.

#### Inline Defaults

Examples:

```txt
<% $name="world" %>
<% $retries=3 %>
<% $enabled=true %>
<% $tags=["a", "b"] %>
```

Rules:

- Inline defaults use the template literal syntax from section 6.
- An empty inline default such as `<% $name= %>` evaluates to the empty string.
- In strict mode, a non-empty invalid inline default raises an error.
- In non-strict mode, a non-empty invalid inline default is treated as raw text.

#### Output Conversion

Interpolated values are stringified as follows:

- `null` and `undefined` become the empty string
- booleans become `true` or `false`
- plain objects are serialized with `JSON.stringify(value)`
- all other values use JavaScript `String(value)`

That means arrays still become comma-joined strings, while plain objects render as JSON by default.

### 4.4 Filters

Filters are chained with `|`:

```txt
<% $name|upper %>
<% $name|pascalCase %>
<% $body|truncate:120,"..." %>
<% $count|pow:2 %>
<% $title|truncate:3,""|upper %>
```

Filter rules:

- Filters are applied left to right.
- A filter call is `name` or `name:arg1,arg2,...`.
- Filter arguments are split on top-level commas only. Commas inside quotes, arrays, objects, or parentheses do not split arguments.
- Each filter argument is parsed as a literal when possible.
- If a filter argument is not a literal:
  - quoted text becomes a string with simple quote escaping
  - unquoted text is passed as a raw string token
- In strict mode, an unknown filter raises an error.
- In non-strict mode, an unknown filter leaves the value unchanged.

Built-in filters:

| Filter | Signature | Notes |
| --- | --- | --- |
| `upper` | `upper()` | Uppercase string form |
| `lower` | `lower()` | Lowercase string form |
| `upperFirst` | `upperFirst()` | Uppercase first character |
| `lowerFirst` | `lowerFirst()` | Lowercase first character |
| `first` | `first()` | First char or first array element |
| `last` | `last()` | Last char or last array element |
| `camelCase` | `camelCase()` | Lowercase first character only |
| `snakeCase` | `snakeCase()` | Insert `_` before capitals, lowercase result |
| `kebabCase` | `kebabCase()` | Normalize separators and lowercase result |
| `pascalCase` | `pascalCase()` | Capitalize words and join |
| `titleCase` | `titleCase()` | Title-case words |
| `length` | `length()` | String length or array length |
| `reverse` | `reverse()` | Reverse string or array |
| `random` | `random()` | Random char or random array element |
| `shuffle` | `shuffle()` | Shuffle string chars or array elements |
| `truncate` | `truncate(limit, suffix="...")` | Truncate string |
| `trim` | `trim(side="both")` | `side` is `left`, `right`, or `both` |
| `substring` | `substring(start, end?)` | JavaScript `substring` semantics |
| `url` | `url()` | HTML-escape selected chars and replace spaces with `-` |
| `stripTags` | `stripTags()` | Remove `<...>` substrings |
| `nl2br` | `nl2br(xhtmlSyntax=false)` | Newlines to `<br>` or `<br />` |
| `escape` | `escape()` | Basic HTML escaping |
| `unescape` | `unescape()` | Reverse of `escape()` for supported entities |
| `hash` | `hash(algorithm="md5")` | Fallback hash implementation |
| `rot13` | `rot13()` | ROT13 transform |
| `encode` | `encode(format="base64")` | `base64`, `hex`, and `url` are implemented |
| `decode` | `decode(format="base64")` | `base64`, `hex`, and `url` are implemented |
| `pow` | `pow(exp=2)` | Numeric power |
| `ceil` | `ceil()` | Numeric ceiling |
| `floor` | `floor()` | Numeric floor |
| `round` | `round()` | Numeric round |

`encode` and `decode` also accept `json` and `yaml` syntactically, but the current implementation returns `"Not implemented"` for those modes.

## 5. Conditional Blocks

Conditional blocks use `if`, `elseif`, `else`, and `endif`:

```txt
<% if $enabled %>
enabled
<% elseif $fallback === true %>
fallback
<% else %>
disabled
<% endif %>
```

Rules:

- Conditional blocks may be nested.
- `elseif` and `else` belong to the nearest unmatched `if`.
- `elseif` may appear zero or more times.
- `else` may appear at most once and only after all `elseif` branches.
- A missing `endif` raises an error.

### 5.1 Condition Expressions

Conditions support full boolean expressions with:

- parentheses for grouping
- unary negation with `!`
- boolean `&&` and `||`
- comparison operators between operands

Supported comparison operators:

- `===`
- `!==`
- `==`
- `!=`
- `<`
- `<=`
- `>`
- `>=`

Operands may be:

- literals such as `true`, `false`, `null`, numbers, strings, arrays, and objects
- lookups such as `$name`, `$user.name`, or `$items[0]`

Condition evaluation rules:

- Subexpressions without a comparison operator use JavaScript truthiness via `Boolean(value)`.
- `===` and `!==` use JavaScript strict equality.
- `==` and `!=` use JavaScript loose equality.
- `<`, `<=`, `>`, and `>=` compare numerically if both operands are finite numbers or numeric strings; otherwise they compare the string forms lexicographically.

Example:

```txt
<% if ($a === $b && $b <= $c) || !$d || !($e !== null && !$f) %>
```

### 5.2 Block Whitespace

Conditional tag handling has special whitespace behavior:

- If a control tag (`if`, `elseif`, `else`, `endif`) appears on a line preceded only by spaces or tabs, replacement starts at the beginning of that line.
- The parser also consumes one optional newline immediately following a branch tag.
- In control tags, the parser accepts arbitrary surrounding whitespace immediately after `<%` and immediately before `%>`.
- `if` and `elseif` require at least one whitespace character between the keyword and the condition expression.

This allows block tags on their own lines to disappear cleanly without leaving extra blank lines.

### 5.3 Loop Blocks

Loop blocks use `for` and `endfor`:

```txt
<% for item of $items %>
<% $item %>
<% endfor %>
```

Supported forms:

- `<% for item of $array %>`
- `<% for [item, index] of $array %>`
- `<% for [item, key] of $object %>`
- `<% for item of $object %>`
- `<% for [_, index] of $array %>`
- `<% for [_, key] of $object %>`

Loop rules:

- The first binding is always the current item value.
- The optional second binding is the array index or object key.
- `_` means “ignore this binding”.
- Arrays iterate in index order.
- Objects iterate with `Object.entries(...)` order.
- A missing `endfor` raises an error.

Loop position blocks are available inside `for` bodies:

```txt
<% for item of $items %>
<% first %>[<% endfirst %>
<% $item %><% sep %>, <% endsep %>
<% last %>]<% endlast %>
<% endfor %>
```

`empty` renders only when the iterable is empty and no iterations occur:

```txt
<% for item of $items %>
<% $item %>
<% empty %>No items<% endempty %>
<% endfor %>
```

## 6. Literal Syntax

The literal grammar is shared by:

- inline variable defaults
- header defaults, when parseable
- condition operands
- filter arguments, when parseable

Supported literal forms:

- strings: `"hello"` or `'hello'`
- numbers: `1`, `-2`, `3.14`, `6.02e23`
- booleans: `true`, `false`
- null: `null`
- arrays: `[1, "two", true, null]`
- objects: `{folder: "ui", nested: {enabled: true}}`

Literal rules:

- Strings support `\n`, `\r`, `\t`, `\\`, `\'`, and `\"`.
- Any other `\x` escape is accepted and becomes `x`.
- Object keys may be quoted strings or bare identifiers matching `[A-Za-z_][A-Za-z0-9_]*`.
- Arrays and objects do not allow trailing commas.
- Whitespace is allowed between tokens.

## 7. Strictness and Errors

The parser defaults to strict mode.

In strict mode:

- unknown variables in variable tags raise an error
- unknown filters raise an error
- invalid non-empty inline defaults raise an error
- missing `endif` raises an error

In non-strict mode:

- unknown variables interpolate as the empty string
- unknown filters are ignored
- invalid non-empty inline defaults are treated as raw text

Header defaults are an exception: unparseable default values are always preserved as raw strings instead of raising an error.

## 8. EBNF

The grammar below describes the well-formed concrete syntax. Semantic rules from sections 3 to 7 still apply.

```ebnf
template             = [ header ] , body ;

header               = header-open , linebreak ,
                       { header-line | blank-line } ,
                       header-close , { whitespace } ;

header-open          = "--- MTRGEN ---" ;
header-close         = "--- /MTRGEN ---" ;

header-line          = name-line
                     | filename-line
                     | path-line
                     | defaults-line
                     | ignored-header-line ;

name-line            = "name" , ":" , scalar-text , linebreak ;
filename-line        = "filename" , ":" , scalar-text , linebreak ;
path-line            = "path" , ":" , scalar-text , linebreak ;
defaults-line        = "defaults" , ":" , linebreak ,
                       { default-entry-line | blank-line } ;
ignored-header-line  = header-key , ":" , scalar-text , linebreak ;
default-entry-line   = indentation , default-key , ":" , default-value-text , linebreak ;

body                 = { chunk } ;
chunk                = text | comment | conditional | loop | variable-tag ;

comment              = "<#" , comment-body , "#>" ;

variable-tag         = "<%" , opt-ws , variable-expression , opt-ws , "%>" ;
variable-expression  = lookup ,
                       [ opt-ws , "=" , opt-ws , inline-default ] ,
                       { opt-ws , "|" , opt-ws , filter-call } ;
filter-call          = identifier , [ ":" , filter-arg-list ] ;
filter-arg-list      = filter-arg , { opt-ws , "," , opt-ws , filter-arg } ;
filter-arg           = literal | quoted-string | raw-filter-token ;

conditional          = if-branch ,
                       { elseif-branch } ,
                       [ else-branch ] ,
                       endif-branch ;

loop                 = for-branch , body , endfor-branch ;

if-branch            = if-tag , body ;
elseif-branch        = elseif-tag , body ;
else-branch          = else-tag , body ;

if-tag               = "<%" , opt-ws , "if" , ws , condition , opt-ws , "%>" , [ linebreak ] ;
elseif-tag           = "<%" , opt-ws , "elseif" , ws , condition , opt-ws , "%>" , [ linebreak ] ;
else-tag             = "<%" , opt-ws , "else" , opt-ws , "%>" , [ linebreak ] ;
endif-branch         = endif-tag ;
endif-tag            = "<%" , opt-ws , "endif" , opt-ws , "%>" , [ linebreak ] ;

for-branch           = for-tag ;
for-tag              = "<%" , opt-ws , "for" , ws , loop-bindings , ws , "of" , ws , condition , opt-ws , "%>" , [ linebreak ] ;
endfor-branch        = endfor-tag ;
endfor-tag           = "<%" , opt-ws , "endfor" , opt-ws , "%>" , [ linebreak ] ;

condition            = ? boolean expression using !, &&, ||, parentheses, comparisons, literals, and lookups ? ;
comparison-operator  = "===" | "!==" | "==" | "!=" | "<=" | "<" | ">=" | ">" ;
operand              = literal | lookup ;

loop-bindings        = loop-binding | "[" , opt-ws , loop-binding , opt-ws , "," , opt-ws , loop-binding , opt-ws , "]" ;
loop-binding         = identifier | "_" ;

lookup               = [ "$" ] , identifier , { lookup-segment } ;
lookup-segment       = "." , identifier
                     | "[" , opt-ws , lookup-index , opt-ws , "]" ;
lookup-index         = integer | quoted-string | raw-bracket-key | lookup ;

inline-default       = literal | raw-inline-default ;

literal              = string-literal
                     | number-literal
                     | boolean-literal
                     | null-literal
                     | array-literal
                     | object-literal ;

array-literal        = "[" , opt-ws ,
                       [ literal , { opt-ws , "," , opt-ws , literal } ] ,
                       opt-ws , "]" ;

object-literal       = "{" , opt-ws ,
                       [ object-entry , { opt-ws , "," , opt-ws , object-entry } ] ,
                       opt-ws , "}" ;

object-entry         = object-key , opt-ws , ":" , opt-ws , literal ;
object-key           = object-identifier | string-literal ;

string-literal       = single-quoted-string | double-quoted-string ;
single-quoted-string = "'" , ? characters and escapes from section 6, until the next unescaped "'" ? , "'" ;
double-quoted-string = "\"" , ? characters and escapes from section 6, until the next unescaped "\"" ? , "\"" ;
quoted-string        = string-literal ;
boolean-literal      = "true" | "false" ;
null-literal         = "null" ;
number-literal       = [ "-" ] , integer , [ "." , digit , { digit } ] ,
                       [ exponent-part ] ;
exponent-part        = ( "e" | "E" ) , [ "+" | "-" ] , digit , { digit } ;
integer              = "0" | nonzero-digit , { digit } ;

identifier           = identifier-char , { identifier-char } ;
identifier-char      = letter | digit | "_" ;

object-identifier    = object-identifier-start , { identifier-char } ;
object-identifier-start
                     = letter | "_" ;

header-key           = ? any non-empty text before ":" on a header line ? ;
default-key          = ? any non-empty text before ":" in the defaults block ? ;
scalar-text          = ? any text up to linebreak ? ;
default-value-text   = ? text parsed as a literal when possible; may continue across lines while quotes or [] / {} remain unbalanced ? ;
text                 = ? any text outside tags ? ;
comment-body         = ? any text up to the next "#>" ? ;
raw-filter-token     = ? any non-empty filter-argument token that is not parsed as a literal ? ;
raw-inline-default   = ? any non-empty inline default token accepted only in non-strict mode ? ;
raw-bracket-key      = ? any non-empty text up to "]", trimmed ? ;

blank-line           = { whitespace } , linebreak ;
indentation          = { " " | "\t" } ;
ws                   = whitespace , { whitespace } ;
opt-ws               = { whitespace } ;
whitespace           = " " | "\t" | "\r" | "\n" ;
linebreak            = "\n" | "\r\n" ;
letter               = "A"…"Z" | "a"…"z" ;
digit                = "0"…"9" ;
nonzero-digit        = "1"…"9" ;
```

## 9. Semantic Constraints Beyond EBNF

These rules are enforced by the implementation but are clearer as prose than as pure grammar:

- A variable tag must not begin with the block keywords `if`, `elseif`, `else`, `endif`, `for`, or `endfor`.
- `elseif` and `else` are only valid inside a matching `if` block.
- `else` may appear at most once within the same conditional chain.
- `endfor` is only valid inside a matching `for` block.
- Once `defaults:` appears in the header, subsequent non-empty `key: value` lines are parsed as defaults entries, not as top-level header fields.
- Filter splitting and argument splitting are top-level only. `|` and `,` inside quotes, arrays, objects, or parentheses do not act as separators.
- Bare bracket lookup segments are literal property names; quoted, numeric, and lookup-based keys are also supported.
