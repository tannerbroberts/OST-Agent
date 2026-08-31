/**
 * B11 — a source that loses standing causes what it already seeded to be
 * reported as suspect.
 *
 * DEC-2 says standing is earned by testing cause and effect. Everything built for
 * that decision so far builds the *promotion*: a source is corroborated and rises.
 * The half that costs money is the withdrawal, because a channel that goes silent
 * is noticed by anyone and a channel that keeps delivering plausible, wrong
 * content on cadence is noticed by nobody. Before this, `ost_rank_source` could
 * strike a publisher and the strike changed exactly one thing — what the *next*
 * page from that publisher was worth. The nodes already resting on it were not
 * named anywhere, by anything.
 *
 * The criterion's check is the shape of this file: **record a demotion for source
 * S, then assert `ost_check` names every node whose `source` is S.**
 *
 * **"Record a demotion" means through the tool, and the first describe block
 * does exactly that.** The earlier version of this file planted
 * `.ost-agent/trust/hosts.jsonl` by hand — the RETIRED host-keyed file — and every
 * assertion passed while the shipped mechanism read a file no writer produces. A
 * hand-planted fixture cannot tell you the reader and the writer agree about which
 * file the ledger is; only a call through `ost_rank_source` can, so that is the
 * first test here and everything else is a unit test underneath it.
 *
 * **The scope is stated rather than implied, and it is narrower than the
 * criterion's title.** "Everything downstream" is reported here as *every node
 * whose own `source` names S* — not every node transitively beneath one. That is
 * what the check asks for, and the wider claim needs an edge semantics this tree
 * does not have: `links` carries "parent of" and "related to" in one relation, so
 * a transitive walk would paint whole subtrees suspect on the strength of a
 * `Related:` line. The gap is pinned below as a test rather than left as prose, so
 * that closing it later is a deliberate change to an assertion and not a silent
 * widening.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { MAX_ITEMS_PER_LIST, renderCheck, RENDER_BUDGET_BYTES } from "../../src/eval/render.js";
import { checkInvariants } from "../../src/eval/invariants.js";
import {
  MAX_QUOTED_SOURCE_LENGTH,
  reconcileWithTrust,
  SUSPECT_SOURCE_RULE,
  withdrawnStanding,
  type TreeCensus,
} from "../../src/ost/census.js";
import {
  appendObservation,
  readTrustLedger,
  trustLedgerPath,
  type NewObservation,
  type TrustLedger,
  type TrustObservation,
} from "../../src/knowledge/actor-trust.js";
import { hostTrustPath, type HostTrustRecord } from "../../src/knowledge/web-trust.js";
import { buildOstTools, type ToolContext } from "../../src/security/tools.js";
import { Vault } from "../../src/ost/vault.js";
import type { OstNode } from "../../src/ost/node.js";

const HOST = "analytics-weekly.example";
const OTHER = "steady.example";

function node(title: string, source?: string): OstNode {
  return {
    title,
    layer: "Opportunity",
    evidence: "assertion",
    tags: [],
    links: [],
    body: `prose for ${title}`,
    ...(source ? { source } : {}),
  };
}

function censusOf(nodes: OstNode[], extra: Partial<TreeCensus> = {}): TreeCensus {
  return {
    nodes,
    examined: nodes.length,
    seenFiles: nodes.map((n) => `${n.title}.md`),
    skipped: [],
    unreadable: [],
    quarantined: [], retired: [],
    ...extra,
  };
}

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-suspect-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/**
 * Append a ledger observation with a fixed stamp.
 *
 * `appendObservation` takes its clock as an argument, so no `Date.now()` reaches
 * this file. A planted history is also the honest case for the unit tests below —
 * an append-only ledger predates any one run — but it is NOT how the criterion's
 * own check is written; see the first describe block.
 */
function append(rec: NewObservation, ts: string): void {
  appendObservation(dir, rec, () => new Date(ts));
}

const strike = (id: string, ts: string, reason = "three claims failed replication") =>
  append({ kind: "web", id, type: "strike", reason, by: "test" }, ts);

const supported = (id: string, ts: string, testName: string) =>
  append({ kind: "web", id, type: "corroboration", test: testName, verdict: "supported", by: "test" }, ts);

const reset = (id: string, ts: string) =>
  append({ kind: "web", id, type: "reset", reason: "reviewed", by: "human:cli" }, ts);

/** A ledger built in memory, for the pure fold. */
function ledgerOf(...records: TrustObservation[]): TrustLedger {
  const histories = new Map<string, TrustObservation[]>();
  for (const r of records) {
    if (r.type === "migration") continue;
    const key = `${r.kind}:${r.id}`;
    histories.set(key, [...(histories.get(key) ?? []), r]);
  }
  return { histories, damaged: 0 };
}

