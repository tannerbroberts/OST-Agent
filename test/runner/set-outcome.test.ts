import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { setOutcome } from "../../src/runner/set-outcome.js";
import { buildPassContext } from "../../src/runner/context.js";

/** A stand-in charting-cost figure — any string carrying a number satisfies `setOutcome`. */
const COST = "5 evidence, 2 conversations, 7 days to first actionable branch";

let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-setoutcome-"));
  await initVault(dir, "First mandate", "Project");
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("setOutcome — retune the steering mandate", () => {
  test("updates config + root body, preserving the prior mandate in History", async () => {
    const r = await setOutcome(dir, "Second mandate, sharper", COST);
    expect(r.title).toBe("Project");
    expect(r.previous).toBe("First mandate");

    const ctx = buildPassContext(dir);
    // config reflects the new mandate
    expect(ctx.config.outcome).toBe("Second mandate, sharper");
    // root node body leads with the new mandate and keeps the old under History
    const root = ctx.vault.read("Project");
    expect(root.body.startsWith("Second mandate, sharper")).toBe(true);
    expect(root.body).toContain("## History");
    expect(root.body).toContain("First mandate");
    // still exactly one outcome; identity (title) unchanged — no rename, no delete
    expect(ctx.vault.readTree().filter((n) => n.layer === "Outcome")).toHaveLength(1);
  });

  test("accumulates history across repeated retunes", async () => {
    await setOutcome(dir, "Second mandate", COST);
    await setOutcome(dir, "Third mandate", COST);
    const root = buildPassContext(dir).vault.read("Project");
    expect(root.body.startsWith("Third mandate")).toBe(true);
    expect(root.body).toContain("First mandate");
    expect(root.body).toContain("Second mandate");
  });

  test("refuses an identical or empty mandate", async () => {
    await expect(setOutcome(dir, "First mandate", COST)).rejects.toThrow(/identical/);
    await expect(setOutcome(dir, "   ", COST)).rejects.toThrow(/empty/);
  });

  test("each retune is a new commit (append-only history in git)", async () => {
    const before = buildPassContext(dir);
    void before;
    const r = await setOutcome(dir, "A new direction", COST);
    expect(r.sha).toMatch(/^[0-9a-f]{7,}$/);
  });

  test("refuses a goal with no charting-cost estimate attached", async () => {
    await expect(setOutcome(dir, "A goal nobody priced", "")).rejects.toThrow(/charting-cost estimate required/);
    await expect(setOutcome(dir, "A goal nobody priced", "no idea, hard to say")).rejects.toThrow(
      /charting-cost estimate required/,
    );
    // Refused before anything is written — the config and root node are untouched.
    const ctx = buildPassContext(dir);
    expect(ctx.config.outcome).toBe("First mandate");
  });
});

/**
 * What `set-outcome` is, stated in the terms readiness criterion **W6** asks in.
 *
 * W6 says no shipped command may grant a Bash subcommand that writes the tree,
 * and `/ost-setup` grants `Bash(… set-outcome:*)`. The enumeration and the
 * verdict live in `test/release/command-allowlists.test.ts`; these two tests are
 * the facts that verdict rests on, pinned next to the code that makes them true
 * so that a change to `setOutcome` fails here first, where the reason is legible,
 * rather than in a release audit that only reports a hash moved.
 *
 * The second test is the load-bearing one for *how* W6 gets closed. Two fixes
 * were on the table: drop the grant and let the human run it, or make
 * `set-outcome` file through the inbox the way `ost-agent friction` does. The
 * objection to dropping it is that it might break the front door — so the
 * question is what `/ost-setup` actually loses. The answer is nothing that
 * works: the ordinary first run takes the `no-vault` branch and runs `init`,
 * which accepts the mandate as a flag, and the only branch that reaches
 * `set-outcome` is `no-outcome`, where it cannot succeed at all.
 */
