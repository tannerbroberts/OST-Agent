/**
 * The descent, and the silence it is not allowed to produce.
 *
 * A category is never the next thing to do — the tree files headings and hangs
 * the specific needs beneath them, so a solution cannot legitimately sit on one.
 * The queue therefore walks a short heading down to its leaves and reports the
 * under-served ones in its place, naming the heading on each entry it hands back
 * (`redirectedFrom`). That is the property the cheap sibling cannot offer: the
 * exemption makes a category silent, this makes it transparent.
 *
 * The whole advantage turns on one case, and it is the case this file exists for.
 * A descent can come back empty — a heading short of direct solutions whose every
 * leaf is already at or above `min` — and if an empty descent is indistinguishable
 * from a healthy branch, redirection has bought a traversal and delivered the
 * exemption's false negative by a longer road. So an empty descent is an ENTRY
 * (`emptyDescents`) and a sentence in the summary, never an absence. The rest of
 * the assertions here are the redirect proper; that one is the bar.
 *
 * Sits beside `next-work-category-exemption.test.ts`, which pins the guard this
 * builds on. The two agree on the shape they share: a heading with nothing at all
 * beneath it has no leaf to descend to and stays listed itself.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { computeNextWork } from "../../src/mcp/next-work.js";
import type { Vault } from "../../src/ost/vault.js";

/** The `minSolutionsPerOpportunity` every other spec in this repo fixtures against. */
const MIN = 3;

/** The Outcome's one seeded heading; every fixture below hangs off it. */
const ROOT = "Retention";

let dir: string;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-descent-"));
  await initVault(dir, "Reach 10,000 daily active users", ROOT);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function opportunity(vault: Vault, title: string, parent: string): void {
  vault.createNode({ title, layer: "Opportunity", evidence: "observed", source: "INBOX:n.md", body: "b", tags: [], links: [] });
  vault.linkNodes(parent, title);
}

function solution(vault: Vault, title: string, parent: string): void {
  vault.createNode({ title, layer: "Solution", evidence: "assertion", body: "b", tags: [], links: [] });
  vault.linkNodes(parent, title);
}

/** Serve an opportunity to exactly `min`, so the descent finds nothing to want there. */
function serve(vault: Vault, parent: string): void {
  for (let i = 0; i < MIN; i++) solution(vault, `${parent} — candidate ${i + 1}`, parent);
}

function work() {
  return computeNextWork(buildPassContext(dir).vault, dir, MIN);
}

