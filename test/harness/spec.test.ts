import { describe, expect, test } from "vitest";
import {
  answerFor,
  answerKey,
  EnvironmentSpecSchema,
  findableCount,
  type EnvironmentSpec,
} from "../../src/harness/spec.js";

const SPEC: EnvironmentSpec = {
  name: "two-findable-one-not",
  kind: "generated",
  seed: 1,
  created: "2026-07-28",
  outcome: "Reach 10,000 daily active users",
  outcomeTitle: "Retention",
  nodes: [
    { title: "Retention", layer: "Outcome", body: "Reach 10,000 daily active users", links: [] },
  ],
  unknowns: [
    {
      title: "How many users hit the export path",
      darkens: "Retention",
      sections: ["Format", "Methodology", "Rationale"],
      findable: true,
      answer: "412 per day",
    },
    {
      title: "Why the trial converts",
      darkens: "Retention",
      sections: ["Format"],
      findable: false,
      answer: "",
    },
  ],
  evidence: [],
};

describe("EnvironmentSpecSchema", () => {
  test("accepts a well-formed spec", () => {
    expect(EnvironmentSpecSchema.safeParse(SPEC).success).toBe(true);
  });

  test("rejects an unknown that darkens nothing — the edge direction has no source", () => {
    const bad = { ...SPEC, unknowns: [{ ...SPEC.unknowns[0], darkens: "" }] };
    expect(EnvironmentSpecSchema.safeParse(bad).success).toBe(false);
  });

  test("rejects a findable unknown with no answer, because the key would be empty", () => {
    const bad = { ...SPEC, unknowns: [{ ...SPEC.unknowns[0], answer: "" }] };
    expect(EnvironmentSpecSchema.safeParse(bad).success).toBe(false);
  });

  test("accepts an UNfindable unknown with no answer — that is the point of one", () => {
    const ok = { ...SPEC, unknowns: [SPEC.unknowns[1]] };
    expect(EnvironmentSpecSchema.safeParse(ok).success).toBe(true);
  });

  test("rejects an unknown whose darkens names no planted node", () => {
    const bad = { ...SPEC, unknowns: [{ ...SPEC.unknowns[0], darkens: "Nowhere" }] };
    expect(EnvironmentSpecSchema.safeParse(bad).success).toBe(false);
  });

  test("rejects a duplicate unknown title, which would collide on one ledger file", () => {
    const bad = { ...SPEC, unknowns: [SPEC.unknowns[0], SPEC.unknowns[0]] };
    expect(EnvironmentSpecSchema.safeParse(bad).success).toBe(false);
  });
});

describe("answerKey", () => {
  test("carries only the findable answers", () => {
    const key = answerKey(SPEC);
    expect(key.get("How many users hit the export path")).toBe("412 per day");
    expect(key.has("Why the trial converts")).toBe(false);
  });

  test("a null environment has an empty key but is not an empty spec", () => {
    const nul: EnvironmentSpec = { ...SPEC, kind: "null", unknowns: [SPEC.unknowns[1]] };
    expect(answerKey(nul).size).toBe(0);
    expect(nul.unknowns).toHaveLength(1);
  });
});

describe("findableCount", () => {
  test("counts only what a run could actually resolve", () => {
    expect(findableCount(SPEC)).toBe(1);
  });
});

/**
 * The spec holds titles as authored; a run reports them as the vault stored
 * them, which has been through `sanitizeTitle`. Matching those raw is not a
 * withheld score — it is a WRONG one: the run resolves the unknown, the key
 * says it never heard of it, and the fitness record shows a variant that found
 * nothing.
 */
describe("titles survive the trip through the filesystem", () => {
  const colonSpec: EnvironmentSpec = {
    ...SPEC,
    nodes: [{ title: "Retention: daily", layer: "Outcome", body: "b", links: [] }],
    unknowns: [
      {
        title: "Unknown: how many users hit the export path",
        darkens: "Retention: daily",
        sections: ["Format"],
        findable: true,
        answer: "412 per day",
      },
    ],
  };

  test("`darkens` still resolves when the sanitizer rewrote the node's title", () => {
    expect(EnvironmentSpecSchema.safeParse(colonSpec).success).toBe(true);
  });

  test("the grading key answers to the title the vault will actually report", () => {
    const key = answerKey(colonSpec);
    // what computeNextWork reads back off disk — no colon
    expect(answerFor(key, "Unknown how many users hit the export path")).toBe("412 per day");
    // and the authored spelling keeps working
    expect(answerFor(key, "Unknown: how many users hit the export path")).toBe("412 per day");
  });

  test("two unknowns that collide only after sanitizing are rejected, not silently merged", () => {
    const collide: EnvironmentSpec = {
      ...colonSpec,
      unknowns: [
        { title: "Unknown: alpha", darkens: "Retention: daily", sections: ["Format"], findable: false, answer: "" },
        { title: "Unknown alpha", darkens: "Retention: daily", sections: ["Format"], findable: false, answer: "" },
      ],
    };
    const parsed = EnvironmentSpecSchema.safeParse(collide);
    expect(parsed.success).toBe(false);
  });
});