const strikeRec = (id: string, ts: string, reason = "wrong"): TrustObservation => ({
  ts,
  kind: "web",
  id,
  type: "strike",
  reason,
  by: "test",
});
const supportedRec = (id: string, ts: string, test: string): TrustObservation => ({
  ts,
  kind: "web",
  id,
  type: "corroboration",
  test,
  verdict: "supported",
  by: "test",
});
const resetRec = (id: string, ts: string): TrustObservation => ({
  ts,
  kind: "web",
  id,
  type: "reset",
  reason: "reviewed",
  by: "human:cli",
});

/* ------------------------------------------------------------------ *
 * The criterion, run the way it is written
 * ------------------------------------------------------------------ */

describe("the criterion, end to end: demote through the tool, then read the report", () => {
  const SEEDED = "Weekly churn is under-reported";
  const ALSO_SEEDED = "Onboarding drops at step three";
  const UNAFFECTED = "Support tickets spike on release day";

  let vault: Vault;

  beforeEach(() => {
    fs.writeFileSync(path.join(dir, "ost.config.yaml"), "outcome: x\n", "utf8");
    vault = new Vault(dir);
    const put = (n: Partial<OstNode> & { title: string; layer: OstNode["layer"] }) =>
      vault.createNode({ body: "prose", tags: [], links: [], evidence: "assertion", ...n } as OstNode);
    put({ title: "The outcome", layer: "Outcome" });
    put({ title: SEEDED, layer: "Opportunity", source: `WEB:${HOST}` });
    put({ title: ALSO_SEEDED, layer: "Opportunity", source: `WEB:${HOST}` });
    put({ title: UNAFFECTED, layer: "Opportunity", source: `WEB:${OTHER}` });
    for (const t of [SEEDED, ALSO_SEEDED, UNAFFECTED]) vault.linkNodes("The outcome", t);
  });

  /** The one and only way an agent records a demotion. */
  async function demote(id: string, reason = "three claims failed to replicate"): Promise<string> {
    const ctx: ToolContext = { vault, dir, remote: { enabled: false }, surface: "test" };
    const tool = buildOstTools(ctx).find((t) => t.name === "ost_rank_source") as unknown as {
      run: (i: unknown) => Promise<string>;
    };
    return tool.run({ kind: "web", id, direction: "contradicted", reason });
  }

  function check(): { text: string; violations: number } {
    const census = vault.readTreeCensus();
    census.standing = reconcileWithTrust(dir, census);
    return renderCheck(census);
  }

  test("NON-VACUITY: before any demotion the same tree names nothing", () => {
    // The control that makes the next test a measurement rather than a
    // description. If this ever fails, the mechanism is reporting on something
    // other than a withdrawal.
    const out = check();
    expect(out.text).not.toContain(SUSPECT_SOURCE_RULE);
    expect(out.violations).toBe(0);
  });

  test("a demotion recorded through ost_rank_source names every node whose source is that host", async () => {
    // The check as written in `docs/reference/v1-readiness.md`, executed. It is
    // deliberately not a fixture: the reader and the writer have to agree about
    // WHICH FILE the ledger is, and only a real call proves that. They did not
    // when this mechanism was first written — the report read the retired
    // `hosts.jsonl` while the tool wrote `actors.jsonl`.
    await demote(HOST);
    const out = check();
    expect(out.text).toContain(SUSPECT_SOURCE_RULE);
    expect(out.text).toContain(`"${SEEDED}"`);
    expect(out.text).toContain(`"${ALSO_SEEDED}"`);
    // The control inside the assertion: a still-trusted publisher's node is not swept in.
    expect(out.text).not.toContain(`"${UNAFFECTED}"`);
  });

  test("the report reads the live ledger, not the retired host file", async () => {
    // Named as its own assertion because the failure it catches is silent: a
    // reader pointed at a file nothing writes reports "nothing is suspect"
    // forever, and every other test in this file can be green while it does.
    await demote(HOST);
    expect(fs.existsSync(trustLedgerPath(dir))).toBe(true);
    expect(fs.existsSync(hostTrustPath(dir))).toBe(false);
    expect(reconcileWithTrust(dir, vault.readTreeCensus())!.basis).toContain("actors.jsonl");
  });

  test("the demotion is free — no corroborating result, no human, one call", async () => {
    // DEC-2's asymmetry, executed. Paperwork in front of the agent's only way to
    // stop trusting a bad source is a wedge pointed at the safe direction, and
    // B11's failure mode is the expensive one.
    await expect(demote(HOST)).resolves.toContain("struck");
  });

  test("SELF-CERTIFICATION: no tool on the surface raises a source the agent chose", async () => {
    // This gate's whole subject. The agent holds `ost_rank_source` and nothing
    // else that touches the ledger, so if `corroborated` could be made to land on
    // a source of its choosing, "earned" would again be a word in a tool
    // description. Three refusals, each a different reason:
    const ctx: ToolContext = { vault, dir, remote: { enabled: false }, surface: "test" };
    const tool = buildOstTools(ctx).find((t) => t.name === "ost_rank_source") as unknown as {
      run: (i: unknown) => Promise<string>;
    };
    const raise = (reason: string) =>
      tool.run({ kind: "web", id: HOST, direction: "corroborated", reason });

    // (a) a reason naming no node at all
    await expect(raise("it looks solid to me")).rejects.toThrow();
    // (b) a reason naming a node that does not exist
    await expect(raise("corroborated by [[No Such Test]]")).rejects.toThrow();
    // (c) a reason naming a real node with no recorded outcome — the agent can
    //     create that node itself, which is why this row is the load-bearing one.
    vault.createNode({
      title: "A test I wrote myself",
      layer: "AssumptionTest",
      body: "I ran it and it worked",
      tags: [],
      links: [SEEDED],
      evidence: "assertion",
    } as OstNode);
    await expect(raise("corroborated by [[A test I wrote myself]]")).rejects.toThrow();

    // Nothing reached the ledger: the refusals are before the write, not after.
    expect(fs.existsSync(trustLedgerPath(dir))).toBe(false);
  });

  test("SELF-CERTIFICATION: a struck source cannot be talked back up either", async () => {
    // The other direction of the same question. Once struck, the report must not
    // be clearable by the actor the report is about — `explainRung` holds the
    // floor while any strike stands, and no tool writes a `reset`.
    await demote(HOST);
    const before = fs.readFileSync(trustLedgerPath(dir), "utf8");
    const ctx: ToolContext = { vault, dir, remote: { enabled: false }, surface: "test" };
    for (const t of buildOstTools(ctx)) {
      // The whole surface, not a remembered subset: if a tool that can clear a
      // strike is ever added, this loop is where it shows up.
      expect(t.name, "no tool may write a trust reset").not.toBe("ost_trust_reset");
    }
    // A supported corroboration is the closest thing to a clear that exists, and
    // it does not clear.
    supported(HOST, "2026-09-01T00:00:00.000Z", "Some later test");
    expect(check().text).toContain(SUSPECT_SOURCE_RULE);
    expect(fs.readFileSync(trustLedgerPath(dir), "utf8").startsWith(before)).toBe(true);
  });

  test("naming is not failing — the verdict does not move", async () => {
    await demote(HOST);
    const out = check();
    expect(out.violations).toBe(0);
    expect(out.text).toContain("invariants: PASS");
  });
});

