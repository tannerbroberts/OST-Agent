import { describe, expect, test } from "vitest";
import {
  AtlassianSource,
  HttpAtlassianClient,
  adfToText,
  htmlToText,
  type AtlassianClient,
  type ConfluencePage,
  type JiraIssue,
} from "../../src/adapters/atlassian.js";

function fakeClient(jira: JiraIssue[], conf: ConfluencePage[] = []): AtlassianClient {
  return {
    async searchJira() {
      return jira;
    },
    async searchConfluence() {
      return conf;
    },
  };
}

describe("AtlassianSource mapping + incremental cursor", () => {
  const issue = (key: string, updated: string): JiraIssue => ({
    key,
    summary: `summary ${key}`,
    description: `desc ${key}`,
    comments: [`comment on ${key}`],
    updated,
    url: `https://x.atlassian.net/browse/${key}`,
  });

  test("maps Jira + Confluence to normalized EvidenceItems", async () => {
    const src = new AtlassianSource(
      fakeClient(
        [issue("PROJ-1", "2026-07-20T10:00:00.000Z")],
        [{ id: "123", title: "Discovery notes", body: "page body", updated: "2026-07-20T11:00:00.000Z", url: "https://x/wiki/123" }],
      ),
      { projects: ["PROJ"], spaces: ["DISCO"] },
    );
    const { items } = await src.fetchSince(null);
    const jiraItem = items.find((i) => i.id === "JIRA:PROJ-1")!;
    expect(jiraItem.title).toBe("PROJ-1: summary PROJ-1");
    expect(jiraItem.body).toContain("desc PROJ-1");
    expect(jiraItem.body).toContain("comment on PROJ-1");
    expect(items.find((i) => i.id === "CONFLUENCE:123")!.title).toBe("Discovery notes");
  });

  test("advances the cursor and does not re-emit already-seen items", async () => {
    const src = new AtlassianSource(
      fakeClient([issue("PROJ-1", "2026-07-20T10:00:00.000Z"), issue("PROJ-2", "2026-07-21T09:00:00.000Z")]),
      { projects: ["PROJ"], spaces: [] },
    );
    const first = await src.fetchSince(null);
    expect(first.items.map((i) => i.id).sort()).toEqual(["JIRA:PROJ-1", "JIRA:PROJ-2"]);

    // same data on re-run → nothing new (boundary item PROJ-2 is remembered as seen)
    const second = await src.fetchSince(first.cursor);
    expect(second.items).toHaveLength(0);
  });

  test("emits only genuinely newer items on the next run", async () => {
    const src1 = new AtlassianSource(fakeClient([issue("PROJ-1", "2026-07-20T10:00:00.000Z")]), { projects: ["PROJ"], spaces: [] });
    const first = await src1.fetchSince(null);

    const src2 = new AtlassianSource(
      fakeClient([issue("PROJ-1", "2026-07-20T10:00:00.000Z"), issue("PROJ-9", "2026-07-25T08:00:00.000Z")]),
      { projects: ["PROJ"], spaces: [] },
    );
    const second = await src2.fetchSince(first.cursor);
    expect(second.items.map((i) => i.id)).toEqual(["JIRA:PROJ-9"]);
  });

  test("skips a source with no projects/spaces configured", async () => {
    let called = false;
    const client: AtlassianClient = {
      async searchJira() {
        called = true;
        return [];
      },
      async searchConfluence() {
        return [];
      },
    };
    const src = new AtlassianSource(client, { projects: [], spaces: [] });
    const { items } = await src.fetchSince(null);
    expect(items).toHaveLength(0);
    expect(called).toBe(false);
  });
});

describe("ADF / HTML extraction", () => {
  test("adfToText walks the node tree", () => {
    const adf = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Users want " }, { type: "text", text: "a daily reason." }] },
        { type: "paragraph", content: [{ type: "text", text: "Second line." }] },
      ],
    };
    const text = adfToText(adf);
    expect(text).toContain("Users want a daily reason.");
    expect(text).toContain("Second line.");
  });

  test("htmlToText strips tags and decodes entities", () => {
    expect(htmlToText("<p>Hello &amp; welcome</p><p>Line&nbsp;two</p>")).toBe("Hello & welcome\nLine two");
  });
});

describe("HttpAtlassianClient request shape (injected fetch)", () => {
  test("issues GET requests with Basic auth and a JQL updated filter", async () => {
    const calls: { url: string; method: string; headers: Record<string, string> }[] = [];
    const fetchFn = async (url: string, init: { method: string; headers: Record<string, string> }) => {
      calls.push({ url, method: init.method, headers: init.headers });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            issues: [
              {
                key: "PROJ-1",
                fields: {
                  summary: "s",
                  description: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "body text" }] }] },
                  updated: "2026-07-20T10:00:00.000Z",
                  comment: { comments: [{ body: { type: "doc", content: [{ type: "text", text: "a comment" }] } }] },
                },
              },
            ],
          };
        },
        async text() {
          return "";
        },
      };
    };
    const client = new HttpAtlassianClient({ baseUrl: "https://x.atlassian.net", email: "me@x.com", apiToken: "tok", fetchFn });

    const issues = await client.searchJira({ projects: ["PROJ"], since: "2026-07-01T00:00:00.000Z" });

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET"); // read-only
    expect(calls[0].url).toContain("/rest/api/3/search/jql");
    // URLSearchParams encodes spaces as '+'; normalize before checking the JQL
    expect(decodeURIComponent(calls[0].url.replace(/\+/g, " "))).toContain("updated >=");
    expect(calls[0].headers.Authorization).toBe("Basic " + Buffer.from("me@x.com:tok").toString("base64"));
    // ADF was extracted into plain text
    expect(issues[0].description).toContain("body text");
    expect(issues[0].comments[0]).toContain("a comment");
    expect(issues[0].url).toBe("https://x.atlassian.net/browse/PROJ-1");
  });
});
