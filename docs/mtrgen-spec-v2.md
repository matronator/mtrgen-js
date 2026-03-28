# MTRGen Template Language Specification (Proposed Syntax v2)

This document describes a proposed v2 syntax for the MTRGen template language.

It is a design draft, not the currently implemented behavior.

The main design change in v2 is:

- bare words are reserved for language constructs
- variable references must start with `$`

That rule allows cleaner block syntax such as `<% first %>...<% endfirst %>` without colliding with variables named `first`.

## 1. Goals

Syntax v2 is designed to:

- make control tags visually distinct from value lookups
- avoid collisions between variable names and language keywords
- leave room for future block tags without expanding parser ambiguity
- make loop-local variables follow the same lookup rules as top-level variables

## 2. Processing Model

When `Parser.parseString()` evaluates a v2 template, it should process it in this order:

1. If an `MTRGEN` header is present, parse it and collect header defaults.
2. Read the optional `syntax: 2` header field or a parser-level `syntaxVersion` option.
3. Remove the header from the template body.
4. Remove all comment tags.
5. Evaluate control blocks recursively.
6. Evaluate value tags and filter chains.

Default value precedence remains:

1. explicit runtime arguments
2. inline defaults such as `<% $name="Button" %>`
3. header defaults from `defaults:`

## 3. Core Rule

In syntax v2:

- `$name` means "read the value of `name`"
- `if`, `for`, `first`, `last`, `sep`, and future block names are language keywords
- loop binding names remain bare in declarations only

Examples:

```txt
<% $name %>
<% if $enabled %>...<% endif %>
<% for item of $items %>...<% endfor %>
<% first %>...<% endfirst %>
```

## 4. Template Structure

### 4.1 Header

The optional header remains:

```txt
--- MTRGEN ---
...
--- /MTRGEN ---
```

Recognized top-level header fields in v2:

- `name`: required
- `filename`: required
- `path`: required
- `syntax`: optional, recommended for migration
- `defaults`: optional

Example:

```txt
--- MTRGEN ---
name: component
syntax: 2
filename: <% $name|pascalCase %>.tsx
path: src/<% $folder="components" %>
defaults:
    folder: "components"
    title: "Hello"
--- /MTRGEN ---
```

Recommended rule:

- if `syntax: 2` is present, all v2 rules apply to `filename`, `path`, and the body

### 4.2 Comments

Comments are unchanged:

```txt
<# ignored #>
```

## 5. Tag Categories

Syntax v2 has two top-level tag categories:

- value tags, which interpolate or transform data
- control tags, which alter template structure

### 5.1 Value Tags

Value tags interpolate a lookup:

```txt
<% $name %>
<% $user.profile.handle %>
<% $items[0] %>
<% $meta["folder"] %>
<% $meta[$field] %>
<% $title="Hello" %>
<% $name|pascalCase %>
```

Value-tag rule:

- the first token of a value tag must be a `$`-prefixed reference

### 5.2 Control Tags

Control tags are bare keywords:

```txt
<% if $enabled %>
<% elseif $fallback %>
<% else %>
<% endif %>

<% for item of $items %>
<% endfor %>

<% first %>
<% endfirst %>
<% last %>
<% endlast %>
<% sep %>
<% endsep %>
```

## 6. Value Tags

A value tag has this form:

```txt
$lookup [= default] {| filter}
```

Examples:

```txt
<% $name %>
<% $name="world" %>
<% $user.name|titleCase %>
<% $items[$index] %>
```

Rules:

- the lookup must start with `$`
- if the lookup resolves to `undefined`, use the inline default when present
- if the value is still `undefined`, check header defaults
- in strict mode, unresolved values raise an error
- in non-strict mode, unresolved values expand to the empty string

### 6.1 Lookups

Supported lookups:

- dot access: `$user.name`
- numeric index: `$items[0]`
- quoted property index: `$meta["folder"]`, `$meta['folder']`
- bare bracket property: `$meta[folder]`
- dynamic bracket expression: `$meta[$field]`, `$items[$index]`

Rules:

- the lookup base must begin with `$`
- bare bracket identifiers remain literal property names
- bracket expressions may also contain `$` references or literals
- resolution returns `undefined` if any intermediate segment is `null`, `undefined`, or not object-like

