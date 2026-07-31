/**
 * The legacy host-keyed trust file, which is now READ ONLY BY THE MIGRATION.
 *
 * `rankHost`/`readHostTrust`/`hostRung` are gone (B5b: no function anywhere returns a
 * stored rung), so what is left to pin is the reader the fold depends on — and one
 * property the old reader did not have: it returns the HISTORY in order, because
 * "was ever expert" is what separates a host that was never promoted from one that was
 * demoted, and last-record-wins collapsed exactly that distinction.
 *
 * Everything the ledger does with these records is in `actor-trust.test.ts`; this file
 * is about reading the old file faithfully.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { hostTrustPath, isHostRung, normalizeHost, readLegacyHostRecords } from "../../src/knowledge/web-trust.js";
import { classifyProvenance } from "../../src/knowledge/believability.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-trust-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeLegacy(lines: unknown[]): void {
  const file = hostTrustPath(dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n") + "\n");
}

describe("normalizeHost", () => {
  test("lowercases, strips scheme/path/port/www", () => {
    expect(normalizeHost("https://Blog.Example.org:443/post?x=1")).toBe("blog.example.org");
    expect(normalizeHost("www.example.com")).toBe("example.com");
    expect(normalizeHost("Example.COM")).toBe("example.com");
  });

  test("it is a no-op on a bare word — which is why the ACTOR namespace validates the shape", () => {
    // The B6 collision started here: a normalizer that cannot fail let
    // `stripe-webhook-feed` into the publisher namespace. It is kept verbatim so the
    // migration reads legacy keys exactly as they were written; the hostname CHECK
    // lives in `actor-trust.ts`, where a row is minted.
    expect(normalizeHost("stripe-webhook-feed")).toBe("stripe-webhook-feed");
  });
});

describe("isHostRung", () => {
  test("only the two rungs a byline could ever hold", () => {
    expect(isHostRung("expert")).toBe(true);
    expect(isHostRung("assertion")).toBe(true);
    for (const rung of ["money", "observed", "stated", "gospel"]) expect(isHostRung(rung)).toBe(false);
  });
});

describe("readLegacyHostRecords", () => {
  test("returns the history in order, not a collapsed map", () => {
    writeLegacy([
      { ts: "2026-01-01T00:00:00.000Z", host: "example.com", rung: "expert", reason: "corroborated", by: "agent:mcp" },
      { ts: "2026-01-02T00:00:00.000Z", host: "example.com", rung: "assertion", reason: "failed replication", by: "agent:mcp" },
    ]);
    const recs = readLegacyHostRecords(dir);
    expect(recs.map((r) => r.rung)).toEqual(["expert", "assertion"]);
    // Non-vacuity: a reader that kept only the last record would return one row here,
    // and the migration could not tell a demotion from a host that was never promoted.
    expect(recs).toHaveLength(2);
  });

  test("hosts are normalized on the way in, so a legacy key finds its actor row", () => {
    writeLegacy([{ ts: "t", host: "https://WWW.Example.com/post", rung: "expert", reason: "r", by: "b" }]);
    expect(readLegacyHostRecords(dir)[0].host).toBe("example.com");
  });

  test("malformed and off-ladder records are skipped fail-closed", () => {
    writeLegacy([
      { ts: "t", host: "good.com", rung: "expert", reason: "r", by: "b" },
      "not json",
      { host: "bad.com", rung: "money" },
      { rung: "expert" },
    ]);
    expect(readLegacyHostRecords(dir).map((r) => r.host)).toEqual(["good.com"]);
  });

  test("a missing file is an empty history", () => {
    expect(readLegacyHostRecords(dir)).toEqual([]);
  });
});

describe("classifyProvenance without a vault", () => {
  test("WEB: lands on the floor — earned standing is the ledger's answer, not this one", () => {
    // The `hostTrust` option this function used to take was the last stored-rung read
    // in the repo (B5b). Its absence is the assertion: there is no argument by which a
    // caller can hand `classifyProvenance` a rung.
    expect(classifyProvenance("WEB:random-blog.net")).toBe("assertion");
    expect(classifyProvenance("WEB:example.com https://example.com/post")).toBe("assertion");
    expect(classifyProvenance.length).toBe(1);
  });

  test("the prefix classes it can answer without a vault are unchanged", () => {
    expect(classifyProvenance("TRANSCRIPT:abc")).toBe("observed");
    expect(classifyProvenance("JIRA:PROJ-1")).toBe("stated");
    expect(classifyProvenance("anything else")).toBe("assertion");
  });
});
