import { expect, test } from "vitest";
import { VERSION } from "../src/index.js";

test("package root is importable and exposes a semver VERSION", () => {
  // Exact value is asserted against package.json in test/release/version.test.ts;
  // here we only pin the shape so a version bump doesn't need two edits.
  expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
});
