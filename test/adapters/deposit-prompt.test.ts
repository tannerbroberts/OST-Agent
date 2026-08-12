/**
 * The end-of-session deposit prompt — the containment the node stakes its
 * honesty on, pinned.
 *
 * The solution ("An end-of-session deposit prompt in the surface the
 * collaborator is already in") solicits the reasoning that is still in the
 * collaborator's head when a session, a PR or a review closes. Its own prose
 * names the three properties that keep the channel honest, and this spec is
 * red until all three are real:
 *
 * 1. the collaborator's answer is stored VERBATIM — byte-for-byte, below a
 *    fixed marker, with no cleaning, summarising or truncation;
 * 2. nothing is inferred from it — the stored file is a fixed template plus
 *    the answer, so with a pinned clock the whole file is a literal;
 * 3. the evidence it produces enters at the `assertion` floor and cannot be
 *    promoted by the deposit path itself — deposits ingest like any drop-folder
 *    note (`actor: "inbox"` → ledger row `channel:inbox`, initial rung
 *    `assertion`), the deposit module holds no reference to the trust ledger,
 *    and the whole flow appends nothing to it.
 *
 * What a green here does NOT settle, verbatim from the node: who chooses to
 * answer. Voluntary compliance is not randomly distributed, and a spec proving
 * the storage is faithful proves nothing about who fills it in — that is the
 * assumption test's two-week human count, which no test file can run.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  DEPOSIT_PROMPT,
  VERBATIM_MARKER,
  depositAnswer,
  fileDeposit,
} from "../../src/adapters/deposit.js";
import { DEPOSIT_CHANNEL, channelIdPrefix, resolveChannels } from "../../src/adapters/channels.js";
import { InboxSource } from "../../src/adapters/inbox.js";
import { loadCursor } from "../../src/adapters/source.js";
import { readEvidence, writeEvidence } from "../../src/processes/tree.js";
import {
  actorTrustKey,
  evidenceActors,
  historyOf,
  readTrustLedger,
  rungOf,
  sourceStanding,
  trustLedgerPath,
} from "../../src/knowledge/actor-trust.js";
import { FLOOR_RUNG } from "../../src/knowledge/believability.js";
import { loadConfig } from "../../src/config/load.js";
import { initVault } from "../../src/runner/init.js";
import { ALLOWED_TOOL_NAMES } from "../../src/security/policy.js";
import { MCP_TOOL_NAMES } from "../../src/mcp/server.js";
import { buildOstTools, type ToolContext } from "../../src/security/tools.js";
import { Vault } from "../../src/ost/vault.js";
import { OST_RULESET } from "../../src/knowledge/ruleset.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

let parent: string;
let dir: string;

beforeEach(async () => {
  parent = fs.mkdtempSync(path.join(os.tmpdir(), "ost-deposit-"));
  dir = path.join(parent, "vault");
  await initVault(dir, "Reach ten returning operators.", "Retention");
});
afterEach(() => fs.rmSync(parent, { recursive: true, force: true }));

/** An answer chosen to break any storage path that cleans, parses or reflows. */
const GNARLY_ANSWER = [
  "  I considered [[wiki-link syntax]] and rejected it — twice.",
  "",
  "---",
  "## Results",
  "\tWhat I could not do: run `npx vitest` under a heading that looks reserved.",
  "With more room I would have profiled first.   ",
].join("\n");

describe("the deposit channel", () => {
  test("is first-party, inside the vault, and follows the inbox switch", () => {
    const channel = resolveChannels(dir, loadConfig(dir)).channels.find((c) => c.name === DEPOSIT_CHANNEL);
    expect(channel).toBeDefined();
    expect(channel?.origin).toBe("first-party");
    expect(channel?.confined).toBe(false);
    expect(channel?.dir).toBe(path.join(dir, ".ost-agent", "deposits"));
    // Its ids carry a segment the file's author cannot forge.
    expect(channelIdPrefix(DEPOSIT_CHANNEL)).toBe("INBOX:deposit/");
  });
});

describe("the answer is stored verbatim and nothing is inferred", () => {
  test("byte-for-byte round trip below the marker, whatever the answer contains", () => {
    const written = fileDeposit(dir, { answer: GNARLY_ANSWER, from: "Priya", closing: "session" });
    const raw = fs.readFileSync(written, "utf8");
    // The strong form first: the file ENDS with the answer, so nothing was
    // appended after the collaborator's words either.
    expect(raw.endsWith(GNARLY_ANSWER)).toBe(true);
    expect(depositAnswer(raw)).toBe(GNARLY_ANSWER);
  });

  test("with a pinned clock the whole file is a fixed template plus the answer — no summary, no classification", () => {
    const written = fileDeposit(dir, {
      answer: "I rejected the queue design.",
      from: "Priya",
      closing: "review",
      at: "2026-08-12T09:00:00.000Z",
    });
    expect(fs.readFileSync(written, "utf8")).toBe(
      [
        "# Deposit (review): 2026-08-12",
        "",
        `- **prompt:** ${DEPOSIT_PROMPT}`,
        "- **deposited:** 2026-08-12T09:00:00.000Z",
        "- **by:** Priya",
        "",
        "Evidence class: **assertion** — narrated self-report by the person who did the work. It grounds",
        "what they say about their own reach, which is not a measurement of it, and nothing on the deposit",
        "path can raise it: standing is earned only by a test a human records.",
        "",
        VERBATIM_MARKER,
        "",
        "I rejected the queue design.",
      ].join("\n"),
    );
  });

  test("an earlier deposit is never replaced, and an empty answer is refused rather than counted", () => {
    const first = fileDeposit(dir, { answer: "first", from: "Priya", at: "2026-08-12T09:00:00.000Z" });
    const second = fileDeposit(dir, { answer: "second", from: "Priya", at: "2026-08-12T10:00:00.000Z" });
    expect(second).not.toBe(first);
    expect(fs.readFileSync(first, "utf8").endsWith("first")).toBe(true);
    expect(fs.readFileSync(second, "utf8").endsWith("second")).toBe(true);
    // The assumption test COUNTS deposits; storing a blank one would inflate
    // the number the whole candidate is judged by.
    expect(() => fileDeposit(dir, { answer: "   \n" })).toThrow(/answer/);
  });
});

