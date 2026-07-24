import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { buildOstTools } from "../../src/security/tools.js";
import { Vault } from "../../src/ost/vault.js";

let dir: string;
let ctx: Parameters<typeof buildOstTools>[0];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-evidence-"));
  ctx = { vault: new Vault(dir), dir, remote: { enabled: false } };
  ctx.vault.createNode({ title: "Some outcome", layer: "Outcome", tags: [], links: [], body: "o" });
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const createTool = () => {
  const t = buildOstTools(ctx).find((x) => x.name === "ost_create_node")!;
  return (input: unknown) => (t as unknown as { run: (i: unknown) => Promise<string> }).run(input);
};

describe("ost_create_node and the believability ladder", () => {
  test("records the declared rung on the node it creates", async () => {
    await createTool()({
      title: "Teams abandon discovery under delivery pressure",
      layer: "Opportunity",
      parent: "Some outcome",
      body: "from an interview",
      evidence: "stated",
    });

    expect(ctx.vault.read("Teams abandon discovery under delivery pressure").evidence).toBe("stated");
  });

  test("refuses a node that declares no rung", async () => {
    await expect(
      createTool()({ title: "Unlabelled idea", layer: "Opportunity", parent: "Some outcome", body: "b" }),
    ).rejects.toThrow(/evidence/i);
    expect(ctx.vault.has("Unlabelled idea")).toBe(false);
  });

  test("refuses a rung that is not on the ladder rather than inventing one", async () => {
    await expect(
      createTool()({
        title: "Overclaimed idea",
        layer: "Opportunity",
        parent: "Some outcome",
        body: "b",
        evidence: "proven",
      }),
    ).rejects.toThrow(/assertion/);
    expect(ctx.vault.has("Overclaimed idea")).toBe(false);
  });
});
