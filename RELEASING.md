# Releasing `ost-agent` to npm

The npm package ships the **engine** — the `ost-agent` CLI and the append-only MCP
server (`dist/` + README + LICENSE only; skills/commands/plugin are distributed via
the GitHub plugin marketplace, not npm). Publishing it is what makes the frictionless
paths work: `npx ost-agent mcp`, and the plugin's `npx -y ost-agent@latest mcp` server.

## One-time setup

1. **npm access:** you (or an org) must own the unclaimed name `ost-agent`. First
   publish claims it.
2. **Token for CI:** create an npm **Automation** token and add it to the repo as the
   `NPM_TOKEN` secret (Settings → Secrets and variables → Actions). The
   [`npm-publish` workflow](.github/workflows/npm-publish.yml) uses it.

## Cutting a release

1. **Bump the version in both places** (a test enforces they match):
   - `package.json` → `version`
   - `src/index.ts` → `VERSION`
2. `npm test` locally (also runs automatically via `prepublishOnly`).
3. Commit, tag, and push:
   ```bash
   git commit -am "release: v0.1.1"
   git tag v0.1.1
   git push && git push --tags
   ```
4. **Publish a GitHub Release** for the tag. That fires the workflow, which runs
   `npm ci` → build → test → `npm publish` with **provenance**.

### Manual publish (alternative)

```bash
npm login
npm publish            # prepack builds, prepublishOnly runs build + test first
```

## Safety rails already wired

- **`files` allowlist** — only `dist`, `README.md`, `LICENSE` are packed. Verify anytime
  with `npm pack --dry-run` (source, tests, `.claude/`, docs, and examples are excluded).
- **`prepack`** builds `dist/` before packing; **`prepublishOnly`** re-runs build + the
  full test suite, so a broken tree can't be published.
- **Version drift guard** — `test/release/version.test.ts` fails if `src/index.ts`
  `VERSION` and `package.json` `version` disagree.
- **`publishConfig`** — `access: public` + `provenance: true`.

## After the first publish

The plugin (`.claude-plugin/plugin.json`) already points its MCP server at
`npx -y ost-agent@latest mcp`, so once the package is live, the one-line install path
works end-to-end:

```text
/plugin marketplace add tannerbroberts/OST-Agent
/plugin install ost-agent@ost-agent
```
