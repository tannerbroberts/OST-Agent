export const meta = {
  name: 'skeleton',
  description: 'A legal starting shape for a workflow: copy it, keep the dialect, replace the prompts',
  whenToUse: 'Read this before composing a Workflow script from nothing',
  phases: [
    { title: 'Find', detail: 'one finder per item in args' },
    { title: 'Verify', detail: 'one sceptic per finding, as soon as its finder returns' },
    { title: 'Synthesize', detail: 'one agent over everything that survived' },
  ],
}

// ---------------------------------------------------------------------------
// Workflow skeleton: the dialect the Workflow tool accepts, one example of each
// construct it offers. GENERATED from src/knowledge/workflow-grammar.ts by
// `npm run gen:skill` — do not edit by hand. test/skill/skeleton-validity.test.ts
// parses this file with the same parser class that judges a submission, pinned
// to the column of every rejection that parser has issued on record.
//
// Plain JavaScript only: no type annotations, no interface, no generics, no
// import. Three calls parse but throw when the script runs and are absent here
// for that reason: the clock, the random source and the argless date
// constructor (they would break resume — pass timestamps in through args).
//
// Both rejections on record were the same mistake, and it was not TypeScript:
// a backtick inside a template-literal prompt ends the string. Prose that
// quotes code goes in a double-quoted string, as the first agent() call shows.
//
// Run by name with no args this script spawns nothing and returns at once, so
// running it is a free check that it still parses on the live tool.
// ---------------------------------------------------------------------------

// The body runs in an async context: await is legal at the top level, and so
// is return. args is whatever the caller passed, undefined when nothing was.
if (!Array.isArray(args) || args.length === 0) {
  log('skeleton: no args, so nothing to fan out over — pass an array of items')
  return { skeleton: true, items: 0 }
}

// A JSON Schema makes agent() return a validated object instead of free text.
const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: { file: { type: 'string' }, claim: { type: 'string' } },
        required: ['file', 'claim'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT = {
  type: 'object',
  properties: { real: { type: 'boolean' }, reason: { type: 'string' } },
  required: ['real', 'reason'],
}

phase('Find')

// pipeline(): every item flows through every stage on its own, with no barrier
// between stages. A later stage receives (previousResult, originalItem, index).
const verified = await pipeline(
  args,
  (item, _same, index) =>
    agent(
      // A prompt that quotes code is a double-quoted string. Inside a template
      // literal the backticks around done and input_schema would end it at the
      // first one — the rejection both recorded composers got.
      "Read " + item + " and list every claim it makes about `done` or `input_schema`.",
      { label: 'find:' + index, phase: 'Find', schema: FINDINGS },
    ),
  (found, item) =>
    // parallel(): runs thunks concurrently and waits for all of them — a
    // barrier. A thunk that throws resolves to null, so filter before trusting.
    parallel(
      found.findings.map((f) => () =>
        agent(
          'Try to refute this claim about ' + item + ': ' + f.claim + '. If unsure, answer real=false.',
          { label: 'verify:' + f.file, phase: 'Verify', schema: VERDICT, effort: 'low' },
        ).then((verdict) => ({ ...f, item, verdict })),
      ),
    ),
)

// pipeline() drops an item whose stage threw to null, and parallel() does the
// same per thunk, so both layers are filtered before anything reads them.
const confirmed = verified
  .filter(Boolean)
  .flat()
  .filter(Boolean)
  .filter((f) => f.verdict && f.verdict.real)

log('skeleton: ' + confirmed.length + ' finding(s) survived verification')

phase('Synthesize')

// budget: the turn's token target. total is null when none was set and
// remaining() is then Infinity, so guard on total before scaling work to it.
if (budget.total && budget.remaining() < 20000) {
  log('skeleton: budget nearly spent, skipping synthesis')
  return { confirmed, synthesis: null }
}

// workflow(): run a saved workflow inline as a sub-step. It throws on a name
// it cannot resolve, so an optional child is wrapped.
let related = null
try {
  related = await workflow('related-findings', { confirmed })
} catch (err) {
  log('skeleton: no related-findings workflow to run, continuing without it')
}

const synthesis = await agent(
  'Write one paragraph summarising these confirmed findings: ' + JSON.stringify(confirmed),
  { label: 'synthesize', phase: 'Synthesize' },
)

// The return value is the workflow's result.
return { confirmed, related, synthesis }
