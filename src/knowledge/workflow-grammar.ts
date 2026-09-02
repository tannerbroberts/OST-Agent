/**
 * The dialect the `Workflow` tool accepts, held where a composer can start
 * from it instead of recalling it.
 *
 * The opportunity this serves ("I compose a hundred and seventy lines before
 * the surface tells me it does not accept that dialect") has two rejections on
 * record, both from sessions in this repository: `Script parse error:
 * Unexpected token (172:33)` and `(24:12)`. The refusal text lists TypeScript
 * syntax as the usual cause. Neither script contained any. Both rejections are
 * a backtick inside a template-literal prompt — "`done`", "`inputSchema`" —
 * which ends the string at the first one. That finding shaped the skeleton: it
 * shows prose that quotes code in a double-quoted string, and the grammar below
 * names the mistake the corpus actually recorded rather than the one the
 * refusal guesses at.
 *
 * **The parser.** The surface's refusal reads `Unexpected token (line:col)`,
 * which is acorn's message format to the character (V8 says `Unexpected token
 * ':'` and reports a line only). The wording varies by construct — an
 * `interface` gets `The keyword 'interface' is reserved (2:0)` — and the
 * `(line:col)` suffix is the constant. Run with `sourceType: "module"`, top-level
 * `await` and top-level `return` — the tool's own documented examples use both
 * — acorn reproduces both recorded rejections at the recorded column, and
 * `test/skill/skeleton-validity.test.ts` pins it there: every Workflow
 * submission in the corrections corpus whose refusal names a position must be
 * refused by {@link parseWorkflowScript} at that position. That is the drift
 * check the assumption test asks for, made against the only evidence the
 * surface hands out — its refusals. It is not a claim of identity: a construct
 * the surface accepts and acorn does not (or the reverse) would only show up
 * here once a refusal records it. The corpus holds no *accepted* submission,
 * so the positive direction rests on the tool's documentation alone.
 *
 * **The skeleton** is generated (`npm run gen:skill` writes
 * `.claude/workflows/skeleton.js`) and drift-tested byte for byte, the same
 * pattern that keeps `SKILL.md` from going stale, because a stale skeleton
 * teaches a dialect the surface has moved off — confidently, which is the
 * failure the opportunity is about pointed the other way. The generator refuses
 * to write one that {@link skeletonProblems} finds fault with.
 *
 * **What a skeleton cannot do.** It constrains the parts it shows and says
 * nothing about the parts it does not; a composer extending past the example
 * is guessing again. Whether a starting template narrows what gets composed is
 * a behavioural claim no test here can see.
 *
 * **The published grammar** ({@link renderWorkflowGrammar}) is the rest of that
 * answer: every construct offered and every construct rejected, written out at
 * `docs/reference/workflow-grammar.md` where a composer can read it before
 * writing a line. It is generated and drift-tested by the same route as the
 * skeleton, and the generator refuses to publish one whose claims about the
 * parser the parser itself contradicts ({@link rejectClaimProblems}). What it
 * cannot be is what the node it serves asks for — the *surface* publishing its
 * grammar. The surface publishes nothing; this is a reconstruction a consumer
 * maintains, and it can only be checked against refusals already issued.
 */
import * as acorn from "acorn";

/**
 * How a submission is parsed. Module goal because a script must begin with
 * `export const meta`; `await` and `return` allowed at the top level because
 * the tool's own examples use both and both recorded composers did.
 */
export const WORKFLOW_PARSE_OPTIONS: acorn.Options = {
  ecmaVersion: "latest",
  sourceType: "module",
  allowAwaitOutsideFunction: true,
  allowReturnOutsideFunction: true,
  locations: true,
};

export type WorkflowParse =
  | { ok: true; program: acorn.Program; comments: readonly acorn.Comment[] }
  | { ok: false; message: string; line: number; column: number };

/** Parse a script as the surface would; the failure carries acorn's message, which is the surface's. */
export function parseWorkflowScript(source: string): WorkflowParse {
  const comments: acorn.Comment[] = [];
  try {
    const program = acorn.parse(source, { ...WORKFLOW_PARSE_OPTIONS, onComment: comments });
    return { ok: true, program, comments };
  } catch (err) {
    const e = err as { message?: string; loc?: { line: number; column: number } };
    return { ok: false, message: e.message ?? String(err), line: e.loc?.line ?? 0, column: e.loc?.column ?? 0 };
  }
}

