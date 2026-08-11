/**
 * Evidence-extent analysis over sibling opportunities — the decorrelation half
 * of duplicate detection.
 *
 * `dedupe.ts` sees WORDING: same-layer titles whose token sets nearly match.
 * It is blind in exactly the direction that matters for the opportunity space —
 * two opportunities can state one concept in disjoint vocabulary (measured:
 * two names for the identical work item scored 0.29, `docs/reference/
 * v1-readiness.md`), and the meta vault's own log diagnosed 124 evidence
 * records "restating one of four needs the tree already names". What wording
 * cannot see, provenance can: every node cites the evidence record it was
 * distilled from, so an opportunity's subtree accumulates an evidence *extent*
 * — the set of records the branch rests on — and extents obey set arithmetic.
 *
 * The theory is Formal Concept Analysis (Ganter & Wille) applied to the links
 * the vault already stores, and it lands exactly on Torres's own sibling
 * semantics: a child is "a subset of a parent"; siblings must be "distinct —
 * you can address one without addressing another".
 *
 *   - **Same extent** ⇒ two names for one concept. Merge, or show a solution
 *     that could address one alone.
 *   - **Strict-subset extent** ⇒ a child mis-hung as a sibling. Re-hang it.
 *   - **Substantially overlapping, crossing extents** ⇒ entangled concepts.
 *     Rewrite each from its own evidence so each statement carries what
 *     separates it (the constant-comparative move from qualitative coding).
 *
 * Comparison is SIBLINGS-ONLY, deliberately: prioritization only ever compares
 * siblings, so that is the set whose distinctness carries weight — and it is
 * also what keeps the pair count far below quadratic on a wide tree.
 *
 * Like the near-duplicate scan this feeds the same hygiene channel: issues are
 * REPORTED, never auto-resolved; `ost_merge_nodes` and `ost_edit_node` are the
 * resolution tools and a session applies judgement between the two. An
 * annotation clears an issue a session judged false, exactly as with every
 * other hygiene rule.
 */
import { claimsStoredEvidence } from "../processes/tree.js";

/** The minimal node shape this module reads — matches `OstNode` structurally. */
export interface ExtentNode {
  title: string;
  layer: string;
  links: readonly string[];
  source?: string;
}

/** One flagged pair, in the shape `detectHygiene`'s `take` consumes. */
export interface ExtentIssue {
  title: string;
  issue: string;
  rule: (typeof EXTENT_RULES)[number];
}

/** The three verdicts, in the order they are checked (each excludes the previous). */
export const EXTENT_RULES = ["shared-extent", "subset-extent", "entangled-extent"] as const;

/**
 * Jaccard overlap at or above which two crossing extents count as entangled.
 *
 * Below it, sharing is treated as the normal texture of a real opportunity
 * space — Torres's own taxonomy rule is that overlap "should be small, not
 * zero". At 0.5, half of everything either branch rests on is common ground,
 * which is past "small" on any reading. Tune with real trees, like dedupe's 0.7.
 */
export const ENTANGLED_THRESHOLD = 0.5;

/**
 * Every Opportunity's evidence extent: the stored-evidence ids cited (via
 * `source`) by the opportunity itself or ANY node beneath it, all layers.
 *
 * One memoised post-order walk over the whole forest rather than a subtree
 * walk per opportunity — the same argument, and the same cycle discipline, as
 * `opportunitiesServedBeneath`: a back edge contributes nothing rather than
 * recursing forever, so a cycle can only UNDER-fill an extent, and an
 * under-filled extent can only under-report overlap. The failure mode is a
 * missed flag, never a false one.
 */
export function evidenceExtents(nodes: readonly ExtentNode[]): Map<string, ReadonlySet<string>> {
  const index = new Map(nodes.map((n) => [n.title, n]));
  const settled = new Map<string, ReadonlySet<string>>();
  const visiting = new Set<string>();

  const walk = (node: ExtentNode): ReadonlySet<string> => {
    const done = settled.get(node.title);
    if (done) return done;
    if (visiting.has(node.title)) return new Set();
    visiting.add(node.title);
    const extent = new Set<string>();
    if (claimsStoredEvidence(node.source)) extent.add(node.source);
    for (const link of node.links) {
      const child = index.get(link);
      if (!child) continue; // dangling link — `check` owns reporting that
      for (const id of walk(child)) extent.add(id);
    }
    visiting.delete(node.title);
    settled.set(node.title, extent);
    return extent;
  };

  const out = new Map<string, ReadonlySet<string>>();
  for (const n of nodes) if (n.layer === "Opportunity") out.set(n.title, walk(n));
  return out;
}

/**
 * Flag sibling Opportunity pairs whose evidence extents collapse, nest, or
 * entangle. A generator for the same reason `scanNearDuplicates` is: the
 * caller (`detectHygiene`) bounds what it materializes.
 *
 * Direction is stable and matches the duplicate scan's: within a sibling set,
 * titles are sorted and the LATER one carries the issue — except `subset-extent`,
 * where the issue belongs on the subset node whichever sorts first, because
 * "you are probably a child" is a fact about that node alone. Deterministic
 * strings, so re-runs suppress against the same annotation.
 */
