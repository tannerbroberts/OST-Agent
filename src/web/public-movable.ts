/**
 * Which open assumptions a lookup could actually move — the demand side of
 * outward reach.
 *
 * `budget.ts` decides how much looking outward is allowed. Nothing decided
 * *what to look up*, so the only available answer was "whatever the pass
 * thought of", which is a scheduled search wearing a budget. This module is the
 * other half: it walks the tree's open assumptions, labels each by whether
 * anything public could shift belief in it, and — for the ones where something
 * could — composes the query that would be spent. A lookup then has a demander
 * (the assumption), a target (where the answer would be), and a price, and the
 * queue is spent cheapest-first. A finding arrives already attached to the node
 * it bears on, because the node is what asked.
 *
 * ## What the measurement says, before anything else
 *
 * `test/web/public-movable-assumptions.test.ts` runs this over a snapshot of
 * the meta vault's 483 open assumptions and reports the count. **The count is
 * the finding, and the vault predicted it would be small.** Read that file's
 * header for the number this repository actually produces; it is not restated
 * here, because a number copied into a comment is a number that goes stale.
 *
 * ## The criteria, written down so a wrong call can be argued with by name
 *
 * An assumption is PUBLIC-MOVABLE when a document somebody else has already
 * published could raise or lower belief in it. Three ways that happens, and
 * nothing else counts:
 *
 *   1. **third-party-behaviour** — the belief turns on what a tool, platform,
 *      library, operating system or specification *outside this product* does:
 *      what it supports, refuses, ships, costs, or is implemented as. Vendor
 *      documentation, a changelog, a spec or an issue tracker is the answer.
 *   2. **published-method** — the belief turns on a named body of published
 *      work (a method, a literature, a body of recorded attacks).
 *   3. **prior-art** — the belief asserts that something does or does not
 *      already exist in the world. Product pages and release notes move it.
 *
 * And the rule that does most of the excluding: **naming an external thing is
 * not enough.** Nearly every assumption in this tree mentions `git`, a test
 * runner, or the harness, because that is what this product is made of. The
 * belief has to be *about* the external thing — the referent must carry a
 * property claim ({@link PROPERTY_SIGNAL}): a capability verb, an availability
 * predicate, or a possessive naming one of its own parts. "The loop's git push
 * is rejected" is a claim about the loop. "A git merge driver can rebuild dist
 * deterministically" is a claim about git, and git's manual is where it is
 * settled.
 *
 * ## Specific, or it does not count
 *
 * The vault's bar is not "could be moved" but "yields a **specific,
 * searchable** question", so specificity is enforced rather than asserted:
 * {@link composeLookup} returns nothing unless the query names the referent AND
 * carries at least {@link MIN_SALIENT_TERMS} content words from the belief
 * itself, after this tree's own vocabulary is removed. An assumption that
 * reduces to "vitest — tree node pass loop" is not a question anyone can spend
 * a lookup on and is counted as private-only, which costs the count and is the
 * point.
 *
 * ## What this is not
 *
 * Judging that a public source could help is not the same as one existing —
 * the vault's own assumption test says so and this module cannot close that
 * gap. Everything here is a claim about *where to look*, never about what is
 * there. The referent registry was also authored by reading this corpus, so the
 * count is on-corpus: `hand-labels.json` beside the fixture is the answer key a
 * human wrote independently of the code, and the test scores this classifier
 * against it rather than letting it certify itself.
 */

import type { OstNode } from "../ost/node.js";

/** One open assumption, as the fixture stores it. */
export interface OpenAssumption {
  title: string;
  prose: string;
  tests: { title: string; instrument: string }[];
}

/**
 * Statuses that settle an assumption. Everything else is open, and so is a
 * node with no status at all — the tree predates the field and an unlabelled
 * belief has certainly not been settled.
 */
const SETTLED = new Set(["validated", "shipped", "deferred"]);

/**
 * The same cut `scripts/harvest-open-assumptions.ts` makes, against a live
 * tree instead of the snapshot.
 *
 * Both exist on purpose. The spec measures the snapshot because the suite has
 * to be offline and deterministic; `ost-agent lookups` measures the tree in
 * front of it, because a demand queue computed from a fixture is a queue for a
 * vault that no longer exists. They share this function's reading of "open" so
 * the two can be compared rather than merely both quoted.
 */
