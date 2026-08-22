/**
 * The instrument for "Does an independent judge raise trust over self-report" —
 * the half of it a repository can answer.
 *
 * The assumption test's own threshold is five operators rating the same tree
 * framed two ways, and it stays with a person. What cannot stay with a person is
 * the precondition underneath it: a judge that is secretly the proposer cannot
 * raise trust over self-report no matter what a reader says. So this file
 * asserts the independence mechanically, in the three clauses the instrument
 * names:
 *
 * 1. the judging call is issued under an identity distinct from the proposing
 *    call's;
 * 2. its context contains the candidate and NOT the proposer's reasoning trace;
 * 3. a configuration that routes both roles to the same session fails.
 *
 * Two of the tests below matter more than the rest, because they are the ones
 * that would still hold against a wiring nobody has written yet. The ambient
 * session check catches a judging tool bolted onto the surface that writes the
 * tree — that call would record a perfectly distinct identity and run in the
 * proposer's own context. And the leak checks run against the real assembly
 * path, with a trace planted verbatim and again reformatted, because a checker
 * that has only ever seen prompts a pure function built proves nothing about a
 * loop that accumulates as it goes.
 *
 * What green here does NOT mean: that trust rose. Nothing in this file measures
 * a reader.
 */
import { describe, expect, test } from "vitest";
import {
  MIN_TRACE_WORDS,
  RUBBER_STAMP_FLOOR,
  SHELL_SESSION,
  assertJudgeIndependence,
  assertJudgeOutOfSession,
  assembleJudgePrompt,
  buildJudgeCall,
  checkJudgeIndependence,
  independenceReport,
  judgeIdentity,
  rateIndependently,
  renderIndependence,
  separatingAxes,
  settleReview,
  subjectOf,
  type Identity,
  type JudgeCall,
  type Proposal,
  type Review,
  type SettledReview,
} from "../../src/eval/judge-independence.js";
import {
  FAITHFULNESS_SCALE,
  GROUNDING_RATER,
  PROVENANCE_EXHIBIT,
  type Exhibit,
} from "../../src/eval/faithfulness.js";
import { withAttribution } from "../../src/telemetry/usage.js";
import { MCP_TOOL_NAMES, mutatesVault } from "../../src/mcp/server.js";

const NODE = "Independent judge separate from the proposer";

/** The run that writes the tree: a minted MCP session, holding the tools that commit. */
const PROPOSER: Identity = {
  role: "proposer",
  agent: "ost-proposer",
  session: "mcp-8f21c0d4",
  model: "claude-opus",
  tools: ["ost_read_tree", "ost_create_node", "ost_append_to_node"],
};

/** The judge: a separate identity, holding nothing that can act on its own verdict. */
const JUDGE: Identity = judgeIdentity(GROUNDING_RATER.name);

const SOURCE = "INBOX:2026-07-22-dogfooding-idea.md";

const EXHIBITS: readonly Exhibit[] = [
  {
    id: PROVENANCE_EXHIBIT,
    text: [`source: ${SOURCE}`, "rung claimed: assertion", "rung the source earns: assertion", `stored record: ${SOURCE}`].join("\n"),
  },
  {
    id: SOURCE,
    text:
      "I need confidence that the agent isn't grading its own homework. A system that both improves things and " +
      "certifies that it improved them is a hall of mirrors. I want the roles kept separate: the tool proposes, " +
      "something independent checks faithfulness against the evidence.",
  },
];

/** The proposer's trace. Prose about the same subject as the claim — which is why the floor is six words. */
const REASONING =
  "I read the founder note twice and took the hall-of-mirrors line as the operative complaint. " +
  "Then I wrote the claim to match the wording of the second sentence, because that framing is the one an " +
  "operator would recognise, and I graded my own draft a four on the way out.";

const proposal = (over: Partial<Proposal> = {}): Proposal => ({
  node: NODE,
  candidate:
    "Split the roles: the generating agent only proposes, and a distinct judge checks each node's faithfulness " +
    "against the cited evidence.",
  exhibits: EXHIBITS,
  reasoning: REASONING,
  selfReport: { score: 4, rationale: "The claim restates the operator's own words, so I am confident in it." },
  by: PROPOSER,
  ...over,
});

const review = (over: Partial<Proposal> = {}, judge: Identity = JUDGE): Review => {
  const p = proposal(over);
  return { proposal: p, judge: buildJudgeCall(p, judge) };
};

