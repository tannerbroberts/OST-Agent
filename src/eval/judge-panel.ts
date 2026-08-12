/**
 * The judge panel — several independently-configured readers over one solution,
 * where what is measured is whether they agree with EACH OTHER.
 *
 * `riskiest-assumption` judging has two separable questions, and this module
 * answers only the second. The first — can a single judge match a labelled
 * set? — is a judge-vs-answer-key question. This one is judge-vs-judge: put
 * three readers with genuinely different lenses over the same solution body,
 * have each nominate the sentence it thinks would sink the idea, and count how
 * often a majority lands on the same sentence. Judges who agree are at least
 * reading something real in the text; three judges scattering across three
 * nominations are generating, not judging.
 *
 * Three properties are load-bearing, and the panel test pins them:
 *
 * 1. **A judge sees only the solution.** `runPanel` hands every judge the same
 *    prose — title plus the author's argument — and nothing else: no labelled
 *    set, no other judge's nomination, no tree context. Independence here is
 *    structural, not promised.
 * 2. **Nominations are comparable by construction.** Every judge picks from the
 *    same extracted candidate list, so "agreement" is identity on a sentence
 *    the text actually contains — no fuzzy matching that could manufacture
 *    consensus out of two different claims worded alike.
 * 3. **A judge with nothing to say abstains.** A lens whose every marker scores
 *    zero returns no nomination rather than a default, because a default would
 *    be agreement conjured from the tie-break rule instead of the text.
 *
 * What agreement here does NOT mean, because the solution node this serves is
 * explicit about the misreading: agreement is not correctness. Three mechanical
 * lenses can converge on the same wrong sentence, particularly when the
 * author's own framing (a "what would make this wrong" paragraph) hands every
 * reader the same signpost. A green panel says the text makes its riskiest
 * assumption legible to distinct mechanical readings — not that the assumption
 * so named is the one that will actually kill the idea. And these judges are
 * deterministic heuristics, not models: they share no training, which makes
 * their independence cheaper and shallower than the human-or-model panel the
 * assumption test ultimately wants a person to run.
 */

/** What a judge is shown: the title and the author's argument, nothing else. */
export interface SolutionUnderReview {
  readonly title: string;
  /** Full markdown of the node file; {@link solutionProse} trims it first. */
  readonly body: string;
}

/** One sentence of the argument, identified by position so agreement is identity. */
export interface Candidate {
  readonly index: number;
  readonly text: string;
}

export interface Nomination {
  readonly judge: string;
  /** Absent when the judge's lens found no signal at all — an abstention. */
  readonly candidate?: Candidate;
}

export interface PanelRow {
  readonly solution: string;
  readonly nominations: readonly Nomination[];
  /** At least two judges named the same candidate. */
  readonly agreed: boolean;
  /** Every judge that nominated named a different candidate — the panel is generating. */
  readonly scattered: boolean;
  /** The majority sentence, when {@link agreed}. */
  readonly consensus?: string;
}

export interface PanelReport {
  /** Sweep discipline: a panel over nothing must be visible as such. */
  readonly subject: { readonly offered: number; readonly read: number };
  readonly rows: readonly PanelRow[];
  /** Solutions on which a majority of judges named the same assumption. */
  readonly agreementCount: number;
  /** Solutions on which the nominations all differ — reported separately, per the test's design. */
  readonly scatterCount: number;
}

/**
 * A configured judge: a name and a scoring lens over candidates. The lens sees
 * one candidate at a time and nothing else — not the labelled set, not the
 * other judges, not even the rest of the body — which is a stricter reading of
 * "seeing only the solution" than the assumption test requires.
 */
export interface Judge {
  readonly name: string;
  score(candidate: Candidate): number;
}

/**
 * The author's argument: everything between the wikilink/tag preamble and the
 * first `## ` section. Later sections — Definition of done, History, Issues,
 * censuses — are appended by other passes, and a judge reading them would be
 * reading the tree's commentary on the solution rather than the solution.
 */