/* ------------------------------------------------------------------ *
 * The fold
 * ------------------------------------------------------------------ */

describe("withdrawnStanding — a withdrawal is a transition, not a state", () => {
  test("a struck source stands withdrawn, naming the record's own stamp and reason", () => {
    const lost = withdrawnStanding(
      ledgerOf(
        supportedRec(HOST, "2026-01-01T00:00:00.000Z", "A test"),
        strikeRec(HOST, "2026-06-01T00:00:00.000Z", "failed replication in a second test"),
      ),
    );
    expect(lost.get(`web:${HOST}`)).toEqual({
      why: "strike",
      from: "expert",
      to: "assertion",
      at: "2026-06-01T00:00:00.000Z",
      reason: "failed replication in a second test",
    });
  });

  test("NON-VACUITY: a source with a history but no withdrawal is NOT withdrawn", () => {
    // The control that makes the test above mean something. `rungOf` answers
    // `assertion` for a struck publisher and `assertion` for a publisher nobody
    // ever ranked — if the fold read the current rung instead of the history, an
    // untouched vault would report every source it has ever seen as suspect.
    expect(withdrawnStanding(ledgerOf(supportedRec(HOST, "2026-01-01T00:00:00.000Z", "A test"))).size).toBe(0);
    expect(withdrawnStanding(ledgerOf()).size).toBe(0);
  });

  test("a strike with no prior standing still withdraws — the criterion's own step one", () => {
    // The weaker neighbouring check would require a promotion first, and it would
    // make B11 unreachable in practice: raising a source now needs a recorded
    // result joined to a node that cited it, which most struck channels never had.
    // `ost_rank_source({direction:'contradicted'})` writes exactly this record.
    const lost = withdrawnStanding(ledgerOf(strikeRec(HOST, "2026-06-01T00:00:00.000Z")));
    expect(lost.get(`web:${HOST}`)).toMatchObject({ why: "strike", from: "assertion", to: "assertion" });
  });

  test("a REFUTED verdict withdraws too — the half the agent cannot author", () => {
    // DEC-2's sentence is about predictions reality did not corroborate. A
    // refutation reaches the ledger only from the human-only result path, so this
    // is the one withdrawal the actor being judged has no hand in.
    const lost = withdrawnStanding(
      ledgerOf({
        ts: "2026-06-01T00:00:00.000Z",
        kind: "web",
        id: HOST,
        type: "corroboration",
        test: "Diff two builds",
        verdict: "refuted",
        node: "Weekly churn is under-reported",
        by: "human:cli",
      }),
    );
    expect(lost.get(`web:${HOST}`)).toMatchObject({ why: "refuted" });
    expect(lost.get(`web:${HOST}`)!.reason).toContain("Diff two builds");
  });

  test("an INCONCLUSIVE verdict withdraws nothing — the honest third answer costs nothing", () => {
    expect(
      withdrawnStanding(
        ledgerOf({
          ts: "2026-06-01T00:00:00.000Z",
          kind: "web",
          id: HOST,
          type: "corroboration",
          test: "Diff two builds",
          verdict: "inconclusive",
          by: "human:cli",
        }),
      ).size,
    ).toBe(0);
  });

  test("a later corroboration does NOT clear it — the agent cannot vote itself back up", () => {
    const lost = withdrawnStanding(
      ledgerOf(
        strikeRec(HOST, "2026-06-01T00:00:00.000Z"),
        supportedRec(HOST, "2026-07-01T00:00:00.000Z", "A later test"),
      ),
    );
    expect(lost.size).toBe(1);
  });

  test("only a reset clears it, and a reset clears it completely", () => {
    const lost = withdrawnStanding(
      ledgerOf(strikeRec(HOST, "2026-06-01T00:00:00.000Z"), resetRec(HOST, "2026-07-01T00:00:00.000Z")),
    );
    expect(lost.size).toBe(0);
  });

  test("a strike after a reset is reported, with the NEW stamp", () => {
    // Which is what stops an annotation written against the first withdrawal from
    // suppressing the second forever — see the `next_work` half of this.
    const lost = withdrawnStanding(
      ledgerOf(
        strikeRec(HOST, "2026-06-01T00:00:00.000Z", "first doubt"),
        resetRec(HOST, "2026-07-01T00:00:00.000Z"),
        strikeRec(HOST, "2026-08-01T00:00:00.000Z", "wrong again"),
      ),
    );
    expect(lost.get(`web:${HOST}`)).toMatchObject({ at: "2026-08-01T00:00:00.000Z", reason: "wrong again" });
  });

  test("a re-affirmed strike reports the LATEST one, so the sweep sees the new information", () => {
    const lost = withdrawnStanding(
      ledgerOf(
        strikeRec(HOST, "2026-06-01T00:00:00.000Z", "first doubt"),
        strikeRec(HOST, "2026-06-02T00:00:00.000Z", "restated"),
      ),
    );
    expect(lost.get(`web:${HOST}`)?.at).toBe("2026-06-02T00:00:00.000Z");
  });

  test("sources are independent — one withdrawal does not implicate another publisher", () => {
    const lost = withdrawnStanding(
      ledgerOf(
        supportedRec(HOST, "2026-01-01T00:00:00.000Z", "A test"),
        supportedRec(OTHER, "2026-01-02T00:00:00.000Z", "A test"),
        strikeRec(HOST, "2026-06-01T00:00:00.000Z"),
      ),
    );
    expect([...lost.keys()]).toEqual([`web:${HOST}`]);
  });
});

