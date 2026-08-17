/**
 * The offline maintenance pass — a zero-credential, no-network stand-in for the
 * connected session's reasoning, so a first-time user can run one pass end to
 * end with nothing but this checkout.
 *
 * **What this is not.** It is not a trained model, and it does not try to look
 * like one. It drives the exact same MCP tool surface `/ost-pass` does — through
 * a real `createOstMcpServer`, over an in-process transport, so every write goes
 * through the same hierarchy checks, evidence-rung refusals and auto-commit path
 * a Claude Code session's writes do — but the choice of WHAT to write is a fixed,
 * template-driven heuristic rather than a reasoning step. Every node it creates
 * says so in its own body, carries the floor evidence rung ('assertion'), and
 * every AssumptionTest it surfaces is born `humansRequired`: this driver cannot
 * write a real spec file against a product it has never read, so it does not
 * pretend to. A human is expected to replace or retire what it produces.
 *
 * **Why it can still call itself a pass.** `ost_next_work` is the same
 * definition of done a person reads, and this walks it exactly the way `/ost-pass`
 * is instructed to: map unmapped evidence into Opportunities, ideate Solutions
 * under an under-served Opportunity, surface an Assumption + AssumptionTest under
 * a bare Solution, annotate hygiene issues. It stops the moment none of those four
 * buckets has anything left for it, or after `maxIterations` rounds — whichever
 * comes first — rather than spinning: `solutionsMissingInstruments` never clears
 * on its own writes (a humansRequired test carries no instrument by construction),
 * so a loop that kept firing while ANY bucket was non-empty would never stop.
 */
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createOstMcpServer } from "../mcp/server.js";
import { buildPassContext } from "./context.js";
import { DATA_FRAME } from "../security/framing.js";

const FRAME_HEAD = `${DATA_FRAME}\n---\n`;

/** Strip the data frame a tool response wraps untrusted content in. */
function unframe(text: string): string {
  return text.startsWith(FRAME_HEAD) ? text.slice(FRAME_HEAD.length) : text;
}

/** One line, capped, safe to fold into a heuristic title. */
function oneLine(text: string, maxChars: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > maxChars ? `${flat.slice(0, maxChars).trim()}…` : flat;
}

export interface OfflinePassSummary {
  /** New #Opportunity nodes minted from previously-unmapped evidence. */
  mapped: number;
  /** New #Solution nodes minted under an under-served #Opportunity. */
  ideated: number;
  /** New #Assumption + #AssumptionTest pairs surfaced under a bare #Solution. */
  assumptionsSurfaced: number;
  /** Hygiene issues annotated (never fixed — annotation is the clear path). */
  hygieneAnnotated: number;
  /** How many map/ideate/assumption/hygiene rounds actually ran. */
  iterations: number;
  /** `ost_next_work`'s own verdict after the last round. */
  done: boolean;
  /**
   * Work this driver saw and deliberately left alone — never silent, for the
   * same reason a capped list in `ost_next_work` names what it hid. Every one of
   * these needs either a person or a real reasoning step this driver does not
   * have.
   */
  leftForAHuman: { assumptionWork: number; openUnknowns: number; solutionsMissingInstruments: number };
}

interface ToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

const MAX_ITERATIONS = 10;

/**
 * Run one offline maintenance pass against `dir`. Requires a vault already
 * initialized (`ost-agent init`) — this drives maintenance, it does not
 * bootstrap a first Outcome, which is a human's mandate to set.
 *
 * Makes no network call and reads no model credential: every choice below is a
 * fixed template over what `ost_next_work` already reported, not a call to any
 * external service.
 */
