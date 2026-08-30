/**
 * The instrument for "Would an operator adopt an outside-sourced candidate into
 * their consideration set" — the half of it a repository can answer.
 *
 * The vault's assumption test mixes three imported candidates into a native set
 * of six and asks a person which they carry forward. That question presumes the
 * operator can see where each one came from; a candidate whose origin the tree
 * cannot name is not a thing anyone can sensibly adopt OR refuse. This asserts
 * the precondition, in the three parts the solution node's definition of done
 * fixes:
 *
 *   1. every outside-in candidate records its host as `WEB:<host>`;
 *   2. it enters at the `assertion` floor whatever that host's standing;
 *   3. one created without a retrievable source is refused.
 *
 * What it does NOT settle, said here so a green run is not over-read: whether an
 * operator would adopt one. That is a person's decision on real candidates and
 * it stays with a person. Green means the origin is on the record, not that the
 * import was any good.
 *
 * Every block carries a non-vacuity control — the assertion that would fail if
 * the mechanism under it were deleted. Rule 2 is the one that needs it most: the
 * floor is also the DEFAULT answer, so a test that only asserted `assertion`
 * would pass just as happily against a module that consulted the ledger and
 * found nothing. So the ledger here is seeded until `webStanding` genuinely
 * returns `expert`, and the same host is then asked for a candidate's rung.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  assertOutsideInCandidate,
  assertOutsideInProvenance,
  buildOutsideInPrompt,
  checkOutsideInCandidate,
  checkOutsideInProvenance,
  MIN_QUOTE_CHARS,
  OUTSIDE_IN_FIELDS,
  OUTSIDE_IN_RUNG,
  OutsideInError,
  outsideInCandidate,
  outsideInRungNote,
  outsideInSource,
  outsideInStanding,
  type OutsideInDraft,
} from "../../src/web/outside-in.js";
import {
  actorKey,
  appendObservation,
  CORROBORATIONS_FOR_CEILING,
  readTrustLedger,
  sourceTrustKey,
  webStanding,
  type ActorKey,
} from "../../src/knowledge/actor-trust.js";
import { FLOOR_RUNG } from "../../src/knowledge/believability.js";
import { buildOstTools, type ToolContext } from "../../src/security/tools.js";
import { createLookupBudget } from "../../src/web/budget.js";
import { Vault } from "../../src/ost/vault.js";
import type { WebFetchFn, WebPage } from "../../src/web/reader.js";

let dir: string;
/** One fixed instant. A `Date.now()` here would make a rung a thing the suite cannot reproduce. */
const T0 = new Date("2026-01-01T00:00:00.000Z");
const at = (ms: number) => () => new Date(T0.getTime() + ms);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-outside-in-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const OPPORTUNITY = "When I ask for options I get three phrasings of one idea";

const PAGE_TEXT =
  "How we run design reviews\n" +
  "Every proposal arrives with a written pre-read, and the room reads it in silence for ten minutes before anyone speaks.\n" +
  "Nobody presents. The author answers questions instead.";

const QUOTE = "the room reads it in silence for ten minutes before anyone speaks";

function page(over: Partial<WebPage> = {}): WebPage {
  return {
    url: "https://example.com/design-reviews",
    host: "example.com",
    title: "How we run design reviews",
    text: PAGE_TEXT,
    truncated: false,
    ...over,
  };
}

function draft(over: Partial<OutsideInDraft> = {}): OutsideInDraft {
  return {
    opportunity: OPPORTUNITY,
    candidate: "Circulate each candidate as a written pre-read and hold a silent reading period before any discussion",
    drawnFrom: "Amazon-style narrative design reviews, as example.com describes running them",
    quote: QUOTE,
    ...over,
  };
}

/** Seed a real `expert` standing for a host, the only way the ledger grants one. */
function promoteHost(key: ActorKey): void {
  for (let i = 0; i < CORROBORATIONS_FOR_CEILING; i++) {
    appendObservation(dir, { ...key, type: "corroboration", test: `test ${i}`, verdict: "supported", by: "test" }, at(i));
  }
}