/** The refusal the surface issues for a script that does not parse, reconstructed from the same message. */
export function refusalFor(parse: WorkflowParse): string | null {
  return parse.ok ? null : `Script parse error: ${parse.message}`;
}

/**
 * The source with every comment blanked to spaces, positions preserved. The
 * construct and rejection checks run over this rather than the raw text, so
 * a comment that *mentions* `Date.now()` to warn against it does not read as
 * a use of it, and a comment that mentions `agent()` does not read as an
 * example of it.
 */
export function codeOnly(source: string, comments: readonly acorn.Comment[]): string {
  let out = source;
  for (const c of comments) {
    if (c.start === undefined || c.end === undefined) continue;
    const blank = out.slice(c.start, c.end).replace(/[^\n]/g, " ");
    out = out.slice(0, c.start) + blank + out.slice(c.end);
  }
  return out;
}

export interface WorkflowConstruct {
  readonly name: string;
  /** The construct in the tool's own terms. */
  readonly what: string;
  /** Matches the skeleton's code iff it shows the construct. */
  readonly evidence: RegExp;
}

/**
 * Every construct the surface offers, each with the evidence that the skeleton
 * shows it. The list is read off the tool's description; a skeleton showing a
 * subset silently narrows what gets composed, which is why the check is "one
 * of each" rather than "parses".
 */
