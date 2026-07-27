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

1. **Bump the version in all three places** (a test enforces they match):
   - `package.json` → `version`
   - `src/index.ts` → `VERSION`
   - `.claude-plugin/plugin.json` → `version` (this is what makes installed
     plugins see the update — the marketplace only offers a new version when
     this number changes)
2. `npm test` locally (also runs automatically via `prepublishOnly`).
3. Commit, tag, and push:
   ```bash
   git commit -am "release: v0.1.1"
   git tag v0.1.1
   git push && git push --tags
   ```
   **The pushed tag is the trigger** — the workflow runs `npm ci` → build → test →
   `npm publish` with **provenance**, and there is nothing else to do.
4. Optionally publish a GitHub Release for the tag, for humans reading the
   changelog. It fires the same workflow, which detects the version is already on
   the registry and skips rather than failing on a duplicate.

### When you cannot push a tag

Some environments — the autonomous loop's container among them — get **HTTP 403**
from their git proxy on `git push --tags`. That takes out step 3's trigger *and*
step 4's, since a Release needs a tag to point at. The version on `main` is then
publishable and unpublished, with no way to say so from inside that environment.

Run the workflow directly against `main` instead:

```bash
gh workflow run npm-publish.yml --ref main
```

It publishes whatever version `package.json` carries on that ref, through the same
gated path. This is how 0.14.0 shipped after 0.10.0–0.13.0 were cut, tagged locally
and never published — four releases that existed only in a container that gets
reclaimed. If you take this path, land the tag from a machine that can push one, so
the released commit stays identifiable.

### Manual publish (last resort)

```bash
npm login
npm publish            # prepack builds, prepublishOnly runs build + test first
```

Prefer either workflow path: a local publish produces no provenance attestation.

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