describe("rule 1 — the candidate records its host as WEB:<host>", () => {
  test("a minted candidate carries the host and the provenance spelling the ladder parses", () => {
    const c = outsideInCandidate(draft(), page());
    expect(c.host).toBe("example.com");
    expect(c.source).toBe("WEB:example.com");
    expect(c.url).toBe("https://example.com/design-reviews");
    // Not a string this test invented: the same spelling `sourceTrustKey` resolves
    // to a ledger row, so the provenance a candidate writes is the provenance the
    // trust ledger reads. A source of "example.com" or "from example.com" keys nothing.
    expect(sourceTrustKey(c.source, new Map())).toEqual(actorKey("web", "example.com"));
    expect(sourceTrustKey(c.host, new Map())).toBeNull();
  });

  test("outsideInSource is the one spelling, and the host it names is the host that was fetched", () => {
    expect(outsideInSource("Example.COM")).toBe("WEB:example.com");
    // A candidate whose recorded host is not its URL's host would send a reader to
    // one publisher and credit another. Refused, not silently corrected.
    const violations = checkOutsideInCandidate(draft(), page({ host: "trusted-blog.example.org" }));
    expect(violations.map((v) => v.kind)).toContain("host-mismatch");
  });

  test("a candidate arriving as data is checked against its own url", () => {
    const good = outsideInCandidate(draft(), page());
    expect(checkOutsideInProvenance(good)).toEqual([]);
    expect(() => assertOutsideInProvenance({ ...good, source: "WEB:somewhere-else.com" })).toThrow(OutsideInError);
    expect(() => assertOutsideInProvenance({ ...good, source: "example.com" })).toThrow(/wrong-provenance/);
  });
});

describe("rule 2 — it enters at the assertion floor whatever the host's standing", () => {
  test("a host the ledger has raised to expert still yields a floor candidate", () => {
    const key = actorKey("web", "example.com");
    promoteHost(key);
    const earned = webStanding(readTrustLedger(dir), "example.com");
    // Non-vacuity: if this is not `expert`, the contrast below is vacuous and the
    // test would pass against a module that simply read the ledger.
    expect(earned).toBe("expert");

    const c = outsideInCandidate(draft(), page());
    expect(c.evidence).toBe(FLOOR_RUNG);
    expect(OUTSIDE_IN_RUNG).toBe("assertion");

    const standing = outsideInStanding(earned);
    expect(standing.rung).toBe("assertion");
    // The host's earned rung is not discarded — it is reported beside the rung, so a
    // reader sees a well-regarded publisher and an untested transplant as two facts.
    expect(standing.hostStanding).toBe("expert");
    expect(standing.cappedBelowHost).toBe(true);
  });

  test("a candidate that declares anything above the floor is refused", () => {
    const c = outsideInCandidate(draft(), page());
    expect(() => assertOutsideInProvenance({ ...c, evidence: "expert" })).toThrow(/unearned-rung/);
    expect(() => assertOutsideInProvenance({ ...c, evidence: "observed" })).toThrow(/unearned-rung/);
    // Non-vacuity: the floor itself passes, so the refusal is about the rung and not
    // about the field being read at all.
    expect(checkOutsideInProvenance({ ...c, evidence: "assertion" })).toEqual([]);
  });

  test("ost_read_web tells the agent the rule at the moment it would break it", async () => {
    promoteHost(actorKey("web", "example.com"));
    const fetchFn: WebFetchFn = async () => ({
      status: 200,
      ok: true,
      headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "text/html" : null) },
      text: async () => `<title>How we run design reviews</title><p>${PAGE_TEXT}</p>`,
    });
    const ctx: ToolContext = {
      vault: new Vault(dir),
      dir,
      remote: { enabled: false },
      surface: "test",
      web: { fetchFn, budget: createLookupBudget(5) },
    };
    const readWeb = buildOstTools(ctx).find((t) => t.name === "ost_read_web") as unknown as {
      run: (i: unknown) => Promise<string>;
    };
    const out = await readWeb.run({ url: "https://example.com/design-reviews" });
    // The host's earned rung is still reported — this adds a second fact, it does
    // not replace the first.
    expect(out).toContain("host trust: expert");
    expect(out).toContain(outsideInRungNote("example.com", "expert"));
    expect(out).toMatch(/enters at 'assertion'/);
  });
});

