# The dialect the `Workflow` tool accepts

GENERATED from `src/knowledge/workflow-grammar.ts` by `npm run gen:skill` — do not edit by
hand. `test/skill/published-grammar.test.ts` fails if the committed copy goes stale, and the
generator refuses to write one whose claims about the parser are false.

Read this before composing a `Workflow` script. Obtaining it requires **submitting nothing**:
it is a file in this repository, rendered from the same module the suite parses submissions
with. Every construct below is named here so that no one has to provoke a refusal to learn it,
which is how these rules were obtainable before this page existed.

## Where to get it

- **This page** — `docs/reference/workflow-grammar.md`. The complete list of what is accepted and what is not.
- **A legal starting shape** — `.claude/workflows/skeleton.js`. Copy it, keep the dialect, replace the prompts.
- **In code** — `renderWorkflowGrammar()` from `src/knowledge/workflow-grammar.ts`, which takes no
  argument, because obtaining the grammar must not cost a submission.

The skeleton is the shorter answer and the one to start from. This page is what it cannot be:
a skeleton constrains the parts it shows and is silent about the rest, and the rest is below.

## How a submission is parsed

Plain JavaScript, as a module. The parse options this repository holds the surface to:

- `ecmaVersion`: `latest`
- `sourceType`: `module`
- `allowAwaitOutsideFunction`: `true`
- `allowReturnOutsideFunction`: `true`
- `locations`: `true`

A script that does not parse comes back as `Script parse error: <message> (line:column)`. The
wording varies by construct — an `interface` earns `The keyword 'interface' is reserved` — and
the `(line:column)` suffix is the constant every refusal carries.

## `meta` comes first

Every script begins with `export const meta = {…}` as its **first statement**, and the object is
a **pure literal**: no variables, calls, spreads or template interpolation. `name` and
`description` are required. `phases` is optional; one entry per `phase()` call, titles matched
exactly.

## The constructs the surface offers

| construct | what it is |
| --- | --- |
| `meta` | `export const meta = {…}` as the first statement |
| `meta.phases` | one `phases` entry per `phase()` call, titles matched exactly |
| `phase()` | start a progress group |
| `log()` | a narrator line for the user |
| `agent()` | spawn a subagent; its final text is the return value |
| `agent() schema` | a JSON Schema that makes agent() return a validated object |
| `agent() label` | the display label for one call |
| `agent() phase` | an explicit progress group inside pipeline()/parallel() |
| `agent() effort` | a per-call reasoning-effort override |
| `pipeline()` | each item through every stage with no barrier |
| `stage signature` | a later stage receives (previousResult, originalItem, index) |
| `parallel()` | thunks run concurrently; a barrier |
| `thunk` | parallel() takes `() => …`, not promises |
| `.then()` | carry the item alongside the agent's answer |
| `.filter(Boolean)` | a skipped or dead agent resolves to null |
| `args` | the value passed as Workflow's `args`, undefined if none |
| `budget.total` | the turn's token target, null when none was set |
| `budget.remaining()` | Infinity when no target was set, so guard on total |
| `workflow()` | run a saved workflow inline; throws on an unknown name |
| `top-level await` | the body runs in an async context |
| `top-level return` | the return value is the workflow's result |
| `prose that quotes code` | backticks inside a double-quoted string — the form both recorded rejections got wrong |

The skeleton shows one example of each of these 22, which is what
`test/skill/skeleton-validity.test.ts` holds it to.

## What the surface rejects

Two groups, because they fail at different moments and only the first is visible to a parse
check. Each example below is a whole script; the refusal beneath it is what this repository's
parser answers with today.

### Refused by the parser — the submission never runs

#### a backtick inside a template-literal prompt

```js
export const meta = { name: 'sample', description: 'a control' }
const found = await agent(`List every claim about `done` in this file.`)
return { found }
```

Refused: `Script parse error: Unexpected token (2:51)`

No pattern recognises this in a source file — only the parser catches it.

#### a type annotation

```js
export const meta = { name: 'sample', description: 'a control' }
const count: number = 1
return { count }
```

Refused: `Script parse error: Unexpected token (2:11)`

Recognised in this repository by `/\b(?:const|let|var)\s+\w+\s*:\s*\w|\(\s*\w+\s*:\s*\w|\)\s*:\s*\w+\s*=>/`.

#### an interface

```js
export const meta = { name: 'sample', description: 'a control' }
interface Finding { file: string }
return {}
```

Refused: `Script parse error: The keyword 'interface' is reserved (2:0)`

Recognised in this repository by `/^\s*(?:export\s+)?interface\s+\w+/m`.

#### a generic type parameter on a function

```js
export const meta = { name: 'sample', description: 'a control' }
function pick<T>(xs) { return xs[0] }
return { first: pick(args) }
```

Refused: `Script parse error: Unexpected token (2:13)`

Recognised in this repository by `/\bfunction\s+\w*\s*<\s*[A-Z]\w*(?:\s*,\s*[A-Z]\w*)*\s*>\s*\(/`.

#### an `as` cast

```js
export const meta = { name: 'sample', description: 'a control' }
const SCHEMA = { type: 'object' } as const
return { SCHEMA }
```

Refused: `Script parse error: Unexpected token (2:34)`

Recognised in this repository by `/\)\s+as\s+\w+|\bas\s+const\b/`.

### Parses, then throws when the script runs

These are legal JavaScript, so no parse check catches them — including the one the suite runs.
They are listed because the only other way to learn them is a submission that starts, spends
tokens and dies.

#### a type argument on a call

Recognised in this repository by `/\w<\s*[A-Z]\w*(?:\s*,\s*[A-Z]\w*)*\s*>\s*\(/`.

#### an `import`

Recognised in this repository by `/^\s*import\b/m`.

#### a `require()`

Recognised in this repository by `/\brequire\(/`.

#### `Date.now()`

Recognised in this repository by `/Date\.now\(\)/`.

#### `Math.random()`

Recognised in this repository by `/Math\.random\(\)/`.

#### an argless `new Date()`

Recognised in this repository by `/new Date\(\)/`.

`Date.now()`, `Math.random()` and an argless `new Date()` are absent for a reason worth knowing
before working around them: they would break resume. Pass timestamps in through `args`, and vary
an agent's prompt or label by index where you would have reached for randomness.

## Every refusal this surface has issued on record

| session | refusal | what it actually was |
| --- | --- | --- |
| `4ff7b605` | `Script parse error: Unexpected token (172:33)` | a backtick inside a template-literal prompt |
| `516fdfb8` | `Script parse error: Unexpected token (24:12)` | a backtick inside a template-literal prompt |

Both refusals name TypeScript syntax as the usual cause. Neither script contained any: both are
a backtick inside a template-literal prompt, which ends the string at the first one — a hundred
and seventy-two lines in, for the first of them. Prose that quotes code goes in a double-quoted
string.

## What this page cannot promise

- **The surface does not publish a grammar; this is a reconstruction.** It is assembled from the
  tool's description, the parser this repository runs, and the refusals above — not from
  anything the surface hands out.
- **It can only be checked against refusals already issued.** A construct the surface quietly
  began accepting, or quietly stopped, shows up here only once a refusal records it. The drift
  check is real in that direction and absent in the other.
- **The runtime group is unverifiable from here.** Checking that `require()` throws means running
  a submission, which is the cost this page exists to remove.
- **A grammar nobody opens changes nothing.** Writing TypeScript into a JavaScript-only file is a
  habit rather than a knowledge gap, and habits do not consult references — which is why `.claude/workflows/skeleton.js`
  exists alongside this page and is the thing to copy.
