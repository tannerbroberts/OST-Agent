import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { buildOstTools } from "../../src/security/tools.js";
import { ALLOWED_TOOL_NAMES } from "../../src/security/policy.js";
import { Vault } from "../../src/ost/vault.js";

let dir: string;
let ctx: Parameters<typeof buildOstTools>[0];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-set-evidence-"));
  ctx = { vault: new Vault(dir), dir, remote: { enabled: false } };
  ctx.vault.createNode({ title: "Legacy node", layer: "Outcome", tags: [], links: [], body: "written before the ladder" });
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const setEvidence = (input: unknown) => {
  const t = buildOstTools(ctx).find((x) => x.name === "ost_set_evidence")!;
  return (t as unknown as { run: (i: unknown) => Promise<string> }).run(input);
};

describe("ost_set_evidence", () => {
  test("is part of the closed allowlist", () => {
    expect([...ALLOWED_TOOL_NAMES]).toContain("ost_set_evidence");
  });

  test("labels a node that predates the ladder", async () => {
    await setEvidence({ title: "Legacy node", evidence: "assertion", note: "founder-authored inbox note" });

    expect(ctx.vault.read("Legacy node").evidence).toBe("assertion");
  });

  test("records the labelling in the node's history rather than silently restating it", async () => {
    await setEvidence({ title: "Legacy node", evidence: "stated", note: "from an interview" });
    await setEvidence({ title: "Legacy node", evidence: "observed", note: "usage log confirms it" });

    const body = ctx.vault.read("Legacy node").body;
    expect(body).toContain("stated");
    expect(body).toContain("observed");
    expect(body).toContain("from an interview");
  });

  test("refuses a rung that is not on the ladder", async () => {
    await expect(setEvidence({ title: "Legacy node", evidence: "proven" })).rejects.toThrow(/assertion/);
    expect(ctx.vault.read("Legacy node").evidence).toBeUndefined();
  });
});
