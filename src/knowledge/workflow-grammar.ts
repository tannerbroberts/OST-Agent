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