/* ------------------------------------------------------------------ *
 * The tree read against the ledger
 * ------------------------------------------------------------------ */

describe("reconcileWithTrust — the tree read against the ledger", () => {
  const tree = [
    node("The outcome"),
    node("Weekly churn is under-reported", `WEB:${HOST}`),
    node("Onboarding drops at step three", `WEB:${HOST}`),
    node("Support tickets spike on release day", `WEB:${OTHER}`),
    node("Builders lose the thread", "INBOX:friction-report.md"),
  ];

  test("no ledger at all is not a discrepancy", () => {
    expect(reconcileWithTrust(dir, censusOf(tree))).toBeUndefined();
  });

  test("a strike names every node whose own source is that host, and only those", () => {
    supported(HOST, "2026-01-01T00:00:00.000Z", "A test");
    supported(OTHER, "2026-01-02T00:00:00.000Z", "A test");
    strike(HOST, "2026-06-01T00:00:00.000Z");
    const standing = reconcileWithTrust(dir, censusOf(tree))!;
    expect(standing.withdrawn).toHaveLength(1);
    expect(standing.withdrawn[0].key).toBe(`web:${HOST}`);
    expect(standing.withdrawn[0].nodes).toEqual([
      "Weekly churn is under-reported",
      "Onboarding drops at step three",
    ]);
    expect(standing.nodes).toBe(2);
    // The nodes NOT named are the control: a still-trusted publisher's node and a
    // node from a channel the ledger has never heard of.
    expect(standing.withdrawn[0].nodes).not.toContain("Support tickets spike on release day");
    expect(standing.withdrawn[0].nodes).not.toContain("Builders lose the thread");
  });

  test("NON-VACUITY: the same tree with no withdrawal in the ledger names nothing", () => {
    supported(HOST, "2026-01-01T00:00:00.000Z", "A test");
    const standing = reconcileWithTrust(dir, censusOf(tree))!;
    expect(standing.withdrawn).toEqual([]);
    expect(standing.nodes).toBe(0);
  });

  test("a channel is a first-class ledger key — striking `inbox` names its nodes", () => {
    // The seam `sourceHost` used to refuse. Under the actor namespace a channel is
    // not a hostname pretending to be a publisher, it is its own kind with its own
    // ceiling, so an inbox that keeps delivering plausible, wrong content is
    // reachable by exactly the same mechanism. The evidence record supplies the
    // actor — stamped by the ingesting surface (W11), never read off the payload.
    fs.mkdirSync(path.join(dir, ".ost-agent", "evidence"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".ost-agent", "evidence", "INBOX-friction-report.md"),
      `---\nid: "INBOX:friction-report.md"\nsource: inbox\nactor: inbox\ntitle: A filing\n---\n\nbody\n`,
      "utf8",
    );
    append({ kind: "channel", id: "inbox", type: "strike", reason: "three filings were fabricated", by: "test" },
      "2026-06-01T00:00:00.000Z");
    const standing = reconcileWithTrust(dir, censusOf(tree))!;
    const inbox = standing.withdrawn.find((w) => w.key === "channel:inbox");
    expect(inbox?.nodes).toEqual(["Builders lose the thread"]);
    // NON-VACUITY: and it does not sweep in the web-sourced nodes, which is the
    // collision the old hostname-keyed namespace made possible.
    expect(inbox?.nodes).not.toContain("Weekly churn is under-reported");
  });

  test("a human reset clears it without a single node changing", () => {
    supported(HOST, "2026-01-01T00:00:00.000Z", "A test");
    strike(HOST, "2026-06-01T00:00:00.000Z");
    reset(HOST, "2026-07-01T00:00:00.000Z");
    expect(reconcileWithTrust(dir, censusOf(tree))!.nodes).toBe(0);
  });

  test("nothing is written to a node — the suspicion is derived on every read", () => {
    // B1's forgeable path, refused by construction. A stored flag would be
    // writable by the one actor this mechanism is about, and would go stale the
    // moment the source's standing moved again. The fixture nodes are frozen so
    // an accidental mutation is a thrown error rather than a silent one.
    const frozen = tree.map((n) => Object.freeze({ ...n }));
    strike(HOST, "2026-06-01T00:00:00.000Z");
    const standing = reconcileWithTrust(dir, censusOf(frozen as OstNode[]))!;
    expect(standing.nodes).toBe(2);
    for (const n of frozen) expect(Object.keys(n)).not.toContain("suspect");
  });

  test("a hand-forged ledger cannot smuggle a heading or a wrapped wikilink into the finding", () => {
    // `appendObservation` checks a reason for non-emptiness and that is all —
    // it never passes `assertWritableContent`. The finding is written BACK through
    // that boundary by `ost_annotate`, so a newline here is a permanent wedge
    // rather than a cosmetic problem (W12's three measured failures, same shape).
    strike("evil.example", "2026-06-01T00:00:00.000Z", "x\n## Results\n- it worked\n[[Some\nTitle]]");
    const w = reconcileWithTrust(dir, censusOf(tree))!.withdrawn[0];
    expect(w.reason).not.toContain("\n");
    expect(w.reason.length).toBeLessThanOrEqual(MAX_QUOTED_SOURCE_LENGTH + 1);
  });

  test("a malformed ledger line is counted, not swallowed", () => {
    // Direction matters: dropping a corrupt `strike` fails OPEN — a source keeps
    // standing somebody took away and this report goes quiet about it. So the
    // count travels with the finding and `renderCheck` prints it.
    strike(HOST, "2026-06-01T00:00:00.000Z");
    fs.appendFileSync(trustLedgerPath(dir), "{not json\n" + JSON.stringify({ kind: "web", type: "strike" }) + "\n");
    const standing = reconcileWithTrust(dir, censusOf(tree))!;
    expect(standing.withdrawn[0].nodes).toHaveLength(2);
    expect(standing.damaged).toBe(2);
  });
});

