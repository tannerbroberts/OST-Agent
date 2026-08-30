/**
 * Outside-in candidates — a solution transplanted from how somebody else
 * already solved this, carrying the page it was taken off.
 *
 * The two siblings under "The candidate maps all look alike" rearrange what is
 * already in the room: `knowledge/blind-ideation.ts` stops the ideators seeing
 * each other, `knowledge/forced-variation.ts` makes each one differ on a named
 * axis. Neither adds information. This one does — it seeds the set from how
 * other products, other industries, or plainly non-software processes have
 * addressed the same underlying need — and the price of new information is that
 * it arrives from a stranger.
 *
 * ## What this module settles, and what it deliberately does not
 *
 * The vault's assumption test asks whether an operator would ADOPT an imported
 * candidate or discard it as generic advice. That is a person's judgement and
 * stays with a person. What a repository can settle is the precondition: an
 * operator cannot sensibly adopt or refuse a candidate without seeing where it
 * came from, so **the operator is never asked to judge an idea whose origin the
 * tree cannot name**. Three rules, and `test/web/outside-in-candidate-provenance.test.ts`
 * is the whole of them:
 *
 *   1. the candidate records its host as `WEB:<host>`, the same provenance
 *      spelling `ost_read_web` mints and `sourceTrustKey` parses;
 *   2. it enters at the `assertion` floor whatever that host's standing;
 *   3. one created without a retrievable source is refused.
 *
 * ## Why the floor, when the ledger says the host has earned more
 *
 * This is the rule that looks like an oversight and is not. A `web` actor rises
 * to `expert` after {@link CORROBORATIONS_FOR_CEILING} distinct supporting
 * results (`knowledge/actor-trust.ts`), and `assertWithinStanding` in
 * `security/tools.ts` will then let a node citing that host declare `expert`.
 * For an ordinary citation that is right: the host said something about the
 * world, first-party tests kept agreeing, and the ladder records it.
 *
 * A candidate is not that claim. The host is a reliable witness to what IT
 * built; the candidate asserts that the same shape will work HERE, on this
 * opportunity, and the host was never asked that question and has no record on
 * it. Corroborating a publisher's facts is not evidence for a transfer, and
 * folding the two together would let three unrelated results about a vendor's
 * behaviour promote an untried idea borrowed from that vendor's blog. That is
 * the transfer risk the solution node names in its own contrast with its
 * siblings, and pinning the rung at the floor is what keeps it visible. The
 * host's standing is not discarded — {@link outsideInStanding} reports it
 * beside the rung, so a reader sees a well-regarded publisher and an untested
 * transplant as the two separate facts they are.
 *
 * ## Retrievable, not merely cited
 *
 * A candidate with a plausible URL and nothing behind it is indistinguishable
 * from one the model invented and attributed, and that is the exact failure the
 * adoption question cannot survive. So the only constructor is
 * {@link outsideInCandidate}, and it takes a {@link WebPage} — the object
 * `readWebPage` produces and nothing else does. The URL is re-vetted through
 * `assertAllowedUrl`, the page's host has to be the URL's host, and the quote
 * the candidate says it drew from has to actually appear in the retrieved text.
 *
 * The limit of that last check, stated rather than discovered: it is a
 * substring match against text already reduced from HTML, so it catches a
 * fabricated citation and says nothing about whether the quote was understood.
 * Misreading a real page is a failure this module cannot see.
 */
import { FLOOR_RUNG, type RungId } from "../knowledge/believability.js";
import { assertAllowedUrl } from "./guard.js";
import type { WebPage } from "./reader.js";

/**
 * The rung an outside-in candidate enters on. The floor, always — see the
 * header for why the host's earned standing does not lift it.
 */
export const OUTSIDE_IN_RUNG: RungId = FLOOR_RUNG;

/** How much of a page counts as a citable passage; shorter than this cites nothing. */
export const MIN_QUOTE_CHARS = 12;

