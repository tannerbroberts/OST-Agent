/**
 * The standing authority contract — which classes of decision compute may take alone.
 *
 * Nothing in this repository states which decisions a run may settle on its own, so
 * the safe reading has been *none*: every fork, including the ones whose answer is
 * obvious and cheap to reverse, becomes a stop that waits for a person. This contract
 * is the delegation written down once, by class rather than per question. A run that
 * reaches a fork consults it — reads {@link renderAuthorityContract} — and either
 * proceeds under the clause that covers the fork (recording which one), or stops and
 * cites the clause that stopped it. A fork no clause covers is a stop, exactly as
 * before the contract existed: uncovered is the contract's honest edge, not a gap it
 * papers over.
 *
 * ## Where the classes came from, and why that is load-bearing
 *
 * The classes were drafted from the OLDEST EIGHT of the seventeen recorded
 * AskUserQuestion stops in `test/fixtures/question-stops/stops.json` — every stop
 * with `askedAt` up to {@link AUTHORITY_DRAFTING_CUTOFF} — and from nothing after
 * that instant. Each class cites the drafting stops it was read from in
 * `draftedFrom`, which is the audit trail `test/loop/authority-class-holdout.test.ts`
 * checks mechanically: a class citing a stop newer than the cutoff is a taxonomy
 * fitted to its own answer key, and the test fails it by construction. The nine
 * newer stops are the holdout the contract is judged against, on the bars the vault
 * assumption test pre-committed before any of this was built. Read the holdout
 * section of `test/fixtures/question-stops/PROVENANCE.md` before believing the
 * result — including the stated limits of sealing a drafting step that a single
 * agent performed.
 *
 * ## What a green holdout does and does not settle
 *
 * It settles generalization: that classes written before a question was asked can
 * absorb it. It does NOT settle authority. Nobody has granted this delegation — the
 * operator has not signed it, and whether they would is a consent question no
 * reading of past transcripts can answer. Until that consent exists, the contract
 * is a drafted delegation: a run may cite a proceed clause as its *reasoned
 * default*, but the grant itself is still the operator's to make.
 *
 * ## Precedence
 *
 * Clauses are consulted in array order, and every stop-and-cite clause outranks
 * every proceed clause, so where two readings compete the safe one wins. The
 * governance clause is first, is fixed before drafting began, and can never carry a
 * proceed ruling — a contract that let compute rule on the tree's own gate would
 * have delegated the gate that makes every other delegation safe.
 */

/** What compute may do under a clause: carry on and record, or stop and name it. */
export type AuthorityRuling = "proceed" | "stop-and-cite";

/** One class of decision, with the ruling delegated (or withheld) for it. */
export interface DecisionClass {
  /** Stable clause id a run cites, e.g. `authority:mechanics`. */
  id: string;
  name: string;
  ruling: AuthorityRuling;
  /**
   * The criteria that place a fork in this class, stated in full so a placement
   * can be argued with by name rather than shrugged at.
   */
  clause: string;
  /**
   * For proceed classes: the option compute takes under the clause. A proceed
   * ruling without a stated default is not a delegation, it is a shrug — the run
   * would still be choosing, just without anything standing behind the choice.
   */
  defaultUnderClause?: string;
  /**
   * `session@entry` citations into the drafting half of the corpus. Empty only
   * for the one class fixed before drafting began.
   */
  draftedFrom: string[];
  /**
   * True for the governance class alone: fixed a priori by the assumption test,
   * never eligible to become a proceed class, whatever any redraft says.
   */
  fixedBeforeDrafting?: boolean;
}

/**
 * The instant the drafting window closes: `askedAt` of the newest stop the
 * drafting was allowed to see (e42cd03d@144, the discovery-architecture fork of
 * 2026-07-28). Every class criterion derives from stops at or before this
 * timestamp; every stop after it is holdout.
 */
export const AUTHORITY_DRAFTING_CUTOFF = "2026-07-28T21:07:42.085Z";