describe("the descent from a short category to the leaves beneath it", () => {
  test("a short category whose every leaf is at or above the threshold reports the empty descent, rather than nothing", () => {
    const vault = buildPassContext(dir).vault;
    opportunity(vault, "Players stop returning after week one", ROOT);
    opportunity(vault, "There is no reason to open the app on day 8", "Players stop returning after week one");
    serve(vault, "There is no reason to open the app on day 8");

    const { underservedOpportunities, emptyDescents, summary } = work();

    // The branch produces no work, and that is legitimate — but it is a finding
    // about the leaves, not a heading that quietly stopped being asked. Absence
    // here is the failure this whole candidate is being judged on.
    const entry = emptyDescents.find((d) => d.category === "Players stop returning after week one");
    expect(entry).toBeDefined();
    expect(entry?.leavesReached).toBe(1);
    expect(entry?.leaves).toEqual(["There is no reason to open the app on day 8"]);

    // Neither the heading nor its served leaf is offered as work: the descent had
    // somewhere to look and everything it found was already at `min`.
    const titles = underservedOpportunities.map((o) => o.title);
    expect(titles).not.toContain("Players stop returning after week one");
    expect(titles).not.toContain("There is no reason to open the app on day 8");

    // And it is legible to a person, not only to a field. "Silence with a reason"
    // is worth nothing if the reason only exists in the JSON nobody prints.
    expect(summary).toContain("EMPTY DESCENT");
    expect(summary).toContain("Players stop returning after week one");
  });

  test("a short category with an under-served leaf redirects to it, and the entry names the heading it stands in for", () => {
    const vault = buildPassContext(dir).vault;
    opportunity(vault, "Onboarding loses people at the second step", ROOT);
    opportunity(vault, "The permissions prompt arrives before any reason to grant it", "Onboarding loses people at the second step");
    solution(vault, "Ask after the first success", "The permissions prompt arrives before any reason to grant it");

    const { underservedOpportunities, emptyDescents } = work();

    // The descent had somewhere to go, so nothing is quiet and nothing is reported
    // as empty. This is the case the empty-descent list must NOT fire on, or the
    // diagnostic degrades into noise on every healthy branch.
    expect(emptyDescents.map((d) => d.category)).not.toContain("Onboarding loses people at the second step");

    const leaf = underservedOpportunities.find(
      (o) => o.title === "The permissions prompt arrives before any reason to grant it",
    );
    expect(leaf).toBeDefined();
    expect(leaf?.solutions).toBe(1);
    // The edge the 2026-08-07 pass had to reconstruct by hand for 24 headings:
    // this leaf is the answer to that heading being short.
    expect(leaf?.redirectedFrom).toContain("Onboarding loses people at the second step");
    // The heading itself is never the entry — a solution cannot hang there.
    expect(underservedOpportunities.map((o) => o.title)).not.toContain("Onboarding loses people at the second step");
  });

  test("a leaf beneath several short categories names all of them, sorted", () => {
    const vault = buildPassContext(dir).vault;
    opportunity(vault, "Weekly actives are flat", ROOT);
    opportunity(vault, "Notifications are ignored", ROOT);
    opportunity(vault, "The digest email says nothing new", "Weekly actives are flat");
    vault.linkNodes("Notifications are ignored", "The digest email says nothing new");

    const leaf = work().underservedOpportunities.find((o) => o.title === "The digest email says nothing new");
    // Every short heading above it, not merely the nearest — each one is quiet on
    // account of this entry. Sorted, because the ordering rule for a multi-parent
    // leaf is the one open design question here, and a response two passes can be
    // diffed is the answer. (`Retention` is the Outcome, not an Opportunity, so it
    // is never short and never descends.)
    expect(leaf?.redirectedFrom).toEqual(["Notifications are ignored", "Weekly actives are flat"]);
  });

  test("a leaf under a well-served heading is redirected from nobody, and says so with an empty list", () => {
    const vault = buildPassContext(dir).vault;
    opportunity(vault, "Search returns the wrong thing", ROOT);
    serve(vault, "Search returns the wrong thing");
    opportunity(vault, "Nobody can find the export button", "Search returns the wrong thing");

    const leaf = work().underservedOpportunities.find((o) => o.title === "Nobody can find the export button");
    expect(leaf).toBeDefined();
    // `Search returns the wrong thing` holds three of its own and was never short,
    // so it was never descended and is waiting on nothing. The field reports the
    // headings actually standing behind this leaf and nothing else — an entry the
    // queue would have surfaced anyway does not acquire a redirect it never had.
    expect(leaf?.redirectedFrom).toEqual([]);
  });

  test("a heading with a child but nothing at all beneath it is listed itself, not reported as an empty descent", () => {
    const vault = buildPassContext(dir).vault;
    opportunity(vault, "Onboarding is confusing", ROOT);
    opportunity(vault, "The first screen asks for too much", "Onboarding is confusing");

    const { underservedOpportunities, emptyDescents } = work();
    // The exemption's guard, unchanged: an empty subtree is the gap this list
    // exists to find. The descent agrees with it rather than overriding it —
    // there IS an under-served leaf beneath, so this is a redirect, not silence.
    expect(underservedOpportunities.map((o) => o.title)).toContain("Onboarding is confusing");
    expect(emptyDescents.map((d) => d.category)).not.toContain("Onboarding is confusing");
    const leaf = underservedOpportunities.find((o) => o.title === "The first screen asks for too much");
    expect(leaf?.redirectedFrom).toEqual(["Onboarding is confusing"]);
  });
});