/** What a model returns when asked to draw a candidate from outside, before it is vetted. */
export interface OutsideInDraft {
  /** The target opportunity's title, as the tree spells it. */
  opportunity: string;
  /** The candidate itself — what this product would do, in one line. */
  candidate: string;
  /** Whose solution it was transplanted from: the product, industry, or process. */
  drawnFrom: string;
  /** The passage on the page that says so. Must appear in the retrieved text verbatim. */
  quote: string;
}

/** A draft that survived {@link outsideInCandidate}: origin on the record, rung on the floor. */
export interface OutsideInCandidate extends OutsideInDraft {
  /** Final URL of the page it was read from, after redirects. */
  url: string;
  /** That page's host, verbatim, as `readWebPage` reported it. */
  host: string;
  /** Provenance, `WEB:<host>` — the spelling `sourceTrustKey` parses. */
  source: string;
  /** Always {@link OUTSIDE_IN_RUNG}. */
  evidence: RungId;
}

export type OutsideInViolationKind =
  | "missing-field"
  | "no-source"
  | "unretrievable-source"
  | "host-mismatch"
  | "no-quote"
  | "quote-not-on-page"
  | "wrong-provenance"
  | "unearned-rung";

export interface OutsideInViolation {
  kind: OutsideInViolationKind;
  detail: string;
}

export class OutsideInError extends Error {
  constructor(
    message: string,
    readonly violations: readonly OutsideInViolation[] = [],
  ) {
    super(message);
    this.name = "OutsideInError";
  }
}

/** The provenance an outside-in candidate carries. One spelling, used by every caller. */
export function outsideInSource(host: string): string {
  return `WEB:${host.trim().toLowerCase()}`;
}

/**
 * What the tree grants the candidate, and what the host itself has earned —
 * two facts, reported side by side and never folded into one.
 */
export interface OutsideInStanding {
  /** The rung the candidate enters on. Always {@link OUTSIDE_IN_RUNG}. */
  rung: RungId;
  /** What that host's own record has earned it, for a reader to weigh separately. */
  hostStanding: RungId;
  /** True when the host has earned more than the candidate is granted — the case worth saying out loud. */
  cappedBelowHost: boolean;
}

/**
 * The rung, given the host's standing. The parameter is taken and deliberately
 * not consulted: a caller that holds the ledger reads the same answer as one
 * that does not, and the asymmetry is reported rather than silently applied.
 */
export function outsideInStanding(hostStanding: RungId): OutsideInStanding {
  return {
    rung: OUTSIDE_IN_RUNG,
    hostStanding,
    cappedBelowHost: hostStanding !== OUTSIDE_IN_RUNG,
  };
}

/**
 * The line `ost_read_web` adds to a page it just fetched, so an agent about to
 * transplant an idea off that page reads the rule at the moment it would break
 * it. Composed here rather than at the surface, so the tool text and the
 * constructor cannot drift into disagreeing about the rung.
 */
export function outsideInRungNote(host: string, hostStanding: RungId): string {
  const s = outsideInStanding(hostStanding);
  const because = s.cappedBelowHost
    ? `${host} has earned '${s.hostStanding}' as a publisher, and that standing is about what it reports, not about whether its approach transfers here`
    : `${host} has earned nothing beyond the floor`;
  return (
    `a solution candidate drawn from this page enters at '${s.rung}' with source ${outsideInSource(host)} — ` +
    `${because}. Cite the passage you drew it from; a candidate whose page cannot be re-read is refused.`
  );
}

/**
 * Every way a draft fails to be an outside-in candidate. Empty means it is one.
 *
 * `page` is the retrieved page. `null` or `undefined` is the commonest failure
 * and the one the vault's test names: a candidate nobody actually fetched a
 * page for.
 */