export function solutionProse(markdown: string): string {
  let text = markdown;
  if (text.startsWith("---")) {
    const end = text.indexOf("\n---", 3);
    if (end !== -1) text = text.slice(end + 4);
  }
  const firstSection = text.search(/^## /m);
  if (firstSection !== -1) text = text.slice(0, firstSection);
  return text
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (t.startsWith("#")) return false; // the tag line and any stray heading
      if (/^\[\[.*\]\]$/.test(t)) return false; // edge block — tree structure, not argument
      if (t.startsWith("⚠️")) return false; // status stamp, not a claim about the world
      return true;
    })
    .join("\n")
    .trim();
}

/** Markdown emphasis and inline code stripped, so lenses see words rather than syntax. */
function plain(text: string): string {
  return text.replace(/\*\*|\*|`|\[\[|\]\]/g, "");
}

const tokenize = (text: string): string[] => plain(text).toLowerCase().match(/[a-z][a-z-]*/g) ?? [];

/**
 * The candidate list every judge picks from. A candidate is a sentence of the
 * argument long enough to assert something. Two shapes are excluded because
 * they are structure rather than claim: fragments under the length floor, and
 * bold-wrapped label sentences ("**What would make this the wrong pick.**"),
 * which head a paragraph without asserting anything themselves.
 */
export function candidateAssumptions(prose: string): Candidate[] {
  const sentences = plain(prose)
    .replace(/\s+/g, " ")
    .split(/(?<=[.?!])\s+(?=[A-Z"“(])/)
    .map((s) => s.trim())
    .filter((s) => tokenize(s).length >= 6)
    .filter((s) => !prose.includes(`**${s}**`));
  return sentences.map((text, index) => ({ index, text }));
}

/**
 * A weighted lens: markers that name the lens's concern outright count more
 * than markers that merely gesture at it. Weighting is what lets the lens
 * rather than the tie-break decide — with flat counts over sparse markers,
 * most sentences tie at one hit and sentence order picks the winner.
 */
const weighted = (markers: ReadonlyMap<string, number>) => (candidate: Candidate) =>
  tokenize(candidate.text).reduce((sum, t) => sum + (markers.get(t) ?? 0), 0);

const marks = (weight: number, words: string[]): [string, number][] => words.map((w) => [w, weight]);

/**
 * Lens one — fragility. Reads for hedged, conditional, dependency-laden
 * language: the sentences where the author is leaning on something rather than
 * standing on it. Naming the assumption outright outweighs a conditional,
 * which outweighs a bare modal.
 */
const FRAGILITY = new Map<string, number>([
  ...marks(3, ["assumes", "assume", "assumption", "risk", "proxy", "uncertain", "unproven", "untested", "hope", "guess", "depends", "depend"]),
  ...marks(2, ["if", "unless", "whether"]),
  ...marks(1, ["may", "might", "could", "would", "sometimes"]),
]);

/**
 * What every judge is allowed to nominate: an assumption. A sentence carrying
 * no conditional and no explicit dependency/risk word is asserting mechanism
 * or settled fact, and "the riskiest assumption" cannot be a sentence that
 * assumes nothing — a bare modal ("a run may call") is grammar, not doubt, so
 * the shape requires a marker stronger than that. The gate is deliberately the
 * same for all three judges: it is the task's noun, not a lens, and the
 * independence this module measures lives in how each judge RANKS the shaped
 * candidates, never in which sentences qualify.
 */
export function isAssumptionShaped(candidate: Candidate): boolean {
  return tokenize(candidate.text).some((t) => (FRAGILITY.get(t) ?? 0) >= 2);
}

/**
 * Lens two — consequence. Reads for the severity of what goes wrong: the
 * sentences that name failure, harm, or the death of the idea. Words that name
 * the idea dying outweigh words that name it merely falling short.
 */
const CONSEQUENCE = new Map<string, number>([
  ...marks(2, ["wrong", "sink", "kill", "kills", "dangerous", "danger", "unacceptable", "worst", "harm", "misleading", "vanish", "vanished", "stranded", "breaks", "broken", "defeated"]),
  ...marks(1, ["fail", "fails", "failure", "cannot", "never", "silently", "worse", "lost", "lose", "loses", "costs"]),
]);

/**
 * Lens three — counterparty. Risk lives where the solution depends on what
 * some other party does: an operator accepting a trade, a reader recognising
 * their need, a human finding the time. This is the desirability lens of the
 * discovery method this product implements, and it reads different words than
 * the other two: actors, and the verbs of consent.
 */
const COUNTERPARTY = new Map<string, number>([
  ...marks(2, ["accept", "accepts", "acceptable", "willing", "wants", "want", "trust", "trusts", "cares", "believes", "recognizes", "recognises"]),
  ...marks(1, ["operator", "operators", "human", "humans", "person", "people", "customer", "customers", "user", "users", "reader", "readers", "collaborator", "collaborators", "founder", "they", "them", "their", "someone", "anyone", "nobody"]),
]);

/** The three configured judges. Different lenses, same candidate list, no shared state. */
export const PANEL: readonly Judge[] = [
  { name: "fragility", score: weighted(FRAGILITY) },
  { name: "consequence", score: weighted(CONSEQUENCE) },
  { name: "counterparty", score: weighted(COUNTERPARTY) },
];

/**
 * Argmax over the assumption-shaped candidates, earliest-sentence tie-break;
 * zero everywhere — or nothing shaped to rank — is an abstention.
 */
function nominate(judge: Judge, candidates: readonly Candidate[]): Nomination {
  let best: Candidate | undefined;
  let bestScore = 0;
  for (const candidate of candidates) {
    if (!isAssumptionShaped(candidate)) continue;
    const score = judge.score(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best ? { judge: judge.name, candidate: best } : { judge: judge.name };
}

/**
 * Run the panel. Every judge reads every solution independently; the report
 * carries agreement and scatter as separate figures because they answer
 * different questions — agreement is the bar, scatter is the evidence that the
 * panel is generating rather than judging.
 */
export function runPanel(solutions: readonly SolutionUnderReview[], judges: readonly Judge[] = PANEL): PanelReport {
  const rows: PanelRow[] = solutions.map((solution) => {
    const prose = solutionProse(solution.body);
    const candidates = candidateAssumptions(prose);
    const nominations = judges.map((judge) => nominate(judge, candidates));

    const named = nominations.filter((n) => n.candidate);
    const byIndex = new Map<number, number>();
    for (const n of named) byIndex.set(n.candidate!.index, (byIndex.get(n.candidate!.index) ?? 0) + 1);
    const majority = [...byIndex.entries()].find(([, count]) => count >= 2);

    return {
      solution: solution.title,
      nominations,
      agreed: majority !== undefined,
      scattered: named.length === judges.length && byIndex.size === judges.length,
      consensus: majority ? candidates[majority[0]]?.text : undefined,
    };
  });

  return {
    subject: { offered: solutions.length, read: rows.length },
    rows,
    agreementCount: rows.filter((r) => r.agreed).length,
    scatterCount: rows.filter((r) => r.scattered).length,
  };
}

/**
 * The report a person reads. Every nomination is printed, not just the tally,
 * because the node this serves is explicit that disagreement is the valuable
 * output: a summary that kept only the agreement count would throw away the
 * exact rows a human needs to look at.
 */
export function renderPanel(report: PanelReport): string {
  const { offered, read } = report.subject;
  if (read === 0) {
    return `judge-panel: BLIND — read 0 of ${offered} solution(s), so no agreement figure exists.`;
  }
  const lines: string[] = [];
  lines.push(
    `judge-panel: majority agreement on ${report.agreementCount} of ${read} solution(s); ` +
      `full scatter on ${report.scatterCount}.`,
  );
  for (const row of report.rows) {
    const verdict = row.agreed ? "agreed" : row.scattered ? "SCATTERED" : "no majority";
    lines.push(`\n- ${verdict} — "${row.solution}"`);
    for (const n of row.nominations) {
      lines.push(`    ${n.judge}: ${n.candidate ? `"${n.candidate.text}"` : "(abstained — no assumption its lens could rank)"}`);
    }
  }
  return lines.join("\n");
}
