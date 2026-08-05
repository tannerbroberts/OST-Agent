/**
 * Separate the bucket role from the opportunity role in the meta vault.
 *
 * 25 opportunities held both child Opportunities and direct Solutions. That is
 * legal Torres — an opportunity may have both — but it makes the two roles
 * indistinguishable: nothing in the tree says whether a node is a category
 * being filed under or a need being solved.
 *
 * The obvious fix is wrong, and it is worth saying why. Pushing the solutions
 * down into an existing child would attach them to needs they do not address:
 * in every one of the 25 the direct solutions answer the PARENT's need, while
 * the children are narrower failure modes discovered later. "A declared
 * resource manifest" answers "the agent has to guess what resources it has",
 * not "I run git in a folder that was never initialised".
 *
 * So the parent's own need is given a node of its own, and its solutions move
 * there. The parent becomes a pure bucket; the new child is a pure opportunity.
 * Nothing is invented — the need was already being solved, it just had no node.
 *
 * Dry-run by default; pass --apply to write.
 */
import { Vault } from "../src/ost/vault.js";
import type { OstNode } from "../src/ost/node.js";

/** parent title → the need its direct solutions actually answer. */
const SPLITS: { parent: string; title: string; body: string }[] = [
  {
    parent: "A test that failed because the machine was busy looks exactly like one that failed because I broke something",
    title: "One red run is all I get, and nothing in it separates noise from a real break",
    body: "A single failing run is the whole verdict, and it carries no signal about which kind of failure it was. Telling a busy machine from a broken change means running it again myself and comparing by eye — so the cheapest reading, and the one taken under time pressure, is to trust the first result or to ignore it entirely.",
  },
  {
    parent: "A tool call I got slightly wrong destroyed the note I was filing",
    title: "A malformed call lands before anything checks it, and only reading back the file says so",
    body: "Nothing between composing a call and its effect on disk inspects what is about to be written. A wrong argument name, an empty body, a literal `undefined` — each is accepted, written, and discovered later by reading the file. The check that would have caught it is a check the tool already has the schema for.",
  },
  {
    parent: "Building crowds out the search for better evidence",
    title: "Discovery and building draw on the same budget, and building always wins",
    body: "There is one pool of attention and two claims on it. Building has a visible artifact at the end and discovery has a better question, so every time they compete the artifact wins — not by anyone deciding it should, but because nothing separates the two budgets or gates one on the other.",
  },
  {
    parent: "Checking on progress means digging through files",
    title: "Nothing brings the tree's state to me, so staying current means going and reading it",
    body: "The tree only reports when someone opens it. Knowing what changed means going to the vault, finding the nodes that moved, and reconstructing the difference from the files — which is work, so it is skipped, so the state I act on is the one I last read rather than the one that exists.",
  },
  {
    parent: "Don't want to buy a second AI credential just to try it",
    title: "Trying this at all costs a purchase, before I know whether it is worth anything",
    body: "The first useful minute is behind a credential I do not have yet. The decision to buy has to be made on the strength of a description rather than on anything the tool has done for me, which is the wrong order and the reason the trial never starts.",
  },
  {
    parent: "I can't leave the process running unattended without worrying",
    title: "A run that dies while I am away stays dead, and nothing says where it stopped",
    body: "An unattended run has no supervisor and no resumable record. If it fails at hour two, hours three through eight are silence, and what it had finished by then has to be reconstructed afterwards from whatever it happened to write.",
  },
  {
    parent: "I can't say why anyone wouldn't just do this by hand with Claude and Obsidian",
    title: "I have no side-by-side evidence that the tool beats doing it by hand",
    body: "The claim that this is better than a person with a chat window and a folder of notes has never been run as a comparison. Without one, the argument is a list of features rather than a difference anyone has observed, and the honest answer to the question is that I do not know.",
  },
  {
    parent: "I can't tell if anyone outside my own head wants this",
    title: "Nobody outside the building has been asked, so every claim about demand is mine",
    body: "Every statement about what an operator wants traces back to me. There is no interview, no trial, and no one who has been asked to pay — so the tree's demand-side claims all rest on the same single source, and that source is the person who wants the answer to be yes.",
  },
  {
    parent: "I can't tell what a half-finished run actually finished",
    title: "An interrupted run leaves no trustworthy account of what it completed",
    body: "The run's own report is written at the end, so a run that does not reach the end reports nothing. What it did finish has to be inferred from side effects, and the inference is unreliable precisely when it matters most — after a failure.",
  },
  {
    parent: "I have a tree full of unvalidated nodes and no idea which one to pick up",
    title: "Nothing names the one node to pick up next, so choosing is work before the work",
    body: "The tree presents everything at once and ranks none of it. Picking the next thing means re-reading the candidates and re-deriving their order every session — a cost paid before any work starts, and paid again next time because the conclusion was never written down.",
  },
  {
    parent: "I need the tree's output to be actionable by compute alone, because my hours don't exist",
    title: "Every piece of work is priced in my minutes, and I have none to spend",
    body: "The tree's output assumes a person will act on it. Nothing distinguishes the work that genuinely needs a human from the work that only ever needed a command, so the whole queue waits behind the same scarce resource and the zero-minute items wait exactly as long as the hour-long ones.",
  },
  {
    parent: "I want my usage to automatically feed into and make the OST-Agent better",
    title: "What I actually do with the tool is never recorded, so improving it runs on memory",
    body: "The sessions where the tool is used leave nothing behind that the tool can read. Improvement is therefore driven by whatever I happen to remember and bother to write up, which selects for recent annoyances over frequent ones and loses everything that was merely mildly wrong.",
  },
  {
    parent: "Improving how the agent works means interrupting it",
    title: "A change I ship can only reach the agent by stopping it first",
    body: "The running process holds its policy from when it started. Shipping an improvement means killing the run, and killing the run costs whatever it was in the middle of — so improvements queue up behind a restart nobody wants to spend, and the agent keeps running the version I already know is worse.",
  },
  {
    parent: "The agent has to guess what resources it's actually working with",
    title: "Nothing declares what I have to work with, so every plan is built on a guess",
    body: "There is no manifest of what exists — which tools, which credentials, which hours, which parts of the workspace. Every plan therefore encodes an assumption about availability that was never stated, and the assumption is discovered to be wrong only by acting on it.",
  },
  {
    parent: "The goal I care about is too far from anything I can act on this week",
    title: "Nothing connects this week's work to the goal, so I can't tell if I am moving toward it",
    body: "The distance between the mandate at the root and anything actionable is too large to cross in one step, and nothing fills the gap. Work gets chosen because it is available rather than because it advances the goal, and whether it did advance the goal is unanswerable either way.",
  },
  {
    parent: "The pass never says it is done, so I can't tell when to stop paying for compute",
    title: "Evidence that fits no layer keeps coming back, so the pass never runs out of work",
    body: "Some of what arrives is true, useful, and not a customer need — and the tree has nowhere to put it. It is therefore never filed, so it is unmapped on the next pass and the one after, and a loop that is honestly finished cannot say so because the same items are still outstanding.",
  },
  {
    parent: "The same agent has a different tool surface on every surface I run it on",
    title: "A run never states which tools it had, so a degraded pass reads like a full one afterwards",
    body: "The tool surface varies by host and nothing records which one a given run got. A pass that quietly lacked half its tools produces a report indistinguishable from a complete one, so the failure is invisible at exactly the moment it should be loudest.",
  },
  {
    parent: "The same refusal is rediscovered every session, because nothing carries the lesson forward",
    title: "A correction lives only as long as the session it was given in",
    body: "Being told the right way to do something fixes it once. The next session starts from the same place, makes the same call, and is refused the same way — so the same correction is spent repeatedly and never accumulates into anything.",
  },
  {
    parent: "The whole loop waits on one human command, and nobody is told it is waiting",
    title: "A block stops everything and announces itself to no one",
    body: "One item needing a person halts the entire run, and the halt is silent. The operator finds out by going to look — which they do on their own schedule, not the run's — so the gap between blocked and noticed is unbounded and everything independent of the block waits through it too.",
  },
  {
    parent: "The work I most want to run unattended is the work that keeps needing a decision",
    title: "A run has no authority to decide anything, so every fork is a full stop",
    body: "Nothing states which classes of decision compute may take on its own. In the absence of that statement the safe reading is none, so every fork — including the ones whose answer is obvious and cheap to reverse — becomes a stop that waits for a person.",
  },
  {
    parent: "Trust an unmonitored agent enough to walk away",
    title: "I cannot see what the agent did while I was away, so walking away is a leap",
    body: "What the agent did between my leaving and returning is not reconstructible. Trust therefore has to be extended up front and in full rather than earned incrementally from a record — which is a much larger thing to ask, and the reason the answer keeps being no.",
  },
  {
    parent: "Two agents sharing my vault can trample each other",
    title: "Two runs write the same vault at once and nothing arbitrates between them",
    body: "There is no lock, no branch, and no drift check. Two agents reading the same state and writing back their own version of it is an ordinary occurrence rather than an edge case, and the loser's work disappears without either run noticing.",
  },
  {
    parent: "What the agent learns doesn't accumulate over time",
    title: "The tree never revisits itself, so old nodes rot and tried things get tried again",
    body: "Nodes are written once and never revisited. Nothing marks a node as stale, and nothing records that an approach was already attempted and abandoned — so the tree's older regions drift out of date silently and the same ideas are re-ideated as if new.",
  },
  {
    parent: "What the agent struggles with every session disappears",
    title: "The friction I hit leaves no record behind, so nothing can be learned from it",
    body: "The moments where the tool fights back — a retry, a wrong guess, a workaround — happen inside a session and end with it. None of it is captured anywhere, so the evidence most directly about how the tool should change is the evidence that is systematically thrown away.",
  },
  {
    parent: "When the rules tighten, my existing tree is stranded out of compliance",
    title: "A rule change lands on finished work, and nothing carries that work across",
    body: "A tightened rule applies to everything at once, including nodes written and completed under the old one. Work that was done silently reopens, and the burden of bringing it into compliance falls on whoever next runs a check — with no migration and no record of which rules a node was built under.",
  },
];