export const WORKFLOW_CONSTRUCTS: readonly WorkflowConstruct[] = [
  { name: "meta", what: "`export const meta = {…}` as the first statement", evidence: /export const meta = \{/ },
  { name: "meta.phases", what: "one `phases` entry per `phase()` call, titles matched exactly", evidence: /phases: \[/ },
  { name: "phase()", what: "start a progress group", evidence: /^phase\('\w+'\)$/m },
  { name: "log()", what: "a narrator line for the user", evidence: /^\s*log\('/m },
  { name: "agent()", what: "spawn a subagent; its final text is the return value", evidence: /\bagent\(/ },
  { name: "agent() schema", what: "a JSON Schema that makes agent() return a validated object", evidence: /schema: [A-Z_]+/ },
  { name: "agent() label", what: "the display label for one call", evidence: /label: '/ },
  { name: "agent() phase", what: "an explicit progress group inside pipeline()/parallel()", evidence: /, phase: '/ },
  { name: "agent() effort", what: "a per-call reasoning-effort override", evidence: /effort: '(?:low|medium|high|xhigh|max)'/ },
  { name: "pipeline()", what: "each item through every stage with no barrier", evidence: /await pipeline\(/ },
  { name: "stage signature", what: "a later stage receives (previousResult, originalItem, index)", evidence: /\(\w+, \w+, index\) =>/ },
  { name: "parallel()", what: "thunks run concurrently; a barrier", evidence: /\bparallel\(/ },
  { name: "thunk", what: "parallel() takes `() => …`, not promises", evidence: /\(\) =>/ },
  { name: ".then()", what: "carry the item alongside the agent's answer", evidence: /\)\.then\(/ },
  { name: ".filter(Boolean)", what: "a skipped or dead agent resolves to null", evidence: /\.filter\(Boolean\)/ },
  { name: "args", what: "the value passed as Workflow's `args`, undefined if none", evidence: /\bargs\b/ },
  { name: "budget.total", what: "the turn's token target, null when none was set", evidence: /budget\.total/ },
  { name: "budget.remaining()", what: "Infinity when no target was set, so guard on total", evidence: /budget\.remaining\(\)/ },
  { name: "workflow()", what: "run a saved workflow inline; throws on an unknown name", evidence: /await workflow\('/ },
  { name: "top-level await", what: "the body runs in an async context", evidence: /^const \w+ = await /m },
  { name: "top-level return", what: "the return value is the workflow's result", evidence: /^return \{/m },
  {
    name: "prose that quotes code",
    what: "backticks inside a double-quoted string — the form both recorded rejections got wrong",
    evidence: /"[^"\n]*`[^"\n]*`[^"\n]*"/,
  },
];

export interface WorkflowReject {
  readonly name: string;
  readonly why: "the parser refuses it" | "it parses, then throws when the script runs";
  /** Must not match the skeleton's code. Absent only when no pattern can name the construct. */
  readonly pattern?: RegExp;
  /** A whole script the parser must refuse — the control that proves the parser is one. */
  readonly sample?: string;
}

const META_LINE = "export const meta = { name: 'sample', description: 'a control' }\n";

/**
 * What a submission may not contain. The first group is what the parser
 * refuses; the second parses and fails at run time, which a parse check cannot
 * see and the skeleton therefore has to avoid by construction.
 */
export const WORKFLOW_REJECTS: readonly WorkflowReject[] = [
  {
    name: "a backtick inside a template-literal prompt",
    why: "the parser refuses it",
    sample: `${META_LINE}const found = await agent(\`List every claim about \`done\` in this file.\`)\nreturn { found }\n`,
  },
  {
    name: "a type annotation",
    why: "the parser refuses it",
    pattern: /\b(?:const|let|var)\s+\w+\s*:\s*\w|\(\s*\w+\s*:\s*\w|\)\s*:\s*\w+\s*=>/,
    sample: `${META_LINE}const count: number = 1\nreturn { count }\n`,
  },
  {
    name: "an interface",
    why: "the parser refuses it",
    pattern: /^\s*(?:export\s+)?interface\s+\w+/m,
    sample: `${META_LINE}interface Finding { file: string }\nreturn {}\n`,
  },
  {
    name: "a generic type parameter on a function",
    why: "the parser refuses it",
    pattern: /\bfunction\s+\w*\s*<\s*[A-Z]\w*(?:\s*,\s*[A-Z]\w*)*\s*>\s*\(/,
    sample: `${META_LINE}function pick<T>(xs) { return xs[0] }\nreturn { first: pick(args) }\n`,
  },
  {
    // Found by this module's own controls: `agent<Finding>('…')` is legal
    // JavaScript — the comparison chain `agent < Finding > ('…')` — so the
    // parser passes it and the script dies on the undefined identifier.
    // The refusal text's "generics" is only half a parser matter.
    name: "a type argument on a call",
    why: "it parses, then throws when the script runs",
    pattern: /\w<\s*[A-Z]\w*(?:\s*,\s*[A-Z]\w*)*\s*>\s*\(/,
  },
  {
    name: "an `as` cast",
    why: "the parser refuses it",
    pattern: /\)\s+as\s+\w+|\bas\s+const\b/,
    sample: `${META_LINE}const SCHEMA = { type: 'object' } as const\nreturn { SCHEMA }\n`,
  },
  { name: "an `import`", why: "it parses, then throws when the script runs", pattern: /^\s*import\b/m },
  { name: "a `require()`", why: "it parses, then throws when the script runs", pattern: /\brequire\(/ },
  { name: "`Date.now()`", why: "it parses, then throws when the script runs", pattern: /Date\.now\(\)/ },
  { name: "`Math.random()`", why: "it parses, then throws when the script runs", pattern: /Math\.random\(\)/ },
  { name: "an argless `new Date()`", why: "it parses, then throws when the script runs", pattern: /new Date\(\)/ },
];

export interface RecordedRefusal {
  /** The session the submission and its refusal were captured in. */
  readonly session: string;
  /** The refusal text the surface returned, without the `Script parse error: ` prefix. */
  readonly message: string;
  readonly line: number;
  readonly column: number;
  /** Which {@link WORKFLOW_REJECTS} entry the submission actually tripped. */
  readonly cause: string;
}

/**
 * Every refusal the surface has issued against this repository.
 *
 * This is the entire published record of what the surface does NOT accept —
 * there is no other. It is held here as data so the grammar can cite it and
 * `test/skill/published-grammar.test.ts` can check every field back against
 * `test/fixtures/corrections`; a refusal the corpus gains and this list does not
 * carry is the divergence the citation exists to catch.
 */
export const RECORDED_REFUSALS: readonly RecordedRefusal[] = [
  {
    session: "4ff7b605",
    message: "Unexpected token (172:33)",
    line: 172,
    column: 33,
    cause: "a backtick inside a template-literal prompt",
  },
  {
    session: "516fdfb8",
    message: "Unexpected token (24:12)",
    line: 24,
    column: 12,
    cause: "a backtick inside a template-literal prompt",
  },
];

/**
 * What each entry in {@link WORKFLOW_REJECTS} claims about the parser, checked
 * against the parser.
 *
 * An entry that says "the parser refuses it" is a testable claim, and the test
 * is to run its sample: publishing a grammar whose refusal list the parser
 * disagrees with teaches a dialect nobody enforces, which is the same failure as
 * teaching none — with the authority of a document. The generator refuses to
 * write a grammar this finds fault with, so an acorn upgrade that starts
 * accepting `as const` turns into a red generator rather than a stale page.
 *
 * The reverse direction is unavailable: "it parses, then throws when the script
 * runs" cannot be checked here, because running a submission means submitting
 * one, which is the cost this whole node exists to remove.
 */
export function rejectClaimProblems(rejects: readonly WorkflowReject[] = WORKFLOW_REJECTS): string[] {
  const problems: string[] = [];
  for (const r of rejects) {
    if (r.why === "the parser refuses it") {
      if (!r.sample) {
        problems.push(`"${r.name}" claims the parser refuses it and carries no sample to show it`);
        continue;
      }
      const parsed = parseWorkflowScript(r.sample);
      if (parsed.ok) problems.push(`"${r.name}" claims the parser refuses it, but the parser accepts its sample`);
      continue;
    }
    if (r.sample && !parseWorkflowScript(r.sample).ok) {
      problems.push(`"${r.name}" claims it parses and then throws, but the parser refuses its sample`);
    }
  }
  return problems;
}

/** The refusal the parser issues for a reject's sample, for the grammar to quote. */
export function refusalForReject(reject: WorkflowReject): string | null {
  return reject.sample ? refusalFor(parseWorkflowScript(reject.sample)) : null;
}

/**
 * The address the grammar is published at, relative to the repository root,
 * carried here so the document can name where it is and the skeleton can point
 * at it. `scripts/gen-skill.ts` resolves it against the repo and writes it.
 */
export const WORKFLOW_GRAMMAR_ADDRESS = "docs/reference/workflow-grammar.md";

/** Where the composer is sent for a legal starting shape, named by both artefacts. */
export const WORKFLOW_SKELETON_ADDRESS = ".claude/workflows/skeleton.js";

/**
 * The accepted grammar as a document: every construct the surface offers, every
 * construct it rejects, and the refusal each rejected one earns — obtainable by
 * reading a committed file, with nothing submitted and nothing run.
 *
 * **Why a document and not only a skeleton.** The skeleton constrains the parts
 * it shows and says nothing about the parts it does not, so a composer that
 * extends past the example is guessing again. This is the rest: it costs a read
 * and it is complete over both lists rather than over one example of each.
 *
 * **What it is not.** The surface does not publish a grammar — the node this
 * serves is named for a surface that does, and no such surface exists here. This
 * is a *reconstruction*, assembled from the tool's own description, the parser
 * {@link parseWorkflowScript} runs, and {@link RECORDED_REFUSALS}. It can only
 * be checked against refusals the surface has already issued, so it can go stale
 * in the accepting direction — a construct the surface quietly started allowing
 * — with nothing here able to notice. The document says so in its own body
 * rather than leaving a reader to infer it.
 *
 * Takes no argument on purpose: obtaining the grammar must not require handing
 * anything over, and a signature that asked for a script would be the thing this
 * replaces wearing a friendlier name.
 */
export function renderWorkflowGrammar(): string {
  // How the suite spots the construct in a source file, or that it cannot: an
  // unterminated template literal has no pattern that reads it, and saying so
  // is the difference between a rule this repository can check for a composer
  // and one the composer has to hold themselves.
  const recognition = (r: WorkflowReject): string =>
    r.pattern
      ? `Recognised in this repository by \`${String(r.pattern)}\`.`
      : "No pattern recognises this in a source file — only the parser catches it.";
  const parserRefuses = WORKFLOW_REJECTS.filter((r) => r.why === "the parser refuses it");
  const runtimeThrows = WORKFLOW_REJECTS.filter((r) => r.why !== "the parser refuses it");
  const options = Object.entries(WORKFLOW_PARSE_OPTIONS).map(([k, v]) => `- \`${k}\`: \`${String(v)}\``);

  const lines: string[] = [
    "# The dialect the `Workflow` tool accepts",
    "",
    "GENERATED from `src/knowledge/workflow-grammar.ts` by `npm run gen:skill` — do not edit by",
    "hand. `test/skill/published-grammar.test.ts` fails if the committed copy goes stale, and the",
    "generator refuses to write one whose claims about the parser are false.",
    "",
    "Read this before composing a `Workflow` script. Obtaining it requires **submitting nothing**:",
    "it is a file in this repository, rendered from the same module the suite parses submissions",
    "with. Every construct below is named here so that no one has to provoke a refusal to learn it,",
    "which is how these rules were obtainable before this page existed.",
    "",
    "## Where to get it",
    "",
    `- **This page** — \`${WORKFLOW_GRAMMAR_ADDRESS}\`. The complete list of what is accepted and what is not.`,
    `- **A legal starting shape** — \`${WORKFLOW_SKELETON_ADDRESS}\`. Copy it, keep the dialect, replace the prompts.`,
    "- **In code** — `renderWorkflowGrammar()` from `src/knowledge/workflow-grammar.ts`, which takes no",
    "  argument, because obtaining the grammar must not cost a submission.",
    "",
    "The skeleton is the shorter answer and the one to start from. This page is what it cannot be:",
    "a skeleton constrains the parts it shows and is silent about the rest, and the rest is below.",
    "",
    "## How a submission is parsed",
    "",
    "Plain JavaScript, as a module. The parse options this repository holds the surface to:",
    "",
    ...options,
    "",
    "A script that does not parse comes back as `Script parse error: <message> (line:column)`. The",
    "wording varies by construct — an `interface` earns `The keyword 'interface' is reserved` — and",
    "the `(line:column)` suffix is the constant every refusal carries.",
    "",
    "## `meta` comes first",
    "",
    "Every script begins with `export const meta = {…}` as its **first statement**, and the object is",
    "a **pure literal**: no variables, calls, spreads or template interpolation. `name` and",
    "`description` are required. `phases` is optional; one entry per `phase()` call, titles matched",
    "exactly.",
    "",
    "## The constructs the surface offers",
    "",
    "| construct | what it is |",
    "| --- | --- |",
    ...WORKFLOW_CONSTRUCTS.map((c) => `| \`${c.name}\` | ${c.what} |`),
    "",
    `The skeleton shows one example of each of these ${WORKFLOW_CONSTRUCTS.length}, which is what`,
    "`test/skill/skeleton-validity.test.ts` holds it to.",
    "",
    "## What the surface rejects",
    "",
    "Two groups, because they fail at different moments and only the first is visible to a parse",
    "check. Each example below is a whole script; the refusal beneath it is what this repository's",
    "parser answers with today.",
    "",
    "### Refused by the parser — the submission never runs",
    "",
  ];

  for (const r of parserRefuses) {
    lines.push(`#### ${r.name}`, "");
    if (r.sample) {
      lines.push("```js", ...r.sample.trimEnd().split("\n"), "```", "");
      lines.push(`Refused: \`${refusalForReject(r)}\``, "");
    }
    lines.push(recognition(r), "");
  }

  lines.push(
    "### Parses, then throws when the script runs",
    "",
    "These are legal JavaScript, so no parse check catches them — including the one the suite runs.",
    "They are listed because the only other way to learn them is a submission that starts, spends",
    "tokens and dies.",
    "",
  );

  for (const r of runtimeThrows) {
    lines.push(`#### ${r.name}`, "", recognition(r), "");
  }

  lines.push(
    "`Date.now()`, `Math.random()` and an argless `new Date()` are absent for a reason worth knowing",
    "before working around them: they would break resume. Pass timestamps in through `args`, and vary",
    "an agent's prompt or label by index where you would have reached for randomness.",
    "",
    "## Every refusal this surface has issued on record",
    "",
    "| session | refusal | what it actually was |",
    "| --- | --- | --- |",
    ...RECORDED_REFUSALS.map((r) => `| \`${r.session}\` | \`Script parse error: ${r.message}\` | ${r.cause} |`),
    "",
    "Both refusals name TypeScript syntax as the usual cause. Neither script contained any: both are",
    "a backtick inside a template-literal prompt, which ends the string at the first one — a hundred",
    "and seventy-two lines in, for the first of them. Prose that quotes code goes in a double-quoted",
    "string.",
    "",
    "## What this page cannot promise",
    "",
    "- **The surface does not publish a grammar; this is a reconstruction.** It is assembled from the",
    "  tool's description, the parser this repository runs, and the refusals above — not from",
    "  anything the surface hands out.",
    "- **It can only be checked against refusals already issued.** A construct the surface quietly",
    "  began accepting, or quietly stopped, shows up here only once a refusal records it. The drift",
    "  check is real in that direction and absent in the other.",
    "- **The runtime group is unverifiable from here.** Checking that `require()` throws means running",
    "  a submission, which is the cost this page exists to remove.",
    "- **A grammar nobody opens changes nothing.** Writing TypeScript into a JavaScript-only file is a",
    `  habit rather than a knowledge gap, and habits do not consult references — which is why \`${WORKFLOW_SKELETON_ADDRESS}\``,
    "  exists alongside this page and is the thing to copy.",
  );

  return `${lines.join("\n")}\n`;
}

/**
 * The criterion for the published grammar, as a function, so the generator and
 * the drift test run the same code. Empty means every construct and every
 * rejected construct is named, each parser refusal is quoted as the parser
 * currently issues it, every recorded refusal is cited, and the page says where
 * it can be had without submitting anything.
 *
 * It deliberately does NOT check that the page is free of the constructs it
 * rejects: a grammar has to show the mistakes, which is the one way it differs
 * from {@link skeletonProblems}.
 */
export function grammarProblems(doc: string): string[] {
  const problems: string[] = [];
  const missing = (what: string, needle: string) => {
    if (!doc.includes(needle)) problems.push(`${what} is not in the published grammar: ${needle}`);
  };

  for (const c of WORKFLOW_CONSTRUCTS) {
    missing("a construct the surface offers", c.name);
    missing(`the description of \`${c.name}\``, c.what);
  }
  for (const r of WORKFLOW_REJECTS) {
    missing("a construct the surface rejects", r.name);
    if (r.pattern) missing(`the pattern that recognises ${r.name}`, String(r.pattern));
    const refusal = refusalForReject(r);
    if (refusal) missing(`the refusal the parser issues for ${r.name}`, refusal);
  }
  for (const r of RECORDED_REFUSALS) {
    missing("a refusal on record", r.session);
    missing("the position of a refusal on record", r.message);
  }
  for (const [key, value] of Object.entries(WORKFLOW_PARSE_OPTIONS)) {
    missing("a parse option the submission is judged under", `\`${key}\`: \`${String(value)}\``);
  }
  missing("its own address", WORKFLOW_GRAMMAR_ADDRESS);
  missing("the skeleton it sits beside", WORKFLOW_SKELETON_ADDRESS);
  missing("the promise that obtaining it costs no submission", "submitting nothing");
  missing("the `meta` rule", "pure literal");
  problems.push(...rejectClaimProblems());
  return problems;
}

/** A meta value is a literal, an array of literals, or an object of literals — nothing computed. */
function isPureLiteral(node: acorn.AnyNode): boolean {
  switch (node.type) {
    case "Literal":
      return true;
    case "TemplateLiteral":
      return node.expressions.length === 0;
    case "UnaryExpression":
      return (node.operator === "-" || node.operator === "+") && node.argument.type === "Literal";
    case "ArrayExpression":
      return node.elements.every((el) => el !== null && el.type !== "SpreadElement" && isPureLiteral(el));
    case "ObjectExpression":
      return node.properties.every(
        (p) => p.type === "Property" && !p.computed && p.kind === "init" && !p.shorthand && isPureLiteral(p.value),
      );
    default:
      return false;
  }
}

/**
 * The `meta` rules the tool states: first statement, `export const`, a PURE
 * LITERAL object, `name` and `description` present. "Begins with" is held
 * textually as well as structurally — no recorded submission says whether a
 * leading comment is tolerated, so the skeleton does not find out.
 */
export function metaProblems(source: string, program: acorn.Program): string[] {
  const problems: string[] = [];
  if (!/^export const meta = \{/.test(source)) {
    problems.push("the script does not begin with `export const meta = {` — the tool says every script must");
  }
  const first = program.body[0];
  if (
    !first ||
    first.type !== "ExportNamedDeclaration" ||
    !first.declaration ||
    first.declaration.type !== "VariableDeclaration" ||
    first.declaration.kind !== "const"
  ) {
    problems.push("the first statement is not `export const meta`");
    return problems;
  }
  const declarator = first.declaration.declarations.find((d) => d.id.type === "Identifier" && d.id.name === "meta");
  if (!declarator || !declarator.init) {
    problems.push("the first statement exports something other than `meta`");
    return problems;
  }
  if (declarator.init.type !== "ObjectExpression") {
    problems.push("`meta` is not an object literal");
    return problems;
  }
  if (!isPureLiteral(declarator.init)) {
    problems.push("`meta` is not a pure literal — no variables, function calls, spreads or template interpolation");
  }
  const keys = new Set(
    declarator.init.properties.flatMap((p) =>
      p.type === "Property" && !p.computed && p.key.type === "Identifier" ? [p.key.name] : [],
    ),
  );
  for (const required of ["name", "description"]) {
    if (!keys.has(required)) problems.push(`\`meta\` has no \`${required}\`, which the tool requires`);
  }
  return problems;
}

/**
 * The criterion as a function, so the generator, the drift test and the
 * test's mutation controls all run the same code. Empty means the script is a
 * legal skeleton: it parses as a submission would, its `meta` obeys the tool's
 * rules, it shows every construct, and it contains nothing the surface refuses
 * or the runtime throws on.
 */
export function skeletonProblems(source: string): string[] {
  const parsed = parseWorkflowScript(source);
  if (!parsed.ok) return [`does not parse: ${refusalFor(parsed)}`];
  const problems = metaProblems(source, parsed.program);
  const code = codeOnly(source, parsed.comments);
  for (const c of WORKFLOW_CONSTRUCTS) {
    if (!c.evidence.test(code)) problems.push(`shows no example of ${c.name} — ${c.what}`);
  }
  for (const r of WORKFLOW_REJECTS) {
    if (r.pattern && r.pattern.test(code)) problems.push(`contains ${r.name}, which ${r.why}`);
  }
  return problems;
}

/**
 * The skeleton: plain JavaScript, `meta` first, one example of every construct
 * in {@link WORKFLOW_CONSTRUCTS}, none of {@link WORKFLOW_REJECTS}. Run by name
 * with no `args` it spawns nothing and returns, so it can be run against the
 * live tool as a free parse check. Held as lines rather than a template
 * literal because it contains backticks on purpose — the same trap it warns
 * about would otherwise be waiting in the generator.
 */
export function renderWorkflowSkeleton(): string {
  const lines = [
    "export const meta = {",
    "  name: 'skeleton',",
    "  description: 'A legal starting shape for a workflow: copy it, keep the dialect, replace the prompts',",
    "  whenToUse: 'Read this before composing a Workflow script from nothing',",
    "  phases: [",
    "    { title: 'Find', detail: 'one finder per item in args' },",
    "    { title: 'Verify', detail: 'one sceptic per finding, as soon as its finder returns' },",
    "    { title: 'Synthesize', detail: 'one agent over everything that survived' },",
    "  ],",
    "}",
    "",
    "// ---------------------------------------------------------------------------",
    "// Workflow skeleton: the dialect the Workflow tool accepts, one example of each",
    "// construct it offers. GENERATED from src/knowledge/workflow-grammar.ts by",
    "// `npm run gen:skill` — do not edit by hand. test/skill/skeleton-validity.test.ts",
    "// parses this file with the same parser class that judges a submission, pinned",
    "// to the column of every rejection that parser has issued on record.",
    "//",
    "// Plain JavaScript only: no type annotations, no interface, no generics, no",
    "// import. Three calls parse but throw when the script runs and are absent here",
    "// for that reason: the clock, the random source and the argless date",
    "// constructor (they would break resume — pass timestamps in through args).",
    "//",
    "// Both rejections on record were the same mistake, and it was not TypeScript:",
    "// a backtick inside a template-literal prompt ends the string. Prose that",
    "// quotes code goes in a double-quoted string, as the first agent() call shows.",
    "//",
    "// Run by name with no args this script spawns nothing and returns at once, so",
    "// running it is a free check that it still parses on the live tool.",
    "//",
    "// This shows one example of each construct and is silent about everything past",
    `// them. The full accepted grammar — every construct offered, every construct`,
    `// rejected, and the refusal each one earns — is ${WORKFLOW_GRAMMAR_ADDRESS},`,
    "// which costs a read and no submission.",
    "// ---------------------------------------------------------------------------",
    "",
    "// The body runs in an async context: await is legal at the top level, and so",
    "// is return. args is whatever the caller passed, undefined when nothing was.",
    "if (!Array.isArray(args) || args.length === 0) {",
    "  log('skeleton: no args, so nothing to fan out over — pass an array of items')",
    "  return { skeleton: true, items: 0 }",
    "}",
    "",
    "// A JSON Schema makes agent() return a validated object instead of free text.",
    "const FINDINGS = {",
    "  type: 'object',",
    "  properties: {",
    "    findings: {",
    "      type: 'array',",
    "      items: {",
    "        type: 'object',",
    "        properties: { file: { type: 'string' }, claim: { type: 'string' } },",
    "        required: ['file', 'claim'],",
    "      },",
    "    },",
    "  },",
    "  required: ['findings'],",
    "}",
    "",
    "const VERDICT = {",
    "  type: 'object',",
    "  properties: { real: { type: 'boolean' }, reason: { type: 'string' } },",
    "  required: ['real', 'reason'],",
    "}",
    "",
    "phase('Find')",
    "",
    "// pipeline(): every item flows through every stage on its own, with no barrier",
    "// between stages. A later stage receives (previousResult, originalItem, index).",
    "const verified = await pipeline(",
    "  args,",
    "  (item, _same, index) =>",
    "    agent(",
    "      // A prompt that quotes code is a double-quoted string. Inside a template",
    "      // literal the backticks around done and input_schema would end it at the",
    "      // first one — the rejection both recorded composers got.",
    '      "Read " + item + " and list every claim it makes about `done` or `input_schema`.",',
    "      { label: 'find:' + index, phase: 'Find', schema: FINDINGS },",
    "    ),",
    "  (found, item) =>",
    "    // parallel(): runs thunks concurrently and waits for all of them — a",
    "    // barrier. A thunk that throws resolves to null, so filter before trusting.",
    "    parallel(",
    "      found.findings.map((f) => () =>",
    "        agent(",
    "          'Try to refute this claim about ' + item + ': ' + f.claim + '. If unsure, answer real=false.',",
    "          { label: 'verify:' + f.file, phase: 'Verify', schema: VERDICT, effort: 'low' },",
    "        ).then((verdict) => ({ ...f, item, verdict })),",
    "      ),",
    "    ),",
    ")",
    "",
    "// pipeline() drops an item whose stage threw to null, and parallel() does the",
    "// same per thunk, so both layers are filtered before anything reads them.",
    "const confirmed = verified",
    "  .filter(Boolean)",
    "  .flat()",
    "  .filter(Boolean)",
    "  .filter((f) => f.verdict && f.verdict.real)",
    "",
    "log('skeleton: ' + confirmed.length + ' finding(s) survived verification')",
    "",
    "phase('Synthesize')",
    "",
    "// budget: the turn's token target. total is null when none was set and",
    "// remaining() is then Infinity, so guard on total before scaling work to it.",
    "if (budget.total && budget.remaining() < 20000) {",
    "  log('skeleton: budget nearly spent, skipping synthesis')",
    "  return { confirmed, synthesis: null }",
    "}",
    "",
    "// workflow(): run a saved workflow inline as a sub-step. It throws on a name",
    "// it cannot resolve, so an optional child is wrapped.",
    "let related = null",
    "try {",
    "  related = await workflow('related-findings', { confirmed })",
    "} catch (err) {",
    "  log('skeleton: no related-findings workflow to run, continuing without it')",
    "}",
    "",
    "const synthesis = await agent(",
    "  'Write one paragraph summarising these confirmed findings: ' + JSON.stringify(confirmed),",
    "  { label: 'synthesize', phase: 'Synthesize' },",
    ")",
    "",
    "// The return value is the workflow's result.",
    "return { confirmed, related, synthesis }",
  ];
  return `${lines.join("\n")}\n`;
}