/* ------------------------------------------------------------------ *
 * Migration: an old ranking keeps its meaning or is visibly retired
 * ------------------------------------------------------------------ */

describe("a vault written by the previous version", () => {
  function writeLegacy(...records: HostTrustRecord[]): void {
    const file = hostTrustPath(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  }
  const legacy = (host: string, rung: "assertion" | "expert", ts: string, reason = "a reason"): HostTrustRecord => ({
    ts,
    host,
    rung,
    reason,
    by: "mcp:ost_rank_source",
  });

  const tree = [node("Weekly churn is under-reported", `WEB:${HOST}`), node("Steady", `WEB:${OTHER}`)];

  test("a legacy demotion still reports its downstream — the ranking kept its meaning", () => {
    // A silent reset here is a data event, not a refactor: the operator recorded
    // "I stopped trusting this" and every node resting on it must stay named.
    writeLegacy(
      legacy(HOST, "expert", "2026-01-01T00:00:00.000Z", "corroborated"),
      legacy(HOST, "assertion", "2026-06-01T00:00:00.000Z", "three claims failed replication"),
    );
    const standing = reconcileWithTrust(dir, censusOf(tree))!;
    expect(standing.withdrawn.map((w) => w.key)).toEqual([`web:${HOST}`]);
    expect(standing.withdrawn[0].nodes).toEqual(["Weekly churn is under-reported"]);
    // The legacy record's own timestamp survives the fold, so the finding a human
    // already annotated does not read as a new withdrawal after the upgrade.
    expect(standing.withdrawn[0].at).toBe("2026-06-01T00:00:00.000Z");
  });

  test("NON-VACUITY: a legacy PROMOTION is not read as a withdrawal", () => {
    // The over-report this would degenerate into if the fold treated the migration
    // as "everything starts struck". `steady.example` was trusted and stays so.
    writeLegacy(legacy(OTHER, "expert", "2026-01-01T00:00:00.000Z", "corroborated"));
    expect(reconcileWithTrust(dir, censusOf(tree))!.withdrawn).toEqual([]);
  });

  test("a host the new namespace cannot accept is retired VISIBLY, in the ledger", () => {
    // B6's trap: `rankHost` accepted any string, so a pipeline nickname could hold
    // a publisher's row. It cannot be migrated — but a record that simply vanished
    // would be the silent data event, so the marker names it.
    writeLegacy(
      legacy("stripe-webhook-feed", "expert", "2026-01-01T00:00:00.000Z"),
      legacy("stripe-webhook-feed", "assertion", "2026-06-01T00:00:00.000Z", "dropped"),
    );
    expect(reconcileWithTrust(dir, censusOf(tree))!.withdrawn).toEqual([]);
    const marker = fs
      .readFileSync(trustLedgerPath(dir), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .find((r) => r.type === "migration");
    expect(marker.retired).toContain("stripe-webhook-feed");
  });

  test("the fold runs once — a second read does not double-report or re-mint", () => {
    writeLegacy(
      legacy(HOST, "expert", "2026-01-01T00:00:00.000Z"),
      legacy(HOST, "assertion", "2026-06-01T00:00:00.000Z", "failed"),
    );
    const first = reconcileWithTrust(dir, censusOf(tree))!;
    const bytes = fs.readFileSync(trustLedgerPath(dir), "utf8");
    const second = reconcileWithTrust(dir, censusOf(tree))!;
    expect(second).toEqual(first);
    expect(fs.readFileSync(trustLedgerPath(dir), "utf8")).toBe(bytes);
  });

  test("the legacy file is never rewritten, renamed or deleted", () => {
    // Corrections are appends. A vault rolled back to an earlier version must
    // still find its trust file where it left it.
    writeLegacy(legacy(HOST, "expert", "2026-01-01T00:00:00.000Z"));
    const before = fs.readFileSync(hostTrustPath(dir), "utf8");
    reconcileWithTrust(dir, censusOf(tree));
    expect(fs.readFileSync(hostTrustPath(dir), "utf8")).toBe(before);
  });
});

/* ------------------------------------------------------------------ *
 * The rendering
 * ------------------------------------------------------------------ */

describe("ost_check names them — and does not fail because of them", () => {
  /**
   * A structurally perfect tree: one Outcome, every Opportunity attached to it.
   *
   * It has to be clean for the verdict assertions below to mean anything — on a
   * tree that is red for its own reasons, "still red" would prove nothing about
   * this mechanism.
   */
  const tree: OstNode[] = [
    {
      ...node("The outcome"),
      layer: "Outcome",
      links: [
        "Weekly churn is under-reported",
        "Onboarding drops at step three",
        "Support tickets spike on release day",
      ],
    },
    node("Weekly churn is under-reported", `WEB:${HOST}`),
    node("Onboarding drops at step three", `WEB:${HOST}`),
    node("Support tickets spike on release day", `WEB:${OTHER}`),
  ];
  const standing = {
    source: "trust-ledger" as const,
    basis: ".ost-agent/trust/actors.jsonl",
    withdrawn: [
      {
        key: `web:${HOST}`,
        why: "strike" as const,
        from: "expert",
        to: "assertion",
        at: "2026-06-01T00:00:00.000Z",
        reason: "three claims failed replication",
        nodes: ["Weekly churn is under-reported", "Onboarding drops at step three"],
      },
    ],
    nodes: 2,
    damaged: 0,
  };

  test("the fixture is a clean tree — the control for everything below", () => {
    // Without this, "check names the nodes" would be indistinguishable from
    // "check is red for an unrelated structural reason and mentions them".
    expect(checkInvariants(tree)).toEqual([]);
    const out = renderCheck(censusOf(tree));
    expect(out.violations).toBe(0);
    expect(out.text).not.toContain(SUSPECT_SOURCE_RULE);
  });

  test("the criterion: every node whose source is the withdrawn host is named", () => {
    const out = renderCheck(censusOf(tree, { standing }));
    for (const title of standing.withdrawn[0].nodes) expect(out.text).toContain(`"${title}"`);
    expect(out.text).toContain(SUSPECT_SOURCE_RULE);
    expect(out.text).toContain("2026-06-01T00:00:00.000Z");
    expect(out.text).toContain("was 'expert', now 'assertion'");
  });

  test("a node on a source that still holds its standing is NOT named", () => {
    const out = renderCheck(censusOf(tree, { standing }));
    expect(out.text).not.toContain('"Support tickets spike on release day"');
  });

  test("the verdict does not move — naming is not failing", () => {
    // The safety argument, executed. Nothing on the tool surface can rewrite a
    // node's `source`; `ost_rank_source` is not granted to the unattended sweep;
    // a strike is cleared only by a human on a shell. A red here would be a
    // permanent red — earned by the agent doing the right thing and demoting a
    // bad source. Failing here would make the cheap demotion expensive, which is
    // the one incentive DEC-2 cannot afford to invert.
    expect(renderCheck(censusOf(tree, { standing })).violations).toBe(0);
    expect(renderCheck(censusOf(tree, { standing })).text).toContain("invariants: PASS");
  });

  test("the report does not offer a clear that does not exist", () => {
    const out = renderCheck(censusOf(tree, { standing })).text;
    expect(out).toContain("ost-agent trust reset");
    expect(out).not.toMatch(/Re-ranking the source clears this/);
  });

  test("the report says what it does not cover, so the title cannot outrun the mechanism", () => {
    const out = renderCheck(censusOf(tree, { standing })).text;
    expect(out).toMatch(/Nodes merely linked beneath\s+one are NOT listed/);
  });

  test("a human reset is what clears it, and it clears it everywhere at once", () => {
    // `standing` is derived, so "cleared" is the absence of the finding rather
    // than an edit to anything: the same tree, read against a ledger that has been
    // reset, says nothing.
    const out = renderCheck(censusOf(tree, { standing: { ...standing, withdrawn: [], nodes: 0 } }));
    expect(out.text).not.toContain(SUSPECT_SOURCE_RULE);
    expect(out.violations).toBe(0);
  });

  test("a withdrawn source nothing cites is still reported, with an empty list", () => {
    const orphaned = {
      ...standing,
      withdrawn: [{ ...standing.withdrawn[0], nodes: [] }],
      nodes: 0,
    };
    const out = renderCheck(censusOf(tree, { standing: orphaned })).text;
    expect(out).toContain("0 node(s) rest on 1 source(s)");
  });

  test("unreadable ledger lines are reported even when nothing is withdrawn", () => {
    // The one caveat that must print in the quiet case. A dropped `strike` reads
    // here as a source nobody ever doubted, so "0 withdrawn" over a partly
    // unreadable file is exactly the silence this criterion exists to break.
    const out = renderCheck(censusOf(tree, { standing: { ...standing, withdrawn: [], nodes: 0, damaged: 3 } })).text;
    expect(out).toContain("3 unreadable line(s)");
    expect(out).toContain("lower bound");
    // NON-VACUITY: a clean ledger says nothing of the sort.
    expect(renderCheck(censusOf(tree, { standing: { ...standing, withdrawn: [], nodes: 0 } })).text).not.toContain(
      "unreadable line(s)",
    );
  });
});

/**
 * Z2 applied to the new section: cap what is displayed, compute every count over
 * the full set, and name what was hidden.
 *
 * Two lists nest here and both grow with something unbounded, which is why both
 * are capped rather than only the inner one. The node list grows with the tree.
 * The *source* list grows with the trust ledger — a file the agent appends to one
 * `ost_rank_source` call at a time — so a per-source header exempted from the
 * byte allowance (the natural way to write this, and how `appendViolationsByRule`
 * treats its rule headers, correctly, because rule classes are a fixed vocabulary)
 * would let a ledger spend the whole render on headers.
 */
describe("Z2 — the section is capped, and says so", () => {
  const tree = [{ ...node("The outcome"), layer: "Outcome" as const }];

  const withdrawal = (key: string, nodes: string[]) => ({
    key,
    why: "strike" as const,
    from: "expert",
    to: "assertion",
    at: "2026-06-01T00:00:00.000Z",
    reason: "failed replication",
    nodes,
  });

  test("40 nodes on one withdrawn source: 25 listed, 15 named as hidden, the total is 40", () => {
    const titles = Array.from({ length: 40 }, (_, i) => `A node built on the weekly report, number ${i}`);
    const out = renderCheck(
      censusOf(tree, {
        standing: {
          source: "trust-ledger",
          basis: ".ost-agent/trust/actors.jsonl",
          withdrawn: [withdrawal(HOST, titles)],
          nodes: titles.length,
          damaged: 0,
        },
      }),
    ).text;
    expect(out).toContain("40 node(s) rest on 1 source(s)");
    expect(out).toContain(`(showing ${MAX_ITEMS_PER_LIST} of 40)`);
    expect(out).toContain(`"${titles[0]}"`);
    // NON-VACUITY: the 26th is genuinely absent, so "capped" is not a claim the
    // text merely makes about itself.
    expect(out).not.toContain(`"${titles[MAX_ITEMS_PER_LIST]}"`);
  });

  test("40 withdrawn sources: 25 listed, 15 named as hidden, and the render stays in budget", () => {
    const withdrawn = Array.from({ length: 40 }, (_, i) =>
      withdrawal(`publisher-${i}.example`, [`A node built on publisher ${i}`]),
    );
    const out = renderCheck(
      censusOf(tree, {
        standing: {
          source: "trust-ledger",
          basis: ".ost-agent/trust/actors.jsonl",
          withdrawn,
          nodes: withdrawn.length,
          damaged: 0,
        },
      }),
    ).text;
    expect(out).toContain("40 node(s) rest on 40 source(s)");
    expect(out).toContain(`… 15 more withdrawn source(s) not listed (showing ${MAX_ITEMS_PER_LIST} of 40)`);
    expect(out).toContain("publisher-0.example");
    expect(out).not.toContain(`publisher-${MAX_ITEMS_PER_LIST}.example`);
    expect(Buffer.byteLength(out)).toBeLessThan(RENDER_BUDGET_BYTES);
  });

  test("a ledger of 5,000 withdrawals cannot spend the render — the counts are still true", () => {
    // The measurement the header-charging exists for: uncharged headers put
    // 5,000 lines into a 48 KB budget. The verdict line is computed before any
    // sampling, so it reports all 5,000 either way.
    const withdrawn = Array.from({ length: 5000 }, (_, i) =>
      withdrawal(`publisher-${i}.example`.padEnd(180, "x"), [`A node built on publisher ${i}`]),
    );
    const out = renderCheck(
      censusOf(tree, {
        standing: { source: "trust-ledger", basis: "b", withdrawn, nodes: withdrawn.length, damaged: 0 },
      }),
    );
    expect(out.text).toContain("5000 node(s) rest on 5000 source(s)");
    expect(Buffer.byteLength(out.text)).toBeLessThan(RENDER_BUDGET_BYTES);
    // And still not a failure, at any size.
    expect(out.violations).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * The stated limits
 * ------------------------------------------------------------------ */

describe("the limits, asserted rather than described", () => {
  test("the report is NOT transitive — a node beneath a suspect node is not itself named", () => {
    // Widening this needs an edge semantics the tree does not have: `links`
    // carries "parent of" and "related to" in one relation. Closing the gap later
    // must be a deliberate change to this assertion, not a silent widening.
    const parent = { ...node("Weekly churn is under-reported", `WEB:${HOST}`), links: ["A child that cites nothing"] };
    const child = node("A child that cites nothing");
    strike(HOST, "2026-06-01T00:00:00.000Z");
    const standing = reconcileWithTrust(dir, censusOf([parent, child]))!;
    expect(standing.withdrawn[0].nodes).toEqual(["Weekly churn is under-reported"]);
    expect(standing.nodes).toBe(1);
  });

  test("KNOWN GAP: a URL-shaped `WEB:` source is NOT matched, and the fix is one character class", () => {
    // `sourceTrustKey`'s capture is `/^WEB:\s*([^\s/]+)/`, which stops at the
    // first slash — so `WEB:https://host/page` captures `https:` and resolves to
    // nothing. `normalizeHost` (which `tryActorKey` already calls) strips schemes
    // and paths perfectly well; widening the capture to `(\S+)` closes it.
    //
    // Pinned rather than worked around HERE because the resolver is shared: the
    // same miss makes `standingCeiling` grant no ceiling to a node citing that
    // shape (B12's wire), so a local copy in this module would fix the report and
    // leave the write boundary open — the exact duplication R4 was spent removing.
    // The documented shape is `WEB:<host>` and `ost_read_web` prints that, so this
    // is an agent typo rather than a normal path; it is still an under-report.
    strike(HOST, "2026-06-01T00:00:00.000Z");
    const standing = reconcileWithTrust(
      dir,
      censusOf([node("A node citing the full URL", `WEB:https://${HOST}/onboarding`)]),
    )!;
    expect(standing.withdrawn[0].nodes).toEqual([]);
  });

  test("a source naming no actor at all is out of scope, and the ledger cannot reach it", () => {
    // "Arrived on nothing" is a different fact from "arrived on a channel that
    // earned nothing". A hand-written note has no ledger row to strike, so no
    // strike can sweep it in — the fail-closed direction.
    strike(HOST, "2026-06-01T00:00:00.000Z");
    const standing = reconcileWithTrust(dir, censusOf([node("A hand-written note", "INTERVIEW: with a customer")]))!;
    expect(standing.withdrawn[0].nodes).toEqual([]);
  });

  test("readTrustLedger is the single reader — this module owns no second parse", () => {
    // R4's lesson. The first version of this mechanism carried its own copy of the
    // ledger parse, aimed at a different file, and that duplication is exactly how
    // the report came to read a file no writer produced.
    const census = fs.readFileSync(path.join(process.cwd(), "src/ost/census.ts"), "utf8");
    expect(census).toContain("readTrustLedger");
    expect(census).not.toContain("hostTrustPath");
  });

  test("the ledger the report reads is the ledger the tool writes", () => {
    // Stated as an equality rather than trusted: two path helpers is how the two
    // halves came apart the first time.
    strike(HOST, "2026-06-01T00:00:00.000Z");
    expect(readTrustLedger(dir).histories.size).toBe(1);
    expect(reconcileWithTrust(dir, censusOf([]))!.basis).toBe(
      path.relative(path.resolve(dir), trustLedgerPath(dir)),
    );
  });
});
