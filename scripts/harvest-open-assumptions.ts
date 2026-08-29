/**
 * Snapshot the meta vault's open assumptions into the corpus
 * `test/web/public-movable-assumptions.test.ts` measures.
 *
 * The assumption test this serves ("Count how many open assumptions in this
 * tree could be moved by anything public at all") says: *walk every open
 * assumption in the vault*. The suite cannot do that. The vault is a sibling
 * checkout on the maintainer's machine — `ost.vault.yaml` points at
 * `../../ost-agent-meta` — and CONTRIBUTING requires the suite to be
 * deterministic and offline. A test that read the live vault would measure a
 * different tree on every run and no tree at all on CI.
 *
 * So the walk happens here, once, and the answer is committed. The fixture is
 * a *snapshot at a date*, which is a weaker thing than "the vault" and is
 * labelled as one in `test/fixtures/public-movable/PROVENANCE.md`. Re-run:
 *
 *   npx tsx scripts/harvest-open-assumptions.ts ../../ost-agent-meta
 *
 * Everything written is mechanical — frontmatter fields, prose before the
 * first reserved heading, and the instrument of each child test. Nothing here
 * is a judgement about an assumption; the judgements live in
 * `src/web/public-movable.ts` (the classifier) and in `hand-labels.json` (the
 * authored answer key), both of which read this file rather than the vault.
 *
 * Nothing in `src/` imports this script. The fixture is the artefact.
 */
import fs from "node:fs";
import path from "node:path";

/** One vault node, reduced to the fields the survey reads. */
interface RawNode {
  title: string;
  type: string;
  status?: string;
  instrument?: string;
  /** Prose before the first `##` heading — the belief, without its ledgers. */
  prose: string;
  /** Titles on the contiguous `[[wikilink]]` lines below the type tag. */
  children: string[];
  /** Whether the file carries a `## Results` block (a recorded finding). */
  hasResult: boolean;
}

function parse(file: string, text: string): RawNode | undefined {
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!fm) return undefined;
  const field = (name: string): string | undefined => {
    const m = new RegExp(`^${name}:\\s*(.+?)\\s*$`, "m").exec(fm[1]);
    return m ? m[1].replace(/^['"]|['"]$/g, "") : undefined;
  };
  const body = text.slice(fm[0].length);
  const beforeHeadings = body.split(/\n## /)[0];
  const children: string[] = [];
  for (const line of beforeHeadings.split("\n")) {
    const link = /^\[\[(.+?)\]\]\s*$/.exec(line.trim());
    if (link) children.push(link[1]);
  }
  const prose = beforeHeadings
    .replace(/^#\S+.*$/gm, "") // the type/status/evidence tag line
    .replace(/^\[\[.*\]\]\s*$/gm, "") // child edges
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return {
    title: file.replace(/\.md$/, ""),
    type: field("type") ?? "Unknown",
    status: field("status"),
    instrument: field("instrument"),
    prose,
    children,
    hasResult: /^## Results/m.test(body),
  };
}

/**
 * Settled statuses. An assumption is OPEN when its status is none of these and
 * no `## Results` block records a finding against it — the same reading
 * `ost-agent rollup` uses for "rests on assertion".
 */
const SETTLED = new Set(["validated", "shipped", "deferred"]);

function main(): void {
  const vault = path.resolve(process.argv[2] ?? "../../ost-agent-meta");
  if (!fs.existsSync(vault)) throw new Error(`no vault at ${vault}`);
  const byTitle = new Map<string, RawNode>();
  for (const file of fs.readdirSync(vault)) {
    if (!file.endsWith(".md")) continue;
    const node = parse(file, fs.readFileSync(path.join(vault, file), "utf8"));
    if (node) byTitle.set(node.title, node);
  }
  const out = [];
  for (const node of byTitle.values()) {
    if (node.type !== "Assumption") continue;
    if (SETTLED.has(node.status ?? "") || node.hasResult) continue;
    const tests = node.children
      .map((t) => byTitle.get(t))
      .filter((t): t is RawNode => Boolean(t) && t!.type === "AssumptionTest")
      .map((t) => ({ title: t.title, instrument: t.instrument ?? "" }));
    out.push({ title: node.title, prose: node.prose, tests });
  }
  out.sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
  const dest = path.resolve("test/fixtures/public-movable/open-assumptions.json");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, `${JSON.stringify(out, null, 2)}\n`);
  process.stdout.write(`${out.length} open assumption(s) → ${dest}\n`);
}

main();
