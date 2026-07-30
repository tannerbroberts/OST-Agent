/**
 * Nothing reaches `.ost-agent/evidence/` with a credential still in it.
 *
 * That directory is not a cache. `initVault` scaffolds no `.gitignore`, `gitCommit`
 * runs `git add -A`, and the unattended script pushes — so a secret written here is
 * a secret published, permanently, with no edit tool to take it back. Four
 * body-carrying paths remembered to call `redactSecrets` and `InboxSource` did not,
 * which under DEC-1 left the untrusted builder's *only* channel as the one that
 * wrote credentials to disk verbatim.
 *
 * The rule now lives at `writeEvidence`, the single funnel, so these tests are
 * written against the funnel rather than against any one adapter: an adapter added
 * tomorrow that forgets is still covered.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { InboxSource } from "../../src/adapters/inbox.js";
import { CHANNEL_ZERO } from "../../src/adapters/channels.js";
import { readEvidence, writeEvidence } from "../../src/processes/tree.js";

let dir: string;
let inbox: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-redact-"));
  inbox = path.join(dir, ".ost-agent", "inbox");
  fs.mkdirSync(inbox, { recursive: true });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/**
 * Drop a note and run it through the real ingest path (source → writeEvidence).
 *
 * The channel is named explicitly because `InboxSource` has no positional-string
 * overload any more; a call that omitted it would silently be channel zero, which
 * is S3's bug re-entering through a compatibility path. {@link CHANNEL_ZERO} is the
 * right channel here because the fixed `INBOX:second.md` id below is channel zero's
 * frozen *bare* id shape, and the point of the last test is that the two bodies meet
 * at one funnel — they have to be records of the same channel to be comparable.
 */
async function ingest(name: string, body: string): Promise<void> {
  fs.writeFileSync(path.join(inbox, name), body, "utf8");
  const source = new InboxSource({ dir: inbox, channel: CHANNEL_ZERO });
  const { items } = await source.fetchSince(null);
  for (const item of items) writeEvidence(dir, item, source.actor);
}

/** The bytes actually on disk, not the parsed record — frontmatter counts too. */
function onDisk(): string {
  const d = path.join(dir, ".ost-agent", "evidence");
  return fs
    .readdirSync(d)
    .map((n) => fs.readFileSync(path.join(d, n), "utf8"))
    .join("\n");
}

const API_KEY = "sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const GH_TOKEN = "ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("the inbox cannot write a credential into the vault", () => {
  test("a dropped note's secrets are masked in the evidence record", async () => {
    await ingest("call-notes.md", `# Call with Acme\n\nANTHROPIC_API_KEY=${API_KEY}\nGITHUB_TOKEN=${GH_TOKEN}\n`);

    const written = onDisk();
    expect(written).not.toContain(API_KEY);
    expect(written).not.toContain(GH_TOKEN);
    expect(written).toContain("[redacted]");
  });

  test("the record the model reads is the redacted one", async () => {
    await ingest("leak.md", `They pasted Authorization: Bearer abcDEF123456ghijkl at us.\n`);

    const [rec] = readEvidence(dir);
    expect(rec.body).not.toContain("abcDEF123456ghijkl");
    expect(rec.body).toContain("Bearer [redacted]");
  });

  test("a secret in the filename does not survive into the title", async () => {
    // The builder chooses the filename, and it becomes the record's title. The `id`
    // is deliberately *not* rewritten — it is the cursor and provenance key — so the
    // leak is only narrowed here, not closed. See the note in the summary.
    await ingest(`leaked-${API_KEY}.md`, "nothing else in here\n");

    const [rec] = readEvidence(dir);
    expect(rec.title).not.toContain(API_KEY);
    expect(rec.title).toContain("[redacted]");
  });

  test("the original note is left untouched, so the unredacted text is still recoverable", async () => {
    // The way out of an over-redaction: evidence is append-only with no edit tool,
    // but the adapter is strictly read-only, so the inbox still holds the original.
    const raw = `secret: customers do not trust us\nAPI key ${API_KEY}\n`;
    await ingest("verbatim.md", raw);

    expect(fs.readFileSync(path.join(inbox, "verbatim.md"), "utf8")).toBe(raw);
  });
});

describe("the choke point covers channels no adapter redacts", () => {
  test("a Slack-shaped record is redacted even though SlackSource never calls redactSecrets", () => {
    // SlackSource emits `m.text.trim()` verbatim (src/adapters/slack.ts:95), as
    // AtlassianSource emits a Jira description. Both are one wiring change from
    // reaching this funnel, and neither has to remember.
    writeEvidence(
      dir,
      {
        id: "SLACK:C1/1700000000.1",
        source: "SLACK:C1/1700000000.1",
        title: "#support",
        timestamp: "2026-07-29T00:00:00Z",
        body: `here you go: ${GH_TOKEN}`,
      },
      "slack",
    );

    expect(onDisk()).not.toContain(GH_TOKEN);
  });

  test("re-redacting an already-redacted body changes nothing", async () => {
    // The four adapters that already redact hand their bodies to this funnel too.
    // Masking twice must be a no-op, or every one of them gets double-mangled.
    await ingest("first.md", `token=abcdef1234567890\n`);
    const first = readEvidence(dir)[0].body;

    writeEvidence(
      dir,
      {
        id: "INBOX:second.md",
        source: "INBOX:second.md",
        title: "second",
        timestamp: "2026-07-29T00:00:00Z",
        body: first,
      },
      "inbox",
    );

    const second = readEvidence(dir).find((r) => r.id === "INBOX:second.md");
    expect(second?.body).toBe(first);
  });
});