const SOURCE = "tree-restructure:2026-08-05 — split from the bucket that held these solutions directly";

function main(): void {
  const dir = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!dir) throw new Error("usage: migrate-meta-vault-buckets.ts <vault> [--apply]");

  const vault = new Vault(dir, { create: false });
  const tree = vault.readTree();
  const index = new Map<string, OstNode>(tree.map((n) => [n.title, n]));

  let moved = 0;
  for (const split of SPLITS) {
    const parent = index.get(split.parent);
    if (!parent) throw new Error(`no such parent: ${split.parent}`);
    if (index.has(split.title)) throw new Error(`already exists: ${split.title}`);
    const solutions = parent.links.filter((l) => index.get(l)?.layer === "Solution");
    if (!solutions.length) throw new Error(`"${split.parent}" holds no direct solutions — nothing to move`);

    console.log(`\n${split.parent}\n  → NEW  ${split.title}`);
    for (const s of solutions) console.log(`      moves: ${s}`);
    moved += solutions.length;

    if (!apply) continue;
    vault.createNode({
      title: split.title,
      layer: "Opportunity",
      status: "unvalidated",
      tags: ["unvalidated"],
      links: [],
      // NOT the parent's rung. Two of the 25 parents declare 'observed', and
      // inheriting it put `rung-unearned` on the new nodes — correctly: this
      // node's provenance is a restructure, not a recording of anything. The
      // rung a node may claim follows its own source, and this one's is the
      // floor. The solutions beneath it keep the rungs they already had.
      evidence: "assertion",
      source: SOURCE,
      body: split.body,
    } as OstNode);
    vault.linkNodes(split.parent, split.title);
    for (const s of solutions) {
      vault.linkNodes(split.title, s);
      vault.detach(
        split.parent,
        s,
        `re-parented under [[${split.title}]] — this solution answers that need, not the categories beside it`,
      );
    }
  }

  console.log(`\n${SPLITS.length} bucket(s) split, ${moved} solution(s) re-parented`);
  if (!apply) console.log("dry run — pass --apply to write");
}

main();