/** A judging call with `text` appended to its prompt — the shape every leak takes. */
function spliced(base: Review, text: string): Review {
  const judge: JudgeCall = { ...base.judge, prompt: `${base.judge.prompt}\n${text}` };
  return { ...base, judge };
}

describe("the judging call", () => {
  test("is issued under an identity distinct from the proposing call's", () => {
    const r = review();
    expect(r.judge.by.role).toBe("judge");
    expect(r.proposal.by.role).toBe("proposer");
    expect(separatingAxes(r.proposal.by, r.judge.by)).toEqual(["session", "agent", "model"]);
    expect(checkJudgeIndependence(r, undefined)).toEqual([]);
    expect(() => assertJudgeIndependence(r, undefined)).not.toThrow();
  });

  test("is assembled from the claim and the evidence, and holds no field a trace could travel in", () => {
    const r = review();
    expect(Object.keys(r.judge.context).sort()).toEqual(["candidate", "exhibits", "node"]);
    expect(r.judge.prompt).toContain(r.proposal.candidate);
    for (const exhibit of EXHIBITS) expect(r.judge.prompt).toContain(exhibit.text);
  });

  test("never carries the proposer's reasoning trace — said over the raw text, not through the checker", () => {
    const r = review();
    for (const sentence of REASONING.split(". ")) {
      expect(r.judge.prompt).not.toContain(sentence.trim());
    }
    expect(r.judge.prompt).not.toContain(r.proposal.selfReport!.rationale);
  });

  test("does not name who proposed, so the judge has nothing to defer to", () => {
    const r = review();
    expect(r.judge.prompt).not.toContain(PROPOSER.agent);
    expect(r.judge.prompt).not.toContain(PROPOSER.session);
    expect(r.judge.prompt).not.toContain(PROPOSER.model);
  });

  test("is reproducible from what the review records, so a spliced prompt cannot survive a rebuild", () => {
    const r = review();
    expect(r.judge.prompt).toBe(assembleJudgePrompt(r.judge.context, r.judge.by));
  });

  test("holds no tool that writes the tree", () => {
    expect(JUDGE.tools).toEqual([]);
    // And the proposer's do write, so the split is between two real capabilities.
    expect(PROPOSER.tools.filter(mutatesVault)).toEqual(["ost_create_node", "ost_append_to_node"]);
  });
});

describe("a review that is not what it claims to be", () => {
  test("fails when the proposer's reasoning is spliced into the judge's prompt", () => {
    const leak = "Then I wrote the claim to match the wording of the second sentence";
    const kinds = checkJudgeIndependence(spliced(review(), leak), undefined).map((v) => v.kind);
    expect(kinds).toContain("reasoning-trace-in-context");
    // The rebuild catches it too, and needs no trace to do so: an accumulating
    // loop's prompt is not a function of the context it recorded.
    expect(kinds).toContain("context-drift");
    expect(() => assertJudgeIndependence(spliced(review(), leak), undefined)).toThrow(/reasoning-trace-in-context/);
  });

  test("fails on a leak that was reformatted on the way in", () => {
    const reformatted = "then I WROTE the claim, to match   the wording of the second sentence.";
    const kinds = checkJudgeIndependence(spliced(review(), reformatted), undefined).map((v) => v.kind);
    expect(kinds).toContain("reasoning-trace-in-context");
  });

  test("fails when the proposer's own sign-off reaches the judge", () => {
    const r = spliced(review(), "The proposer scored this a 4: the claim restates the operator's own words.");
    const kinds = checkJudgeIndependence(r, undefined).map((v) => v.kind);
    expect(kinds).toContain("self-report-in-context");
  });

  test("does not call a trace that quotes the evidence a leak — the judge reads that by design", () => {
    const quoting = review({
      reasoning:
        "The note says: A system that both improves things and certifies that it improved them is a hall of mirrors. " +
        "So I kept the wording. Whether that is the strongest reading, I could not say.",
    });
    expect(checkJudgeIndependence(quoting, undefined)).toEqual([]);
  });

  test("refuses a trace too short to tell a leak from a coincidence, and one that does not exist", () => {
    const terse = checkJudgeIndependence(review({ reasoning: "Seemed right." }), undefined);
    expect(terse).toEqual([expect.objectContaining({ kind: "uncheckable-trace" })]);
    expect(terse[0].detail).toContain(`${MIN_TRACE_WORDS} words`);
    const none = checkJudgeIndependence(review({ reasoning: "" }), undefined);
    expect(none).toEqual([expect.objectContaining({ kind: "uncheckable-trace" })]);
    // Vacuous, not met: a property nothing could have violated has not been checked.
    expect(none[0].detail).toContain("vacuous");
  });

  test("fails when the judge was not shown the claim it is meant to be judging", () => {
    const base = review();
    const elsewhere = { ...base.judge.context, candidate: "Some other node's claim entirely, at length." };
    const r: Review = { ...base, judge: { ...base.judge, context: elsewhere, prompt: assembleJudgePrompt(elsewhere, JUDGE) } };
    expect(checkJudgeIndependence(r, undefined).map((v) => v.kind)).toEqual(["candidate-absent-from-context"]);
  });

  test("fails when the judge holds a tool that writes the tree", () => {
    const armed: Identity = { ...JUDGE, tools: ["ost_read_tree", "ost_set_status"] };
    const violations = checkJudgeIndependence(review({}, armed), undefined);
    expect(violations).toEqual([expect.objectContaining({ kind: "judge-writes-the-tree" })]);
    expect(violations[0].detail).toContain("ost_set_status");
    // The rule is the dispatcher's own, not a second list that could drift from it.
    expect(mutatesVault("ost_set_status")).toBe(true);
    expect(mutatesVault("ost_read_tree")).toBe(false);
  });

  test("fails when the judge is the proposer under a second heading", () => {
    const sameAgent: Identity = { ...JUDGE, agent: PROPOSER.agent };
    expect(checkJudgeIndependence(review({}, sameAgent), undefined).map((v) => v.kind)).toEqual(["shared-agent"]);
  });

  test("fails when an identity is filed under the wrong role", () => {
    const mislabelled: Identity = { ...JUDGE, role: "proposer" };
    expect(checkJudgeIndependence(review({}, mislabelled), undefined).map((v) => v.kind)).toContain("role-mismatch");
  });
});

