/**
 * Faithfulness judge — the independent layer of efficacy.
 *
 * This is NOT the generator grading itself. The judge is a separate, adversarial
 * pass (its own context, no stake in the tree) that checks truth-values it CAN
 * check: is each created node grounded in the evidence it cites, and is it
 * classified into the right layer (the cardinal Torres failure is an opportunity
 * that is really a solution, or an invented need the evidence never supported)?
 *
 * `Judge` is injectable so the scorecard logic is unit-tested offline with a fake
 * judge; `anthropicJudge` is the real one, run where credentials exist.
 */
import type { EvidenceRecord } from "../processes/tree.js";
import type { OstNode } from "../ost/node.js";

export interface NodeVerdict {
  title: string;
  layer: string;
  /** Is the node's claim supported by the cited/available evidence (not invented)? */
  grounded: boolean;
  /** Is it in the correct layer (an Opportunity is a need, not a solution, etc.)? */
  classifiedCorrectly: boolean;
  rationale: string;
}

export interface JudgeReport {
  verdicts: NodeVerdict[];
}

export interface JudgeInput {
  outcome: string;
  evidence: EvidenceRecord[];
  tree: OstNode[];
}

export type Judge = (input: JudgeInput) => Promise<JudgeReport>;

const VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          layer: { type: "string" },
          grounded: { type: "boolean" },
          classifiedCorrectly: { type: "boolean" },
          rationale: { type: "string" },
        },
        required: ["title", "layer", "grounded", "classifiedCorrectly", "rationale"],
      },
    },
  },
  required: ["verdicts"],
};

/** Real judge: a separate Claude call with an adversarial, skeptical rubric. */
export function anthropicJudge(model = "claude-opus-4-8"): Judge {
  return async (input: JudgeInput): Promise<JudgeReport> => {
    const { Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic();

    const evidence = input.evidence.map((e) => `[${e.id}] ${e.title}\n${e.body}`).join("\n\n");
    const nodes = input.tree
      .filter((n) => n.layer !== "Outcome")
      .map((n) => `- (${n.layer}) "${n.title}" [source: ${n.source ?? "none"}]\n  ${n.body.replace(/\n/g, " ").slice(0, 400)}`)
      .join("\n");

    const system =
      "You are a skeptical, independent evaluator of an Opportunity Solution Tree, expert in Teresa Torres's Continuous Discovery Habits. You did NOT create this tree and have no stake in it. Judge each node against the evidence. Default to grounded=false if a node's claim is not clearly supported by the evidence (invented needs are the cardinal sin). Judge classifiedCorrectly=false if an Opportunity is actually a solution/feature, a Solution is not a way to address its opportunity, or an AssumptionTest is not a testable assumption. Be strict.";

    const prompt = [
      `Desired outcome: "${input.outcome}"`,
      "",
      "EVIDENCE (the only ground truth the tree is allowed to draw on):",
      evidence,
      "",
      "NODES TO JUDGE (one verdict per node):",
      nodes,
    ].join("\n");

    const body = {
      model,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high", format: { type: "json_schema", schema: VERDICT_SCHEMA } },
      system,
      messages: [{ role: "user", content: prompt }],
    };
    type CreateBody = Parameters<typeof client.messages.create>[0];
    const res = (await client.messages.create(body as unknown as CreateBody)) as { content: Array<{ type: string; text?: string }> };
    const text = res.content.find((b) => b.type === "text")?.text ?? '{"verdicts":[]}';
    return JSON.parse(text) as JudgeReport;
  };
}