### 6.2 Inline Defaults

Examples:

```txt
<% $name="world" %>
<% $retries=3 %>
<% $enabled=true %>
<% $tags=["a", "b"] %>
```

Rules:

- inline defaults use the same literal syntax as today
- an empty inline default such as `<% $name= %>` evaluates to the empty string

### 6.3 Output Conversion

String conversion is unchanged:

- `null` and `undefined` become the empty string
- booleans become `true` or `false`
- plain objects are serialized with `JSON.stringify(value)`
- all other values use JavaScript `String(value)`

## 7. Expressions

Expressions are used in `if`, `elseif`, and the iterable part of `for`.

Examples:

```txt
<% if $enabled %>
<% if !$disabled %>
<% if $foo === $bar %>
<% if ($a === $b && $b <= $c) || !$d %>
<% for item of $items %>
```

Rules:

- variable references inside expressions must use `$`
- literals such as `true`, `false`, `null`, and numbers remain bare
- lookup traversal keeps the same behavior as value tags

Valid examples:

```txt
<% if true %>
<% if !$enabled %>
<% if $user.name === "john" %>
<% for item of $items %>
```

Invalid examples:

```txt
<% if enabled %>
<% if user.name === "john" %>
<% for item of items %>
```

## 8. Loops

### 8.1 Basic Loops

Loop syntax:

```txt
<% for item of $items %>
...
<% endfor %>
```

With two bindings:

```txt
<% for [item, index] of $items %>
...
<% endfor %>
```

Object iteration:

```txt
<% for [item, key] of $meta %>
...
<% endfor %>
```

Rules:

- loop bindings are declarations, so they are bare
- the iterable expression uses normal v2 expression rules, so references inside it must use `$`
- references to loop bindings inside the body must use `$`

Example:

```txt
<% for [item, index] of $items %>
  <% $index %>: <% $item.name %>
<% endfor %>
```

Invalid:

```txt
<% for $item of $items %>
<% for item of items %>
<% item %>
```

### 8.2 Loop Position Blocks

Loop position blocks are valid only inside `for`.

Supported blocks:

- `first`: render only on the first iteration
- `last`: render only on the last iteration
- `sep`: render on every iteration except the last
- `empty`: render only when the iterable has no entries

Examples:

```txt
<% for item of $items %>
  <% first %>[<% endfirst %>
  <% $item %><% sep %>, <% endsep %>
  <% last %>]<% endlast %>
<% endfor %>
```

```txt
<% for item of $items %>
  <% $item %>
  <% empty %>No items<% endempty %>
<% endfor %>
```

Rules:

- `first`, `last`, `sep`, and `empty` are reserved control keywords
- they may not appear outside a `for` block
- `empty` renders only when no iterations occur
- `first`, `last`, and `sep` are skipped when the loop is empty
- all four may nest inside `if` blocks and inside each other

## 9. Filters

Filter syntax stays the same:

```txt
<% $name|upper %>
<% $title|truncate:30,"..." %>
<% $items|length %>
```

Rules:

- filters apply left to right
- filter names remain bare
- filter arguments keep the current literal parsing rules

## 10. Grammar Sketch

EBNF-style grammar:

```ebnf
tag            = "<%" ws? statement ws? "%>" ;

statement      = value_expr
               | if_open
               | elseif_open
               | else_tag
               | endif_tag
               | for_open
               | endfor_tag
               | first_tag
               | endfirst_tag
               | last_tag
               | endlast_tag
               | sep_tag
               | endsep_tag ;

value_expr     = reference [ ws? "=" ws? default_value ] { ws? "|" ws? filter } ;

if_open        = "if" ws expression ;
elseif_open    = "elseif" ws expression ;
else_tag       = "else" ;
endif_tag      = "endif" ;

for_open       = "for" ws bindings ws "of" ws expression ;
endfor_tag     = "endfor" ;

bindings       = identifier
               | "[" ws? identifier ws? "," ws? identifier ws? "]" ;

first_tag      = "first" ;
endfirst_tag   = "endfirst" ;
last_tag       = "last" ;
endlast_tag    = "endlast" ;
sep_tag        = "sep" ;
endsep_tag     = "endsep" ;

reference      = "$" identifier { lookup } ;
lookup         = "." identifier | "[" expression_or_key "]" ;

identifier     = [A-Za-z_][A-Za-z0-9_]* ;
```