describe("W6 — what the granted `set-outcome:*` prefix can actually do", () => {
  test("it is a direct tree write: the root node file and the config both move", async () => {
    const root = path.join(dir, "Project.md");
    const cfg = path.join(dir, "ost.config.yaml");
    const before = [fs.readFileSync(root, "utf8"), fs.readFileSync(cfg, "utf8")];

    await setOutcome(dir, "A mandate nobody in this session was asked for", COST);

    // Non-vacuity: the same two reads are taken before and after one call, so a
    // `setOutcome` that had stopped writing (filing through the inbox, say)
    // would fail here rather than passing quietly — which is the whole point of
    // pinning it, since that is one of the two candidate fixes.
    expect(fs.readFileSync(root, "utf8")).not.toBe(before[0]);
    expect(fs.readFileSync(cfg, "utf8")).not.toBe(before[1]);
    expect(fs.readFileSync(cfg, "utf8")).toContain("A mandate nobody in this session was asked for");
  });

  test("in the `no-outcome` state — the one state /ost-setup runs it for — it refuses", async () => {
    // `vaultReadiness` reports `no-outcome` for a vault whose config is present
    // and whose root Outcome node is not (`src/mcp/bootstrap.ts`), and names
    // `set-outcome` as the remedy. `setOutcome` requires that same node to exist
    // before it will do anything, so the remedy and the state are mutually
    // exclusive: step 3 of the front door cannot succeed today.
    fs.rmSync(path.join(dir, "Project.md"));
    await expect(setOutcome(dir, "The human's real mandate", COST)).rejects.toThrow(/no Outcome node found/);

    // The control, and the reason this is a finding rather than a typo: the very
    // same call succeeds the moment the node is back. The refusal is about the
    // state, not about the arguments.
    await initVault(dir, "ignored — the config already holds one", "Project");
    await expect(setOutcome(dir, "The human's real mandate", COST)).resolves.toMatchObject({ title: "Project" });
  });

  test("`init` is not a way out of `no-outcome` either — it resurrects the stale mandate", async () => {
    // Recorded because it is the thing that would otherwise be reached for once
    // `set-outcome` is known to refuse. `init` is non-destructive by design, so
    // it re-reads the config that is already there: the root node comes back
    // carrying the *old* outcome, and the human's new words are dropped without
    // a word. The `no-outcome` branch therefore has no working remedy at all —
    // separate from W6, and not fixed by it.
    //
    // Read the other way round, this is also the property that makes the
    // *surviving* grant, `Bash(… init:*)`, acceptable where `set-outcome:*` is
    // not, and it is the half `test/release/command-allowlists.test.ts` cannot
    // reach: that file probes `init` against a healthy vault, where it is a
    // no-op. `no-outcome` is the one reachable state where a granted `init` DOES
    // write a node file into a live vault — and even there the bytes it writes
    // come from the config, never from the argv the model composed. So in every
    // reachable state, `init` cannot put model-chosen text into an existing
    // tree. `set-outcome` can, which is the whole of W6's verdict.
    fs.rmSync(path.join(dir, "Project.md"));
    await initVault(dir, "The human's real mandate", "Project");

    const root = buildPassContext(dir).vault.read("Project");
    expect(root.body).toContain("First mandate");
    expect(root.body).not.toContain("The human's real mandate");
  });
});

/**
 * An existing vault keeps working, and nothing beside the mandate moves.
 *
 * `setOutcome` is the one CLI command a human runs against a vault they have
 * been using for months, so it meets the oldest configs in the wild: an
 * `adapters.inbox.path` pointing INSIDE the vault (`.ost-agent/inbox`, the
 * pre-relocation default), a cursor file already written under
 * `.ost-agent/state/`, and evidence records already on disk. Two ways that can
 * go wrong, and neither is hypothetical for a command that rewrites the config
 * with a regex and then re-validates it:
 *
 *  1. **It refuses.** `setOutcome` writes the config and the root node and only
 *     THEN calls `loadConfig` (`src/runner/set-outcome.ts:63`). If validation
 *     ever tightened to reject a legacy in-vault drop folder, a retune on a real
 *     vault would throw *after* both writes and *before* the commit — leaving
 *     the vault edited and uncommitted, which is the one shape this repo's
 *     append-only story does not cover.
 *  2. **It eats a neighbouring key.** The rewrite is
 *     `raw.replace(/^outcome:.*$/m, …)`. Loosening that anchor by one character
 *     — `/^outcome.*$/m` — silently retitles the root node instead, because
 *     `outcomeTitle:` is the very next line of every config this project has
 *     ever written.
 *
 * Neither is covered by the tests above, which all run against a config this
 * process just generated. This fixture is deliberately *downgraded* after init
 * rather than hand-written, so it stays a real config as the schema moves.
 */