describe("a configuration that routes both roles to the same session", () => {
  test("fails on the recorded identities", () => {
    const shared: Identity = { ...JUDGE, session: PROPOSER.session };
    const violations = checkJudgeIndependence(review({}, shared), undefined);
    expect(violations.map((v) => v.kind)).toEqual(["shared-session"]);
    expect(() => assertJudgeIndependence(review({}, shared), undefined)).toThrow(/shared-session/);
  });

  test("fails on the ambient session even when the recorded identity looks distinct", () => {
    // This is the wiring mistake a struct cannot catch: a judging tool exposed on
    // the surface that writes the tree records its own identity and runs inside
    // the proposer's context anyway.
    const r = review();
    withAttribution({ session: PROPOSER.session }, () => {
      expect(checkJudgeIndependence(r).map((v) => v.kind)).toEqual(["judging-inside-proposing-session"]);
      expect(() => assertJudgeIndependence(r)).toThrow(/judging-inside-proposing-session/);
      expect(() => settleReview(r, { score: 3, by: JUDGE })).toThrow(/judging-inside-proposing-session/);
      expect(() => rateIndependently(r, GROUNDING_RATER)).toThrow(/judging-inside-proposing-session/);
    });
    // Outside the scope the same review is clean, so the refusal is about where
    // the call is issued rather than about the review.
    expect(checkJudgeIndependence(r)).toEqual([]);
  });

  test("a pass that holds no proposal at all still refuses to judge from inside a session", () => {
    expect(() => assertJudgeOutOfSession(JUDGE, "12 node(s)")).not.toThrow();
    withAttribution({ session: "mcp-anything" }, () => {
      expect(() => assertJudgeOutOfSession(JUDGE, "12 node(s)")).toThrow(/inside session "mcp-anything"/);
    });
    expect(JUDGE.session).toBe(SHELL_SESSION);
  });

  test("the premise that refusal rests on: every session this repository mints belongs to a writing surface", () => {
    // `assertJudgeOutOfSession` refuses on the mere existence of an ambient
    // session. That is only sound while the sole surface minting one holds tools
    // that write the tree — pinned here rather than asserted in a comment.
    expect(MCP_TOOL_NAMES.filter(mutatesVault).length).toBeGreaterThan(0);
  });
});

