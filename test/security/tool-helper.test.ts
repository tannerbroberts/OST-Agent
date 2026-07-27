/**
 * The local tool() helper must be a drop-in for the SDK's betaTool: same
 * accepted shape, same `input_schema` output key that the MCP server and the
 * input validator both read.
 */
import { expect, test } from "vitest";
import { tool } from "../../src/security/tool.js";

test("normalises inputSchema to input_schema", () => {
  const t = tool({
    name: "ost_example",
    description: "d",
    inputSchema: { type: "object", properties: { a: { type: "string" } }, additionalProperties: false },
    run: async () => "ok",
  });
  expect(t.name).toBe("ost_example");
  expect(t.description).toBe("d");
  expect(t.input_schema).toEqual({
    type: "object",
    properties: { a: { type: "string" } },
    additionalProperties: false,
  });
});

test("runs the handler", async () => {
  const t = tool({
    name: "ost_example",
    description: "d",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async () => "ran",
  });
  expect(await t.run({})).toBe("ran");
});

test("refuses a non-object schema", () => {
  expect(() =>
    tool({ name: "bad", description: "d", inputSchema: { type: "string" }, run: async () => "" }),
  ).toThrow(/must be an object/);
});