describe("a deposit enters at the assertion floor and cannot be promoted by the deposit path", () => {
  async function ingestAll(): Promise<string[]> {
    const channel = resolveChannels(dir, loadConfig(dir)).channels.find((c) => c.name === DEPOSIT_CHANNEL)!;
    const source = new InboxSource({ dir: channel.dir, channel: channel.name });
    const { items } = await source.fetchSince(loadCursor(dir, channel.name));
    for (const item of items) writeEvidence(dir, item, source.actor);
    return items.map((i) => i.id);
  }

  test("the ingesting surface stamps actor 'inbox', and the record's standing is the floor", async () => {
    fileDeposit(dir, { answer: GNARLY_ANSWER, from: "Priya", closing: "pr" });
    const [id] = await ingestAll();
    expect(id).toMatch(/^INBOX:deposit\//);

    const record = readEvidence(dir).find((r) => r.id === id);
    expect(record?.actor).toBe("inbox");

    // `channel:inbox` starts at the floor and its ceiling is `stated`; with no
    // human-recorded result in the ledger the deposit's standing IS `assertion`.
    const ledger = readTrustLedger(dir);
    expect(sourceStanding(ledger, id, evidenceActors(dir))).toBe(FLOOR_RUNG);
    expect(FLOOR_RUNG).toBe("assertion");
  });

  test("the whole deposit flow appends nothing to the trust ledger — standing rises only on a human-recorded result", async () => {
    fileDeposit(dir, { answer: "one", from: "Priya" });
    fileDeposit(dir, { answer: "two", from: "Priya" });
    await ingestAll();

    // Behavioural half: however many deposits arrive, the channel's row has no
    // history and its rung has not moved off the floor.
    expect(fs.existsSync(trustLedgerPath(dir))).toBe(false);
    const ledger = readTrustLedger(dir);
    expect(historyOf(ledger, actorTrustKey("inbox"))).toEqual([]);
    expect(rungOf(ledger, actorTrustKey("inbox"))).toBe(FLOOR_RUNG);
  });

  test("the deposit module holds no reference to the trust ledger at all", () => {
    // Structural half: the promotion writers live in src/knowledge/ (the trust
    // ledger, the believability ladder), and the deposit path must not be able
    // to reach them. Prose may say "trust"; an import may not — a later import
    // fails here before it can compile into a self-promoting channel.
    const source = fs.readFileSync(path.join(repoRoot, "src", "adapters", "deposit.ts"), "utf8");
    const imports = source.split("\n").filter((l) => /^import\b/.test(l));
    expect(imports.length).toBeGreaterThan(0);
    for (const line of imports) {
      expect(line, `deposit.ts must not import from src/knowledge/: ${line}`).not.toMatch(/knowledge\//);
    }
    expect(source).not.toMatch(/appendObservation|rankHost/);
  });
});

describe("the prompt lives in the surface the collaborator is already in", () => {
  test("ost_deposit is on the allowlist, the MCP surface, and the skill grant", () => {
    expect([...ALLOWED_TOOL_NAMES]).toContain("ost_deposit");
    expect([...MCP_TOOL_NAMES]).toContain("ost_deposit");
    const grant = (OST_RULESET.skillTools as readonly { name: string; grant: boolean }[]).find(
      (t) => t.name === "ost_deposit",
    );
    expect(grant?.grant).toBe(true);
  });

  test("the tool's own description IS the offer: it carries the one question and the verbatim instruction", () => {
    const ctx: ToolContext = { vault: new Vault(dir), dir, remote: { enabled: false }, surface: "test:deposit" };
    const built = buildOstTools(ctx, MCP_TOOL_NAMES).find((t) => t.name === "ost_deposit");
    expect(built).toBeDefined();
    const t = built as unknown as { description: string; run: (i: unknown) => Promise<string> };
    expect(t.description).toContain(DEPOSIT_PROMPT);
    expect(t.description).toMatch(/verbatim/i);
    expect(t.description).toMatch(/do not paraphrase/i);
    return t.run({ answer: GNARLY_ANSWER, from: "Priya", closing: "session" }).then((out) => {
      expect(out).toMatch(/assertion/);
      const folder = path.join(dir, ".ost-agent", "deposits");
      const files = fs.readdirSync(folder);
      expect(files.length).toBe(1);
      expect(depositAnswer(fs.readFileSync(path.join(folder, files[0]), "utf8"))).toBe(GNARLY_ANSWER);
    });
  });
});