## 11. Valid and Invalid Examples

### 11.1 Value Tags

Valid:

```txt
<% $name %>
<% $name="world" %>
<% $user.profile.handle %>
<% $meta[$field] %>
```

Invalid:

```txt
<% name %>
<% user.name %>
```

Note:

```txt
<% $meta[fieldName] %>
```

is valid in v2, but `fieldName` is interpreted as the literal property key `"fieldName"`. To use the value of the variable `fieldName` as the key, write:

```txt
<% $meta[$fieldName] %>
```

Recommended error for bare value references:

```txt
Bare variable references are not allowed in syntax v2. Use "$name" instead of "name".
```

### 11.2 Conditions

Valid:

```txt
<% if $enabled %>
<% if !$enabled %>
<% if $foo === $bar %>
```

Invalid:

```txt
<% if enabled %>
<% if foo === $bar %>
```

Recommended error:

```txt
Bare variable references are not allowed in syntax v2 expressions. Use "$enabled".
```

### 11.3 Loops

Valid:

```txt
<% for item of $items %>
<% for [item, index] of $items %>
<% $item %>
<% $index %>
```

Invalid:

```txt
<% for $item of $items %>
<% for item of items %>
<% item %>
```

Recommended errors:

```txt
Loop bindings must be bare identifiers. Use "for item of $items", not "for $item of $items".
```

```txt
Bare variable references are not allowed in syntax v2. Use "$item".
```

### 11.4 Loop Position Blocks

Valid:

```txt
<% for item of $items %>
  <% first %>[<% endfirst %>
  <% $item %><% sep %>, <% endsep %>
  <% last %>]<% endlast %>
<% endfor %>
```

Invalid:

```txt
<% first %>x<% endfirst %>
<% endfirst %>
<% for item of $items %><% first %>x<% endlast %><% endfor %>
```

Recommended errors:

```txt
Unexpected <% first %> tag outside <% for %> block.
```

```txt
Unexpected <% endfirst %> tag.
```

```txt
Missing <% endfirst %> tag.
```

## 12. Migration Plan

Recommended rollout:

### Phase 1: Introduce Syntax Selection

Add one of:

- parser option: `syntaxVersion: 1 | 2 | "auto"`
- template header field: `syntax: 2`

Recommended behavior:

- syntax v1 keeps current optional-`$` behavior
- syntax v2 requires `$` for variable references
- `auto` may support both during migration, but explicit versioning is preferred

### Phase 2: Add Friendly Warnings

When the parser sees old-style v1 references during migration, surface actionable guidance:

- `<% name %>` -> `<% $name %>`
- `<% if enabled %>` -> `<% if $enabled %>`
- `<% for item of items %>` -> `<% for item of $items %>`
- `<% item %>` -> `<% $item %>`
- `<% !first %>...<% /first %>` -> `<% first %>...<% endfirst %>`

### Phase 3: Add a Codemod

A migration tool should:

- rewrite bare variable tags to `$` references
- rewrite expression references inside `if`, `elseif`, and `for`
- keep loop declarations bare
- rewrite `!first` / `!last` / `!sep` to `first` / `last` / `sep`
- preserve formatting where possible

Suggested command shape:

```sh
mtrgen migrate-syntax --to 2
```

### Phase 4: Make v2 the Default

Recommended release strategy:

- one release cycle with opt-in `syntax: 2`
- one release cycle where new templates default to v2 but v1 is still supported
- next major release removes implicit v1 parsing unless explicitly requested

## 13. Implementation Notes

This draft implies these parser changes:

- value tags must reject bare initial identifiers in v2
- expression parsing must reject bare identifiers unless they are literals or declarations
- `for` must distinguish declarations from references
- `first`, `last`, and `sep` must use `endfirst`, `endlast`, and `endsep`
- error messages should favor "did you mean `$name`?" guidance

The migration should be treated as a versioned language change, not as a silent behavior tweak.