export function* scanExtentOverlap(nodes: readonly ExtentNode[]): Generator<ExtentIssue> {
  const index = new Map(nodes.map((n) => [n.title, n]));
  const extents = evidenceExtents(nodes);
  // A pair can be siblings twice only on a tree that violates single-parent;
  // reads are tolerant, so tolerate it here too rather than double-flagging.
  const emitted = new Set<string>();

  for (const parent of nodes) {
    if (parent.layer !== "Outcome" && parent.layer !== "Opportunity") continue;
    const siblings = parent.links
      .filter((t) => index.get(t)?.layer === "Opportunity")
      .sort();
    if (siblings.length < 2) continue;

    /*
     * Never all-pairs, for dedupe's Z3 reason and with dedupe's own worst case:
     * a flat tree of 2,000 siblings all mapped from one record is ~2M pairs,
     * every one of them a duplicate — the pairwise answer is quadratic, so the
     * scan must not walk it pair by pair (`test/mcp/wall-clock-budget.test.ts`
     * is the instrument that caught exactly this shape).
     *
     *   1. CLUSTER identical extents first. A k-member cluster is one concept
     *      wearing k titles: k-1 issues, each member flagged against the
     *      cluster's first title — the same signal as the k(k-1)/2 pairs, the
     *      same stable later-against-earlier direction the wording scan uses,
     *      linear in the cluster.
     *   2. Across DISTINCT extents, find candidate pairs through posting lists
     *      over shared record ids. Every verdict below needs at least one
     *      shared id, so pairs sharing nothing are never touched — exact, not
     *      approximate, like dedupe's prefix filter.
     */
    const byExtent = new Map<string, string[]>();
    for (const title of siblings) {
      const e = extents.get(title);
      if (!e || e.size === 0) continue; // nothing cited — wording scans own that case
      const key = [...e].sort().join(" ");
      const cluster = byExtent.get(key);
      if (cluster) cluster.push(title);
      else byExtent.set(key, [title]);
    }

    const reps: string[] = []; // the first title of each distinct extent
    for (const cluster of byExtent.values()) {
      reps.push(cluster[0]);
      const anchor = cluster[0];
      const size = extents.get(anchor)!.size;
      for (let m = 1; m < cluster.length; m++) {
        const pairKey = `${anchor} ${cluster[m]}`;
        if (emitted.has(pairKey)) continue;
        emitted.add(pairKey);
        yield {
          title: cluster[m],
          issue:
            `shared evidence extent: rests on exactly the evidence sibling "${anchor}" rests on (${size} record(s)) — ` +
            `two names for one concept unless a solution could address one and not the other; ` +
            `merge with ost_merge_nodes, or rewrite each from its own evidence and say what separates them`,
          rule: "shared-extent",
        };
      }
    }

    // Posting lists over the representatives only: record id → rep positions.
    reps.sort();
    const posting = new Map<string, number[]>();
    for (let p = 0; p < reps.length; p++) {
      for (const id of extents.get(reps[p])!) {
        const list = posting.get(id);
        if (list) list.push(p);
        else posting.set(id, [p]);
      }
    }
    const candidates = new Map<number, Set<number>>();
    for (const list of posting.values()) {
      for (let x = 0; x < list.length; x++) {
        for (let y = x + 1; y < list.length; y++) {
          let set = candidates.get(list[x]);
          if (!set) candidates.set(list[x], (set = new Set()));
          set.add(list[y]);
        }
      }
    }

    // Emission order: `i` ascending then `j` ascending over the sorted reps —
    // the order the all-pairs loop would have produced for the surviving pairs.
    for (const [i, partners] of [...candidates.entries()].sort((p, q) => p[0] - q[0])) {
      const a = reps[i];
      const ea = extents.get(a)!;
      for (const j of [...partners].sort((x, y) => x - y)) {
        const b = reps[j];
        const eb = extents.get(b)!;
        const pairKey = `${a} ${b}`;
        if (emitted.has(pairKey)) continue;
        let inter = 0;
        const [small, large] = ea.size <= eb.size ? [ea, eb] : [eb, ea];
        for (const id of small) if (large.has(id)) inter++;

        // The extents are distinct by construction, so "identical" cannot
        // happen here; a full-containment intersection is a strict subset.
        if (inter === ea.size || inter === eb.size) {
          const [sub, sup] = inter === ea.size ? [a, b] : [b, a];
          const supSize = inter === ea.size ? eb.size : ea.size;
          emitted.add(pairKey);
          yield {
            title: sub,
            issue:
              `subset evidence extent: every record this rests on (${inter}) is part of what sibling "${sup}" ` +
              `rests on (${supSize}) — a subset extent is a child, not a sibling; consider re-hanging it beneath ` +
              `"${sup}", or cite the evidence that makes it a genuinely separate need`,
            rule: "subset-extent",
          };
          continue;
        }
        const union = ea.size + eb.size - inter;
        const overlap = inter / union;
        if (overlap >= ENTANGLED_THRESHOLD) {
          emitted.add(pairKey);
          yield {
            title: b,
            issue:
              `entangled evidence extent: shares ${inter} of ${union} record(s) with sibling "${a}" ` +
              `(overlap ${overlap.toFixed(2)}) — entangled concepts blur every comparison built on them; ` +
              `rewrite each from its own evidence so each statement carries what separates it, ` +
              `and merge instead if no solution could address one alone`,
            rule: "entangled-extent",
          };
        }
      }
    }
  }
}