export function checkOutsideInCandidate(
  draft: Partial<OutsideInDraft>,
  page: WebPage | null | undefined,
): OutsideInViolation[] {
  const out: OutsideInViolation[] = [];
  for (const field of ["opportunity", "candidate", "drawnFrom"] as const) {
    if (!(draft[field] ?? "").trim()) {
      out.push({ kind: "missing-field", detail: `an outside-in candidate needs a ${field}` });
    }
  }
  const quote = (draft.quote ?? "").trim();
  if (quote.length < MIN_QUOTE_CHARS) {
    out.push({
      kind: "no-quote",
      detail:
        `an outside-in candidate cites the passage it was drawn from, at least ${MIN_QUOTE_CHARS} characters of it; ` +
        `got ${quote.length}`,
    });
  }

  if (!page) {
    out.push({
      kind: "no-source",
      detail:
        "no page was retrieved. An outside-in candidate is refused without one: a URL with nothing behind it " +
        "reads exactly like an invented citation, and the operator is then judging an idea whose origin the tree cannot name",
    });
    return out;
  }

  let host = "";
  try {
    host = assertAllowedUrl(page.url).hostname.toLowerCase();
  } catch (err) {
    out.push({
      kind: "unretrievable-source",
      detail: `the page's url cannot be read back: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
  if (host && host !== (page.host ?? "").trim().toLowerCase()) {
    out.push({
      kind: "host-mismatch",
      detail: `the page reports host "${page.host}" and its url resolves to "${host}" — provenance would name a host nobody fetched`,
    });
  }
  if (quote.length >= MIN_QUOTE_CHARS && !normalizeForQuote(page.text).includes(normalizeForQuote(quote))) {
    out.push({
      kind: "quote-not-on-page",
      detail: `the cited passage does not appear in the text retrieved from ${page.url}`,
    });
  }
  return out;
}

/** {@link checkOutsideInCandidate}, as a refusal. */
export function assertOutsideInCandidate(draft: Partial<OutsideInDraft>, page: WebPage | null | undefined): void {
  const violations = checkOutsideInCandidate(draft, page);
  if (violations.length === 0) return;
  const lines = violations.map((v) => `  ${v.kind} — ${v.detail}`);
  throw new OutsideInError(
    `refusing an outside-in candidate for "${(draft.opportunity ?? "").trim() || "(no opportunity)"}":\n${lines.join("\n")}`,
    violations,
  );
}

/**
 * The only way to mint one. Takes the retrieved page, so a candidate that
 * exists is a candidate somebody went and fetched a page for.
 */
export function outsideInCandidate(draft: OutsideInDraft, page: WebPage | null | undefined): OutsideInCandidate {
  assertOutsideInCandidate(draft, page);
  const p = page!;
  return {
    opportunity: draft.opportunity.trim(),
    candidate: draft.candidate.trim(),
    drawnFrom: draft.drawnFrom.trim(),
    quote: draft.quote.trim(),
    url: p.url,
    host: p.host,
    source: outsideInSource(p.host),
    evidence: OUTSIDE_IN_RUNG,
  };
}

/**
 * The provenance check on a candidate that arrives as data — from a payload, a
 * cache, a surface that reconstructed it — where the page it was minted from is
 * long gone. Covers what can still be checked without the page: the spelling of
 * the source, the rung, and that the URL is one this system would fetch.
 */
export function checkOutsideInProvenance(candidate: OutsideInCandidate): OutsideInViolation[] {
  const out: OutsideInViolation[] = [];
  const host = (candidate.host ?? "").trim().toLowerCase();
  if (!host) {
    out.push({ kind: "no-source", detail: "the candidate names no host" });
  } else if (candidate.source !== outsideInSource(host)) {
    out.push({
      kind: "wrong-provenance",
      detail: `provenance is "${candidate.source}"; an outside-in candidate records "${outsideInSource(host)}"`,
    });
  }
  try {
    const parsed = assertAllowedUrl(candidate.url ?? "");
    if (host && parsed.hostname.toLowerCase() !== host) {
      out.push({
        kind: "host-mismatch",
        detail: `provenance names "${host}" and the url points at "${parsed.hostname.toLowerCase()}"`,
      });
    }
  } catch (err) {
    out.push({
      kind: "unretrievable-source",
      detail: `the candidate's url cannot be read back: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
  if (candidate.evidence !== OUTSIDE_IN_RUNG) {
    out.push({
      kind: "unearned-rung",
      detail:
        `an outside-in candidate enters at '${OUTSIDE_IN_RUNG}' whatever its host has earned; this one declares ` +
        `'${candidate.evidence}'`,
    });
  }
  return out;
}

/** {@link checkOutsideInProvenance}, as a refusal. */
export function assertOutsideInProvenance(candidate: OutsideInCandidate): void {
  const violations = checkOutsideInProvenance(candidate);
  if (violations.length === 0) return;
  const lines = violations.map((v) => `  ${v.kind} — ${v.detail}`);
  throw new OutsideInError(
    `"${candidate.candidate}" is not carrying its origin:\n${lines.join("\n")}`,
    violations,
  );
}

export interface OutsideInRequest {
  /** The target opportunity's title, as the tree spells it. */
  opportunity: string;
  /** Sibling solutions already under it, so an import is not a restatement of one. */
  existingSolutions?: readonly string[];
  /** How many outside-in candidates to ask for. */
  candidates: number;
  /** Places to look, in the order they should be tried. Defaults to {@link OUTSIDE_IN_FIELDS}. */
  fields?: readonly string[];
}

/**
 * Where "outside" is, spelled out rather than left to the model.
 *
 * "Look at how others solved it" returns the same three SaaS products every
 * time, which is the narrowness this module exists to break — so the field is
 * named per candidate the same way `forced-variation.ts` names a dimension per
 * candidate, and non-software processes are in the list on purpose.
 */
export const OUTSIDE_IN_FIELDS = [
  "another software product solving this need for a different audience",
  "a different industry with the same structural problem and no software in it",
  "a physical or manual process — a checklist, a shop floor, a kitchen, a flight deck",
  "an older generation of tooling that solved it and was replaced for unrelated reasons",
  "a regulated or safety-critical practice where getting this wrong is expensive",
] as const;

export interface OutsideInPrompt {
  opportunity: string;
  /** One field per candidate, in order; index `i` is candidate `i + 1`. */
  fields: string[];
  /** The prompt as the model reads it. */
  text: string;
}

/**
 * Build the ideation prompt for outside-in candidates.
 *
 * It asks for a URL and a quote per candidate because {@link outsideInCandidate}
 * refuses anything else — a prompt that did not ask would be manufacturing
 * refusals rather than candidates.
 */
export function buildOutsideInPrompt(req: OutsideInRequest): OutsideInPrompt {
  if (!Number.isInteger(req.candidates) || req.candidates < 1) {
    throw new OutsideInError(`an outside-in request asks for at least one candidate; got ${req.candidates}`);
  }
  const pool = req.fields?.length ? req.fields : OUTSIDE_IN_FIELDS;
  const fields = Array.from({ length: req.candidates }, (_, i) => pool[i % pool.length]);
  const existing = req.existingSolutions ?? [];

  const lines: string[] = [];
  lines.push(
    `Find ${req.candidates} candidate solution(s) for the opportunity "${req.opportunity}" by looking at how the same underlying need has already been solved somewhere else. Do not invent from this context first — read something, then bring it back.`,
  );
  if (existing.length) {
    lines.push(`Already under it: ${existing.map((s) => `"${s}"`).join(", ")}. An import that restates one of these has widened nothing.`);
  }
  fields.forEach((field, i) => lines.push(`Candidate ${i + 1} — look at ${field}.`));
  lines.push(
    `Each candidate must name: what it would have this product do, whose solution it was drawn from, the URL of the page you read, and a passage from that page (at least ${MIN_QUOTE_CHARS} characters, verbatim) that says what they did.`,
  );
  lines.push(
    `A candidate with no page behind it is refused rather than filed — and every one that is filed enters at '${OUTSIDE_IN_RUNG}' however well-regarded the host, because a publisher's standing is about what it reports and not about whether its approach transfers here. Say what would have to be true for the transfer to hold.`,
  );
  return { opportunity: req.opportunity, fields, text: lines.join("\n") };
}

/**
 * Whitespace-insensitive comparison for the quote check.
 *
 * `htmlToText` collapses runs of spaces and turns block tags into newlines, so a
 * passage copied off the rendered page differs from the reduced text by
 * whitespace alone far more often than by content — and a check that fails on
 * that is a check whoever hits it will route around.
 */
function normalizeForQuote(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}
