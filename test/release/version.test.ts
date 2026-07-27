import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { VERSION } from "../../src/index.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("release", () => {
  test("src VERSION matches package.json version (keep them in sync before publishing)", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8")) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });

  test("plugin.json version matches package.json version (a stale plugin version means installed plugins never see updates)", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8")) as { version: string };
    const plugin = JSON.parse(
      fs.readFileSync(path.join(REPO, ".claude-plugin", "plugin.json"), "utf8"),
    ) as { version: string };
    expect(plugin.version).toBe(pkg.version);
  });
});