export function openAssumptionsFrom(nodes: readonly OstNode[]): OpenAssumption[] {
  const byTitle = new Map(nodes.map((n) => [n.title, n]));
  return nodes
    .filter(
      (n) =>
        n.layer === "Assumption" &&
        !SETTLED.has(n.status ?? "") &&
        // A `## Results` block is a recorded finding against the belief. The
        // question is what is still open, so a settled one is not asked again.
        !/^## Results/m.test(n.body),
    )
    .map((n) => ({
      title: n.title,
      // `## Results` and the rest of the reserved blocks are measurements, not
      // the belief. The belief is what a lookup would bear on.
      prose: n.body.split(/\n## /)[0].trim(),
      tests: n.links
        .map((t) => byTitle.get(t))
        .filter((t): t is OstNode => t?.layer === "AssumptionTest")
        .map((t) => ({ title: t.title, instrument: t.instrument ?? "" })),
    }))
    .sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
}

/** The three ways public material can bear on a belief. */
export type PublicClass = "third-party-behaviour" | "published-method" | "prior-art";

/**
 * Something outside this product that a belief can be *about*.
 *
 * `where` is the documentation home when one exists — the difference between a
 * lookup that is one read of a known page and one that is an open search, which
 * is the whole of the cost ordering.
 */
export interface Referent {
  /** Stable id, used in the queue and in the answer key. */
  id: string;
  /** Matches a mention in the belief text. Case-insensitive, word-bounded. */
  match: RegExp;
  /** How the referent is named in a query. */
  query: string;
  /** Documentation home, or "" when the answer is only on the open web. */
  where: string;
  kind: PublicClass;
}

/**
 * The registry, grouped by what publishes the answer.
 *
 * Authored by reading the corpus — every entry below is a thing the meta
 * vault's open assumptions actually name, not a list of software in general.
 * That makes the registry a description of this tree and not a general
 * classifier, which is stated here rather than discovered by whoever ports it.
 */
export const REFERENTS: readonly Referent[] = [
  // Version control, and the parts of it this tree makes claims about.
  { id: "git", match: /\bgit (merge driver|worktrees?|attributes|hooks?)\b|\bgitattributes\b|\bmerge driver\b/i, query: "git", where: "git-scm.com/docs", kind: "third-party-behaviour" },
  { id: "github-actions", match: /\bGitHub Actions\b|\bactions runner\b|\bhosted runner\b/i, query: "GitHub Actions", where: "docs.github.com/actions", kind: "third-party-behaviour" },
  // Package managers and the JavaScript toolchain.
  { id: "npm", match: /\bnpm\b|\bpnpm\b|\byarn\b|\bpostinstall\b|\bpackage managers?\b/i, query: "npm postinstall", where: "docs.npmjs.com", kind: "third-party-behaviour" },
  { id: "vitest", match: /\bvitest\b/i, query: "vitest", where: "vitest.dev/config", kind: "third-party-behaviour" },
  { id: "tsx", match: /\btsx\b|\besbuild\b/i, query: "tsx esbuild", where: "tsx.is", kind: "third-party-behaviour" },
  { id: "typescript", match: /\bTypeScript\b/i, query: "TypeScript", where: "typescriptlang.org/docs", kind: "third-party-behaviour" },
  { id: "node", match: /\bNode\.js\b|\bnode ≥|\bnode 2\d\b/i, query: "Node.js", where: "nodejs.org/api", kind: "third-party-behaviour" },
  // The operating system the loop runs on.
  { id: "posix", match: /\bPOSIX\b|\bmacOS\b|\bcoreutils\b|\bHomebrew\b|\btimeout\(1\)\b|\bgtimeout\b|\bbash\b|\bzsh\b/i, query: "macOS POSIX shell", where: "", kind: "third-party-behaviour" },
  // The harness the unattended loop runs inside, and its protocol.
  { id: "harness", match: /\bharness\b|\bClaude Code\b|\bMonitor\b|\bGlob\b|\bAskUserQuestion\b|\bbuilt-ins?\b|\bsandbox\b|\bthe platform's\b/i, query: "Claude Code tool", where: "docs.claude.com/claude-code", kind: "third-party-behaviour" },
  { id: "mcp", match: /\bMCP\b|\bModel Context Protocol\b/i, query: "Model Context Protocol", where: "modelcontextprotocol.io/specification", kind: "third-party-behaviour" },
  { id: "model-vendor", match: /\bAnthropic\b|\bOpenAI\b|\btoken pric|\bcontext window\b|\bmodel provider\b/i, query: "Anthropic model", where: "docs.claude.com", kind: "third-party-behaviour" },
  // Editors and other people's clients over the same files.
  { id: "obsidian", match: /\bObsidian\b/i, query: "Obsidian", where: "help.obsidian.md", kind: "third-party-behaviour" },
  { id: "editor", match: /\bEditor tooling\b|\bIDE\b|\bLSP\b|\blanguage server\b/i, query: "editor tooling", where: "", kind: "third-party-behaviour" },
  // Published bodies of work.
  { id: "torres", match: /\bTorres\b|\bcontinuous discovery\b|\bopportunity solution tree\b/i, query: "Teresa Torres continuous discovery", where: "", kind: "published-method" },
  { id: "injection-literature", match: /\binjection attacks?\b|\bprompt injection\b|\bknown attacks\b/i, query: "prompt injection", where: "", kind: "published-method" },
  { id: "regulation", match: /\bEU AI Act\b|\bGDPR\b|\bSOC ?2\b|\bregulat(ion|ors?|ory)\b|\bcompliance regime\b/i, query: "AI regulation", where: "", kind: "published-method" },
];

/**
 * Prior-art claims name no vendor; they assert what the world already has.
 *
 * `already exists` is deliberately NOT here, and it is the single largest
 * correction this classifier took. It matches twelve assumptions in this
 * corpus and in every one of them it is about this repository's own code —
 * "the citation index revocation needs already exists in `evidenceExtents`",
 * "the affordance already exists and the loop simply is not reaching for it".
 * A phrase that reads as a claim about the world and is used as a claim about
 * the codebase is worse than no signal, because it produces confident queries
 * that no public page could answer.
 *
 * `prior art` itself went the same way, which is stranger and worth recording:
 * this tree uses the phrase to mean *another pass's commits in this same
 * repository* (`src/loop/prior-art-scan.ts`), not published work by anyone
 * else. In "the prior art did not exist yet" the prior art is a colleague's
 * commit from two hours earlier. Both of its occurrences here are that sense.
 */
export const PRIOR_ART_SIGNAL =
  /\boff[- ]the[- ]shelf\b|\bnobody else\b|\bno one else\b|\bexisting tools?\b|\bthe funded tools?\b|\bcompetitors?\b|\bon the market\b|\banother tool already\b/i;

/**
 * A property claim about the referent, rather than a mention of it.
 *
 * Capability modals and availability predicates only. Bare `is`/`are` are
 * deliberately absent: "the loop's git push **is** rejected" is a sentence
 * about the loop, and admitting the copula admits every such sentence.
 */
export const PROPERTY_SIGNAL =
  /\b(can|cannot|can't|could|may|might|will not|won't|must|supports?|exposes?|allows?|accepts?|refuses?|rejects?|ships?|provides?|requires?|documents?|guarantees?|suppress(es)?|skips?|enumerable|available|present|absent|implemented|scoped|reliably tells?|tracks?)\b/i;

/** Availability predicates that carry their own subject, e.g. "not present on a stock macOS". */
export const AVAILABILITY_SIGNAL = /\b(not present on|is not available|does not ship|ships only|exists on|stock (macOS|setup|install))\b/i;

/** How many content words from the belief a query needs before it is "specific". */
export const MIN_SALIENT_TERMS = 3;

/**
 * This tree's own vocabulary. These words appear in nearly every belief here,
 * so they cannot make one query different from another and are stripped before
 * specificity is judged.
 */
const HOUSE_VOCABULARY = new Set(
  ("assumption belief tree node nodes vault loop pass passes agent operator solution opportunity outcome test tests " +
    "instrument evidence rung record records ledger claim claims candidate spec builder discovery ost run runs " +
    "reader human founder product repository repo session sessions tool tools call calls write writes read reads " +
    "false true stated risk category feasibility desirability viability kind whether would could should").split(
    " ",
  ),
);

const STOPWORDS = new Set(
  ("a an the and or but if then that this these those it its of to in on at by for with from as is are was were be " +
    "been being not no nor so than what which who whom when where why how all any both each few more most other " +
    "some such only own same too very can will just do does did doing have has had having own about into over " +
    "under again further once here there because while against between out up down off").split(" "),
);

/** What one demanded lookup is: who asked, where to look, what to ask, what it costs. */
export interface DemandedLookup {
  /** The assumption that demanded it. A finding lands here and nowhere else. */
  assumption: string;
  referent: string;
  publicClass: PublicClass;
  /** Documentation home, or "open web" when there is no known page. */
  where: string;
  /** The query, as it would be spent. */
  query: string;
  /**
   * 1 — one read of a known documentation page.
   * 2 — a search naming an entity that publishes, but with no known page.
   * 3 — an open-ended survey of what exists.
   */
  cost: 1 | 2 | 3;
}

export interface Movability {
  title: string;
  verdict: "public-movable" | "private-only";
  /** Present exactly when the verdict is public-movable. */
  lookup?: DemandedLookup;
  /** Why the call went the way it did, in the vocabulary of the criteria. */
  why: string;
}

function sentences(text: string): string[] {
  return text
    .replace(/\*\*/g, "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Content words of the belief, house vocabulary and stopwords removed.
 *
 * Order is preserved and duplicates dropped, so a query reads like the belief
 * rather than like a bag — the title is where the tree states the proposition,
 * so the title is what a query is built from.
 */
export function salientTerms(title: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of title.toLowerCase().match(/[a-z][a-z0-9_.'-]*/g) ?? []) {
    const w = raw.replace(/^'+|'+$/g, "");
    if (w.length < 3 || STOPWORDS.has(w) || HOUSE_VOCABULARY.has(w) || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

/**
 * Does this sentence make a claim about `ref`, as opposed to mentioning it?
 *
 * Two accepted shapes: the referent followed within a short window by a
 * capability verb, and the referent's possessive naming one of its own parts
 * ("Monitor's read scope"). A third shape needs no referent adjacency at all —
 * an availability predicate ("not present on a stock macOS") is a claim about
 * whatever ships the thing.
 */
function statesPropertyOf(sentence: string, ref: Referent): boolean {
  const m = ref.match.exec(sentence);
  if (!m) return false;
  if (AVAILABILITY_SIGNAL.test(sentence)) return true;
  const after = sentence.slice(m.index + m[0].length);
  if (/^'s\b|^s'\b/.test(after)) return true;
  const window = after.split(/\s+/).slice(0, 8).join(" ");
  return PROPERTY_SIGNAL.test(window);
}

/**
 * Build the query for a belief, or return undefined when it is not specific.
 *
 * The specificity bar is mechanical: the referent's own name plus at least
 * {@link MIN_SALIENT_TERMS} content words the belief contributes. A belief
 * whose whole vocabulary is this tree's vocabulary produces no query, and is
 * therefore not counted — that is the vault's word "specific" spent rather than
 * asserted.
 */
export function composeLookup(assumption: OpenAssumption, ref: Referent): DemandedLookup | undefined {
  // A term the referent's own name already carries adds nothing to the query and
  // reads as a stutter ("git git merge driver ..."), so it is dropped by word
  // rather than by pattern — `Editor tooling` matches neither "editor" nor
  // "tooling" on its own, and both would otherwise survive.
  const named = new Set(ref.query.toLowerCase().split(/\s+/));
  const terms = salientTerms(assumption.title).filter((t) => !named.has(t) && !ref.match.test(t));
  if (terms.length < MIN_SALIENT_TERMS) return undefined;
  const cost: 1 | 2 | 3 = ref.kind === "prior-art" ? 3 : ref.where ? 1 : 2;
  return {
    assumption: assumption.title,
    referent: ref.id,
    publicClass: ref.kind,
    where: ref.where || "open web",
    query: `${ref.query} ${terms.slice(0, 8).join(" ")}`,
    cost,
  };
}

/** The prior-art referent is synthetic: the claim names no vendor by construction. */
const PRIOR_ART_REFERENT: Referent = {
  id: "prior-art",
  match: /\bprior art\b/i,
  query: "existing tool that",
  where: "",
  kind: "prior-art",
};

/**
 * Where a referent has to appear before the belief counts as being *about* it.
 *
 * The proposition of an OST assumption is its title, and the test titles below
 * it say what would be measured and where — "Ask someone with the harness's
 * sandbox implementation open ..." names the source of its own answer. Prose
 * is different: it is where a belief explains itself, and this tree's prose
 * mentions `git`, `vitest` and the harness constantly as scenery.
 *
 * Requiring the proposition to name the thing is what separates "A git merge
 * driver can rebuild dist deterministically" (a claim about git) from "the
 * loop's git push is rejected" (a claim about the loop that happens to contain
 * the word git). The exception is an availability predicate, which carries its
 * own subject wherever it is written: `timeout(1)` "is not present on a stock
 * macOS" is a claim about macOS even when it appears four sentences in.
 */
function namedInProposition(assumption: OpenAssumption, ref: Referent): boolean {
  if (ref.match.test(assumption.title)) return true;
  return assumption.tests.some((t) => ref.match.test(t.title));
}

/**
 * Label one open assumption.
 *
 * The belief text is the title plus its prose plus its test titles; the
 * property claim may be anywhere in it, but the referent must reach the
 * proposition ({@link namedInProposition}) or carry its own subject.
 */
export function classify(assumption: OpenAssumption): Movability {
  const text = [assumption.title, assumption.prose, ...assumption.tests.map((t) => t.title)].join("\n");
  const lines = sentences(text);

  const hits: DemandedLookup[] = [];
  for (const ref of REFERENTS) {
    const stating = lines.filter((s) => statesPropertyOf(s, ref));
    if (stating.length === 0) continue;
    const carriesOwnSubject = stating.some((s) => AVAILABILITY_SIGNAL.test(s));
    if (!carriesOwnSubject && !namedInProposition(assumption, ref)) continue;
    const lookup = composeLookup(assumption, ref);
    if (lookup) hits.push(lookup);
  }
  // The proposition rule applies to prior art too: a belief that mentions the
  // competition in an aside while asserting something about a reader's choice
  // is a belief about the reader.
  const proposition = [assumption.title, ...assumption.tests.map((t) => t.title)].join("\n");
  if (PRIOR_ART_SIGNAL.test(proposition)) {
    const lookup = composeLookup(assumption, PRIOR_ART_REFERENT);
    if (lookup) hits.push(lookup);
  }

  if (hits.length === 0) {
    const mentioned = REFERENTS.some((r) => r.match.test(text));
    return {
      title: assumption.title,
      verdict: "private-only",
      why: mentioned
        ? "mentions something outside this product without stating a property of it in the proposition — the belief is about this tree's own code, data or operator"
        : "no external referent: nothing outside this vault has seen the subject of this belief",
    };
  }
  // One assumption demands one lookup. The referent the proposition names wins
  // over one the prose only implies, and after that the cheaper page wins: a
  // belief that reaches two vendors is answered at the one it is written about.
  const inTitle = (l: DemandedLookup) =>
    REFERENTS.some((r) => r.id === l.referent && r.match.test(assumption.title)) ? 0 : 1;
  hits.sort((a, b) => inTitle(a) - inTitle(b) || a.cost - b.cost || (a.referent < b.referent ? -1 : 1));
  return {
    title: assumption.title,
    verdict: "public-movable",
    lookup: hits[0],
    why: `${hits[0].publicClass}: the belief states a property of ${hits[0].referent}, which publishes`,
  };
}

export interface Survey {
  total: number;
  movable: Movability[];
  private: Movability[];
  /** The demand queue: every composed lookup, cheapest question first. */
  queue: DemandedLookup[];
}

/**
 * Survey a set of open assumptions and produce the demand queue.
 *
 * The queue is the artefact the solution actually needs. Nothing here searches
 * anything: this is the list a lookup budget is allowed to be spent against,
 * and the order it is spent in.
 */
export function surveyPublicMovability(assumptions: readonly OpenAssumption[]): Survey {
  const labelled = assumptions.map(classify);
  const movable = labelled.filter((m) => m.verdict === "public-movable");
  return {
    total: assumptions.length,
    movable,
    private: labelled.filter((m) => m.verdict === "private-only"),
    queue: movable
      .map((m) => m.lookup!)
      .sort((a, b) => a.cost - b.cost || (a.assumption < b.assumption ? -1 : 1)),
  };
}

/**
 * Render the demand queue for a reader.
 *
 * The denominator leads, because the count only means anything beside it: "17
 * of 483" is the answer to the vault's question and "17 questions" is not. The
 * two limits travel with the number rather than being left in a spec nobody
 * reading this output has open — a role-named referent is invisible to this,
 * and a composed question is a claim about where to look, never about what is
 * there.
 */
export function renderDemandQueue(survey: Survey): string {
  const lines: string[] = [];
  const pct = survey.total === 0 ? 0 : Math.round((survey.movable.length / survey.total) * 1000) / 10;
  lines.push(
    `${survey.movable.length} of ${survey.total} open assumption(s) could be moved by something public — ${pct}%.`,
  );
  if (survey.queue.length === 0) {
    lines.push("");
    lines.push("Nothing to look up. Every open belief here turns on this tree's own code, data or operator.");
    return lines.join("\n");
  }
  lines.push("");
  lines.push("Cheapest question first. A finding attaches to the assumption that asked for it.");
  let cost = 0;
  for (const lookup of survey.queue) {
    if (lookup.cost !== cost) {
      cost = lookup.cost;
      lines.push("");
      lines.push(cost === 1 ? "  one read of a known page:" : cost === 2 ? "  a search:" : "  an open survey:");
    }
    lines.push(`    ${lookup.where}  ${lookup.query}`);
    lines.push(`      demanded by: ${lookup.assumption}`);
  }
  lines.push("");
  lines.push(
    "This is a floor. A belief that names its external subject by role rather than by name " +
      "(\"the prompting tool\", \"independent judges\") is not counted, and a composed question " +
      "says where to look — never that an answer is there.",
  );
  return lines.join("\n");
}
