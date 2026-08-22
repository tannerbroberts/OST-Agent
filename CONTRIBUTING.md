# Contributing to OST-Agent

Thanks for helping keep an Opportunity Solution Tree honest. This project has a few
invariants that are load-bearing — please read the two "must" sections before a PR.

## Setup

```bash
npm install
npm test        # vitest — must be green
npm run build   # tsc → dist/
```

Node ≥ 20. TypeScript, ES modules, `NodeNext` resolution (import local files with a
`.js` extension even though the source is `.ts`).

## The safety invariant (do not break this)

OST-Agent's guarantee is that it holds **no destructive capability**. The complete,
closed tool allowlist lives in `src/security/policy.ts` (`ALLOWED_TOOL_NAMES`), and
`assertNoDestructiveTool` fail-closes on anything outside it or anything whose name
smells destructive.

- **Never add a tool that deletes, edits-in-place, renames, force-pushes, or shells
  out.** Corrections are new commits; hygiene is `annotate`, not delete.
- Adding a tool means: add it to `ALLOWED_TOOL_NAMES`, build it in
  `src/security/tools.ts`, and — if it should be reachable from a Claude Code session —
  add it to `MCP_TOOL_NAMES` in `src/mcp/server.ts` (read-only tools go in `READ_ONLY`
  so they aren't auto-committed). The policy + MCP-surface tests will hold you to it.

## The skill is generated (do not hand-edit)

`.claude/skills/opportunity-solution-tree/SKILL.md` is rendered from `OST_RULESET`
(`src/knowledge/ruleset.ts`) by `scripts/gen-skill.ts`. If you change the ruleset, run:

```bash
npm run gen:skill
```

`test/skill/drift.test.ts` fails the build if the committed skill is stale, so the
standalone agent and the Claude-Code path never drift.

## Adding a read-only source (adapter)

Mirror `src/adapters/atlassian.ts` / `src/adapters/slack.ts`:

- implement `Source` with an **injected client** so the cursor/mapping logic is tested
  offline against a fake, and a real HTTP client tested with an injected `fetch`;
- every request is a **GET** — adapters read the business, they never write back. This
  is not a habit to keep: build the client's transport with `getOnlyFetch()` from
  `src/adapters/get-only-client.ts` and never reach `globalThis.fetch` yourself, so a
  write is refused in this process rather than by whatever scope the operator's token
  turned out to have. `test/adapters/get-only-client.test.ts` reads the client list off
  this directory, so a new `Http…Client` fails the build until it is covered there;
- read secrets from env in `src/runner/context.ts`; never write them into the vault.

## Tests & style

- Add tests next to the behavior you change; keep the suite deterministic and offline
  (no live network, no real API keys). `Date.now()`/randomness make tests flaky — pass
  fixed inputs.
- Match the surrounding comment density and naming.

## Releasing

Maintainers: see [`RELEASING.md`](RELEASING.md). Bump `package.json` **and**
`src/index.ts` `VERSION` together (a test enforces the pair), update `CHANGELOG.md`,
tag, and publish a GitHub Release (the `npm-publish` workflow does the rest).

## Commits

Conventional-commit style (`feat:`, `fix:`, `docs:`, `chore:`). Keep each commit
green (`npm test` + `npm run build`).