describe("the verdict", () => {
  test("is recorded with both identities and the axes they differ on", () => {
    const settled = settleReview(review(), { score: 3, by: JUDGE });
    expect(settled.node).toBe(NODE);
    expect(settled.judge).toEqual(JUDGE);
    expect(settled.proposer).toEqual(PROPOSER);
    expect(settled.axes).toEqual(["session", "agent", "model"]);
    expect(settled.selfScore).toBe(4);
    expect(settled.agreedWithProposer).toBe(false);
  });

  test("refuses one the proposer signed", () => {
    expect(() => settleReview(review(), { score: 5, by: PROPOSER })).toThrow(/verdict-by-proposer/);
  });

  test("refuses one signed by an identity the call was not issued under", () => {
    const thirdParty = judgeIdentity("someone-else");
    expect(() => settleReview(review(), { score: 5, by: thirdParty })).toThrow(/verdict-not-from-the-judge/);
  });

  test("refuses one off the scale the self-report is on, so the two stay comparable", () => {
    expect(() => settleReview(review(), { score: FAITHFULNESS_SCALE.max + 1, by: JUDGE })).toThrow(/the scale is/);
  });

  test("carries no comparison when the proposer offered no sign-off", () => {
    const settled = settleReview(review({ selfReport: undefined }), { score: 3, by: JUDGE });
    expect(settled.selfScore).toBeUndefined();
    expect(settled.agreedWithProposer).toBeUndefined();
  });
});

describe("the judging seam this repository already has", () => {
  test("what a rater is handed is the judge's context, which has nowhere to put a trace", () => {
    const subject = subjectOf(review().judge);
    expect(Object.keys(subject).sort()).toEqual(["claim", "exhibits", "node"]);
    expect(subject.claim).toBe(proposal().candidate);
    expect(JSON.stringify(subject)).not.toContain("hall-of-mirrors line");
  });

  test("the deterministic rater plugs in as an independent judge, unchanged", () => {
    const r = review();
    const settled = rateIndependently(r, GROUNDING_RATER);
    expect(settled.verdict.by).toEqual(JUDGE);
    expect(settled.verdict.score).toBe(GROUNDING_RATER.rate(subjectOf(r.judge)).score);
    expect(settled.verdict.score).toBeGreaterThanOrEqual(FAITHFULNESS_SCALE.min);
    expect(settled.verdict.score).toBeLessThanOrEqual(FAITHFULNESS_SCALE.max);
    // The span is the judge's own citation, quotable from what it was shown.
    const cited = r.judge.context.exhibits.find((e) => e.id === settled.verdict.citation!.exhibit);
    expect(cited!.text).toContain(settled.verdict.citation!.span);
  });

  test("refuses a rater running under a name that is not its own", () => {
    expect(() => rateIndependently(review({}, judgeIdentity("independent-judge")), GROUNDING_RATER)).toThrow(
      /an identity is which program ran/,
    );
  });
});

describe("what the second pass bought", () => {
  const settle = (node: string, score: number, self: number, judge: Identity = JUDGE): SettledReview =>
    settleReview(
      { ...review({ node, selfReport: { score: self, rationale: "Confident." } }, judge) },
      { score, by: judge },
    );

  test("counts where the judge landed somewhere other than the proposer's own score", () => {
    const report = independenceReport([settle("a", 2, 4), settle("b", 4, 4), settle("c", 1, 5)]);
    expect(report.judge).toBe(GROUNDING_RATER.name);
    expect(report.reviews).toBe(3);
    expect(report.comparable).toBe(3);
    expect(report.affirmed).toBe(1);
    expect(report.dissented).toBe(2);
    expect(report.dissentedOn).toEqual(["a", "c"]);
    expect(report.rubberStamp).toBe(false);
  });

  test("flags a judge that has never once dissented, over enough reviews to say so", () => {
    const agreeing = Array.from({ length: RUBBER_STAMP_FLOOR }, (_, i) => settle(`n${i}`, 4, 4));
    const report = independenceReport(agreeing);
    expect(report.rubberStamp).toBe(true);
    expect(renderIndependence(report)).toContain("RUBBER STAMP");
    // One short of the floor, unanimity is unremarkable and is not called out.
    expect(independenceReport(agreeing.slice(1)).rubberStamp).toBe(false);
  });

  test("reports a judge sharing the proposer's model instead of refusing it", () => {
    const sameBrain: Identity = { ...JUDGE, model: PROPOSER.model };
    const report = independenceReport([settle("a", 2, 4, sameBrain)]);
    expect(report.sameModel).toEqual(["a"]);
    expect(renderIndependence(report)).toContain("same model as the proposer");
    // Whether a second model is worth buying is the human's question; the roles
    // are still split by session, context and tools, so nothing is refused here.
    expect(checkJudgeIndependence(review({}, sameBrain), undefined)).toEqual([]);
  });

  test("says so when nothing was settled, rather than reporting a clean sweep over nothing", () => {
    expect(renderIndependence(independenceReport([]))).toContain("nothing to report");
  });
});
