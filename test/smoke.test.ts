import { expect, test } from "vitest";
import { VERSION } from "../src/index.js";

test("package root is importable", () => {
  expect(VERSION).toBe("0.1.0");
});