export async function runOfflinePass(dir: string, opts: { maxIterations?: number } = {}): Promise<OfflinePassSummary> {
  const ctx = buildPassContext(dir);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createOstMcpServer(ctx);
  const client = new Client({ name: "ost-agent-offline-driver", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const call = async (name: string, args: Record<string, unknown>): Promise<string> => {
    const res = (await client.callTool({ name, arguments: args })) as ToolResult;
    const text = res.content.map((c) => c.text ?? "").join("\n");
    if (res.isError) throw new Error(`${name} refused: ${text}`);
    return text;
  };

  const summary: OfflinePassSummary = {
    mapped: 0,
    ideated: 0,
    assumptionsSurfaced: 0,
    hygieneAnnotated: 0,
    iterations: 0,
    done: false,
    leftForAHuman: { assumptionWork: 0, openUnknowns: 0, solutionsMissingInstruments: 0 },
  };

  try {
    const treeText = await call("ost_read_tree", {});
    const tree = JSON.parse(treeText) as { nodes: Array<{ title: string; layer: string }> };
    const outcome = tree.nodes.find((n) => n.layer === "Outcome")?.title;
    if (!outcome) {
      throw new Error(
        "no Outcome node — the offline pass performs maintenance on an existing mandate, it does not set one; " +
          "run `ost-agent init` first (a human's step, on purpose).",
      );
    }

    const maxIterations = opts.maxIterations ?? MAX_ITERATIONS;
    for (; summary.iterations < maxIterations; summary.iterations++) {
      const workText = await call("ost_next_work", {});
      const work = JSON.parse(workText) as {
        done: boolean;
        unmappedEvidence: Array<{ id: string; source: string; title: string; excerpt: string }>;
        underservedOpportunities: Array<{ title: string; solutions: number; needed: number }>;
        solutionsMissingAssumptions: Array<{ title: string }>;
        hygieneIssues: Array<{ title: string; issue: string }>;
        assumptionWork: { runnable: string[]; awaitingOneCommand: string[]; blockedOnPermission: string[]; needsHumans: string[] };
        openUnknowns: unknown[];
        solutionsMissingInstruments: string[];
      };
      summary.done = work.done;
      summary.leftForAHuman = {
        assumptionWork:
          work.assumptionWork.runnable.length +
          work.assumptionWork.awaitingOneCommand.length +
          work.assumptionWork.blockedOnPermission.length +
          work.assumptionWork.needsHumans.length,
        openUnknowns: work.openUnknowns.length,
        solutionsMissingInstruments: work.solutionsMissingInstruments.length,
      };

      let actedThisRound = false;

      // P5 — hygiene. Annotate, never fix in place: the clear path every other
      // gate in this repository already uses.
      for (const issue of work.hygieneIssues) {
        // Written back VERBATIM: `ost_next_work`'s "already annotated" check
        // matches this exact string against what a node's `## Issues` section
        // holds (`annotatedIssues` in next-work.ts). Any decoration here — a
        // driver signature, a timestamp — would make every round's annotation
        // look like a NEW issue to that check, and the pass would re-annotate
        // the same five issues forever instead of clearing them.
        await call("ost_annotate", { title: issue.title, issue: issue.issue });
        summary.hygieneAnnotated++;
        actedThisRound = true;
      }

      // P2 — map. One #Opportunity per unmapped record, cited by the record's id
      // so it leaves `unmappedEvidence` on the next read.
      for (const ev of work.unmappedEvidence) {
        const excerpt = oneLine(unframe(ev.excerpt), 400);
        const title = oneLine(`Offline pass: ${excerpt || ev.title}`, 180);
        await call("ost_create_node", {
          title,
          layer: "Opportunity",
          parent: outcome,
          source: ev.id,
          evidence: "assertion",
          body:
            `Mapped by the bundled offline driver, mechanically, from evidence "${ev.id}":\n\n"${excerpt}"\n\n` +
            "No reasoning ran over this — the driver has no model to reason with. A person needs to read the " +
            "underlying record and decide whether a real opportunity is here at all.",
        });
        summary.mapped++;
        actedThisRound = true;
      }

      // P3 — ideate. Fill every under-served Opportunity up to its configured
      // minimum with placeholder Solutions.
      for (const opp of work.underservedOpportunities) {
        const need = Math.max(0, opp.needed - opp.solutions);
        for (let i = 0; i < need; i++) {
          const title = oneLine(`Offline candidate ${opp.solutions + i + 1} for "${opp.title}"`, 190);
          await call("ost_create_node", {
            title,
            layer: "Solution",
            parent: opp.title,
            evidence: "assertion",
            body:
              "Placeholder candidate solution, generated mechanically by the bundled offline driver to satisfy the " +
              "minimum-solutions count — it is not an idea anyone had. Replace it before treating this opportunity " +
              "as actually explored.",
          });
          summary.ideated++;
          actedThisRound = true;
        }
      }

      // P4 — surface an Assumption + AssumptionTest under every bare Solution.
      // Always `humansRequired`: this driver cannot see a product repo well
      // enough to write a real, currently-failing spec command, and a fabricated
      // one would be worse than admitting that.
      for (const sol of work.solutionsMissingAssumptions) {
        const assumptionTitle = oneLine(`Untested assumption behind "${sol.title}"`, 190);
        await call("ost_create_node", {
          title: assumptionTitle,
          layer: "Assumption",
          parent: sol.title,
          evidence: "assertion",
          body:
            "Named mechanically by the bundled offline driver: this solution rests on SOME belief that could be " +
            "wrong, and nobody has said which one yet. A person should replace this with the real belief.",
        });
        const testTitle = oneLine(`Whether "${sol.title}" is worth building`, 190);
        await call("ost_create_node", {
          title: testTitle,
          layer: "AssumptionTest",
          parent: assumptionTitle,
          evidence: "assertion",
          humansRequired:
            "the offline driver has no reasoning model and no sight of the product repo, so it cannot write a " +
            "real command that fails today and passes once this is built — only a person can judge this one.",
          body: "Placeholder test surfaced mechanically so this solution is not silently unexamined.",
        });
        summary.assumptionsSurfaced++;
        actedThisRound = true;
      }

      if (!actedThisRound) break;
    }
  } finally {
    await client.close();
    await server.close();
  }

  return summary;
}