describe("backwards compatibility — a retune on an old-shape vault", () => {
  /** The pre-relocation inbox path: inside the vault, under the sidecar. */
  const LEGACY_INBOX = ".ost-agent/inbox";

  /** Downgrade a freshly-initialised vault to the shape a v0.11 vault has on disk. */
  function downgrade(vault: string): { cursor: string; evidence: string } {
    const cfg = path.join(vault, "ost.config.yaml");
    const raw = fs.readFileSync(cfg, "utf8");
    // Only the inbox `path:` line — the rest of the config stays whatever the
    // current schema writes, so this fixture cannot rot into a shape no version
    // ever shipped.
    const legacy = raw.replace(/^(\s*)path: "\.\..*$/m, `$1path: "${LEGACY_INBOX}"`);
    if (legacy === raw) throw new Error("fixture did not downgrade: no relocated inbox `path:` line to replace");
    fs.writeFileSync(cfg, legacy, "utf8");

    fs.mkdirSync(path.join(vault, LEGACY_INBOX), { recursive: true });
    const state = path.join(vault, ".ost-agent", "state");
    fs.mkdirSync(state, { recursive: true });
    const cursor = path.join(state, "inbox.json");
    fs.writeFileSync(cursor, '{"cursor":"2026-01-02T00:00:00.000Z"}', "utf8");

    const evidenceDir = path.join(vault, ".ost-agent", "evidence");
    fs.mkdirSync(evidenceDir, { recursive: true });
    const evidence = path.join(evidenceDir, "2026-01-01-old-note.md");
    fs.writeFileSync(
      evidence,
      '---\nid: "INBOX:old-note.md"\nsource: inbox\ndate: "2026-01-01"\n---\n\nAn old customer note already ingested.\n',
      "utf8",
    );
    return { cursor, evidence };
  }

  test("succeeds, and re-ingests nothing: the cursor and the evidence come back byte-identical", async () => {
    const { cursor, evidence } = downgrade(dir);
    const before = [fs.readFileSync(cursor), fs.readFileSync(evidence)];

    // Not `.resolves` — the failure this guards is a throw *between* the two
    // writes and the commit, and awaiting the call directly is what surfaces it
    // with its own message rather than as a matcher mismatch.
    const r = await setOutcome(dir, "A mandate the human typed years later", COST);
    expect(r.previous).toBe("First mandate");

    expect(fs.readFileSync(cursor).equals(before[0]), "the ingest cursor moved").toBe(true);
    expect(fs.readFileSync(evidence).equals(before[1]), "an existing evidence record moved").toBe(true);

    // Non-vacuity for the two byte comparisons above. They are `Buffer.equals`
    // on a file this test wrote, so a comparison that could never come out false
    // would pass whatever `setOutcome` did to the sidecar. One appended byte has
    // to flip both — proving the assertions read the disk after the call and not
    // the buffers captured before it.
    fs.appendFileSync(cursor, " ");
    expect(fs.readFileSync(cursor).equals(before[0])).toBe(false);
  });

  test("rewrites only the `outcome:` line — the legacy drop folder and the root's title survive", async () => {
    downgrade(dir);
    await setOutcome(dir, "A mandate the human typed years later", COST);

    const cfg = fs.readFileSync(path.join(dir, "ost.config.yaml"), "utf8");
    expect(cfg).toMatch(/^outcome: "A mandate the human typed years later"/m);
    // The two neighbours a looser anchor would swallow. `outcomeTitle` is the
    // root node's stable identity: retitling it on a retune would orphan every
    // link into the root and read as a rename this project has no operation for.
    expect(cfg).toMatch(/^outcomeTitle: "Project"/m);
    expect(cfg).toContain(`path: "${LEGACY_INBOX}"`);
    // And the vault still loads with the legacy path in place, which is the
    // claim "an existing vault keeps working" actually rests on.
    expect(buildPassContext(dir).config.outcome).toBe("A mandate the human typed years later");
  });
});