export const AUTHORITY_CONTRACT: readonly DecisionClass[] = [
  {
    id: "authority:governance",
    name: "Governance of the tree itself",
    ruling: "stop-and-cite",
    fixedBeforeDrafting: true,
    clause:
      "Any question about the governance of the tree itself: what the gate is or does, " +
      "what happens when the gate refuses a candidate, how far compute may carry a change " +
      "without a person, or who may merge. This clause outranks every other reading of a " +
      "stop it touches, and it is not eligible to become a proceed class under any " +
      "redraft — a contract that let compute rule here would have delegated the gate " +
      "that makes every other delegation safe.",
    draftedFrom: [],
  },
  {
    id: "authority:outward-state",
    name: "State visible beyond the project's own repositories",
    ruling: "stop-and-cite",
    clause:
      "The fork disposes of state a third party can already see or depend on — a " +
      "published package, existing installs, a public PR or release record, anything on " +
      "a registry. Reversibility inside the repo does not reach state outside it, so " +
      "this is never compute's to change alone.",
    draftedFrom: ["16e9596b-7c8f-445b-a8ff-f822ed211ea5@58"],
  },
  {
    id: "authority:product-direction",
    name: "What the product is",
    ruling: "stop-and-cite",
    clause:
      "The fork decides what the product is — adding, cutting or keeping a capability, " +
      "or choosing between architectures whose consequences outlive any single change. " +
      "Reversibility is not the test here; identity is. A fork where every option builds " +
      "a different product belongs to the person whose product it is.",
    draftedFrom: [
      "16e9596b-7c8f-445b-a8ff-f822ed211ea5@40",
      "e42cd03d-b2a4-44ba-989a-9e01cc368f77@144",
    ],
  },
  {
    id: "authority:transient-defect",
    name: "Transient defect under a planned fix",
    ruling: "proceed",
    clause:
      "A defect, duplication or rule violation exists now, and a step already in the " +
      "plan removes the code that carries it; the fork is whether to fix it now or let " +
      "the planned removal resolve it. The defect is real but its lifetime is already " +
      "bounded by work everyone has agreed to.",
    defaultUnderClause:
      "Accept the transient state, log the ruling where the plan's ledger lives, and " +
      "attach to the removing step the explicit duty to verify the defect is gone.",
    draftedFrom: [
      "16e9596b-7c8f-445b-a8ff-f822ed211ea5@282",
      "16e9596b-7c8f-445b-a8ff-f822ed211ea5@323",
    ],
  },
  {
    id: "authority:plan-gap",
    name: "A gap the plan's own execution exposed",
    ruling: "proceed",
    clause:
      "Executing the plan exposed work the outcome needs that no planned step provides — " +
      "a capability severed, a mechanism the spec names but nothing builds — and the fork " +
      "is whether and how much of the closing work to take on now. The outcome is not in " +
      "question; only the timing and size of the close is.",
    defaultUnderClause:
      "Add the smallest closing increment as explicit new work, defer what that increment " +
      "does not need, and log the plan amendment. Neither ship a knowingly severed outcome " +
      "silently, nor silently expand scope past the smallest close.",
    draftedFrom: ["16e9596b-7c8f-445b-a8ff-f822ed211ea5@345"],
  },
  {
    id: "authority:run-footing",
    name: "The run's own footing",
    ruling: "proceed",
    clause:
      "The options differ only in where or under what isolation the run does the work — " +
      "a worktree, a branch, in place, or waiting out a competing writer — while the work " +
      "itself is identical under every option. Nothing stands on ground the answer does " +
      "not choose, because the answer chooses only the ground.",
    defaultUnderClause:
      "Take the most isolated option that still makes progress, and never resolve a " +
      "footing fork by taking the least reversible path.",
    draftedFrom: ["16e9596b-7c8f-445b-a8ff-f822ed211ea5@216"],
  },
  {
    id: "authority:mechanics",
    name: "Reversible implementation mechanics",
    ruling: "proceed",
    clause:
      "The goal is already decided, every option is a way of building it that stays " +
      "confined to the project's own repositories and branches, and at least one option " +
      "reaches the goal with nothing lost — no capability cut, no behavior silently " +
      "dropped. The fork is how, never whether or what.",
    defaultUnderClause:
      "Take the recommended option when one is marked and it loses nothing; otherwise the " +
      "most reversible option that loses nothing. Record the choice and why.",
    draftedFrom: ["16e9596b-7c8f-445b-a8ff-f822ed211ea5@51"],
  },
];

/**
 * The contract as the document a run reads at a fork: clauses in consultation
 * order, each with its ruling and — for proceed clauses — the default compute
 * takes under it.
 */
export function renderAuthorityContract(): string {
  const lines: string[] = [
    "STANDING AUTHORITY CONTRACT — consult top to bottom; first clause that covers the fork rules it.",
    "A fork no clause covers is a stop, and 'uncovered' is the citation.",
    "Generalization is tested (test/loop/authority-class-holdout.test.ts); the grant itself is still the operator's.",
    "",
  ];
  for (const c of AUTHORITY_CONTRACT) {
    lines.push(`[${c.id}] ${c.name} — ${c.ruling.toUpperCase()}`);
    lines.push(`  ${c.clause}`);
    if (c.defaultUnderClause) lines.push(`  Default under the clause: ${c.defaultUnderClause}`);
    lines.push("");
  }
  return lines.join("\n");
}