describe("rule 3 — one created without a retrievable source is refused", () => {
  test("no page at all is the refusal, not a candidate with a blank origin", () => {
    expect(() => outsideInCandidate(draft(), null)).toThrow(OutsideInError);
    expect(() => outsideInCandidate(draft(), undefined)).toThrow(/no-source/);
    expect(checkOutsideInCandidate(draft(), null).map((v) => v.kind)).toEqual(["no-source"]);
  });

  test("a url this system would not fetch is not a retrievable source", () => {
    for (const url of ["http://localhost:8080/notes", "https://192.168.1.10/wiki", "not-a-url", "file:///etc/passwd"]) {
      const kinds = checkOutsideInCandidate(draft(), page({ url, host: "example.com" })).map((v) => v.kind);
      expect(kinds).toContain("unretrievable-source");
    }
    // Non-vacuity: the same draft against a public url passes.
    expect(checkOutsideInCandidate(draft(), page())).toEqual([]);
  });

  test("a quote that is not on the retrieved page is a fabricated citation, and is refused", () => {
    const kinds = checkOutsideInCandidate(
      draft({ quote: "every proposal is scored by a panel of five independent reviewers" }),
      page(),
    ).map((v) => v.kind);
    expect(kinds).toContain("quote-not-on-page");
  });

  test("whitespace between the rendered page and the reduced text does not count as a mismatch", () => {
    // `htmlToText` collapses runs of space and rewrites block tags as newlines, so a
    // passage copied off the page differs by whitespace far more often than by content.
    const c = outsideInCandidate(draft({ quote: "  The room   reads it\nin silence for ten minutes  " }), page());
    expect(c.evidence).toBe(OUTSIDE_IN_RUNG);
  });

  test("a candidate with no citable passage at all is refused", () => {
    expect(checkOutsideInCandidate(draft({ quote: "" }), page()).map((v) => v.kind)).toContain("no-quote");
    expect(checkOutsideInCandidate(draft({ quote: "yes" }), page()).map((v) => v.kind)).toContain("no-quote");
    expect(MIN_QUOTE_CHARS).toBeGreaterThan(0);
  });

  test("the fields an operator needs to weigh it are required", () => {
    for (const field of ["opportunity", "candidate", "drawnFrom"] as const) {
      const kinds = checkOutsideInCandidate(draft({ [field]: "  " }), page()).map((v) => v.kind);
      expect(kinds).toContain("missing-field");
    }
  });

  test("the refusal names what is wrong, so the caller can fix it rather than retry blind", () => {
    try {
      assertOutsideInCandidate(draft({ quote: "invented passage nobody wrote" }), page());
      throw new Error("expected a refusal");
    } catch (err) {
      expect(err).toBeInstanceOf(OutsideInError);
      const e = err as OutsideInError;
      expect(e.violations.map((v) => v.kind)).toContain("quote-not-on-page");
      expect(e.message).toContain(OPPORTUNITY);
      expect(e.message).toContain("https://example.com/design-reviews");
    }
  });
});

describe("the prompt that asks for them", () => {
  test("names a distinct place to look per candidate, and asks for what the constructor requires", () => {
    const p = buildOutsideInPrompt({ opportunity: OPPORTUNITY, candidates: 3, existingSolutions: ["Blind ideators"] });
    expect(p.fields).toEqual(OUTSIDE_IN_FIELDS.slice(0, 3));
    expect(new Set(p.fields).size).toBe(3);
    for (const f of p.fields) expect(p.text).toContain(f);
    // A prompt that did not ask for a URL and a passage would be manufacturing
    // refusals rather than candidates.
    expect(p.text).toMatch(/URL/);
    expect(p.text).toContain(String(MIN_QUOTE_CHARS));
    expect(p.text).toContain(OPPORTUNITY);
    expect(p.text).toContain("Blind ideators");
    // The rung rule reaches the model too: an agent told to look outward and not told
    // where the result lands is an agent that will file it wherever the host sits.
    expect(p.text).toContain(`'${OUTSIDE_IN_RUNG}'`);
  });

  test("somewhere outside software is always among the places to look", () => {
    // "Look at how others solved it" returns the same three SaaS products every time,
    // which is the narrowness this whole node exists to break.
    expect(OUTSIDE_IN_FIELDS.some((f) => /industry|physical|manual/i.test(f))).toBe(true);
  });

  test("asking for zero candidates is a refusal, not an empty prompt", () => {
    expect(() => buildOutsideInPrompt({ opportunity: OPPORTUNITY, candidates: 0 })).toThrow(OutsideInError);
    expect(() => buildOutsideInPrompt({ opportunity: OPPORTUNITY, candidates: 1.5 })).toThrow(OutsideInError);
  });
});
