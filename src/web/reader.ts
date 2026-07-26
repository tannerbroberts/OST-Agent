/**
 * The bounded page reader — one guarded GET, reduced to text.
 *
 * Every request goes through {@link assertAllowedUrl}, including every
 * redirect hop (redirects are followed manually so a public URL cannot bounce
 * the reader into a private address). Output is capped, truncation is made
 * visible, and everything fetched is untrusted DATA, never instructions —
 * the caller is responsible for keeping that framing when it shows the text
 * to a model.
 *
 * `fetchFn` is injectable (the Slack-adapter pattern) so tests never touch
 * the network.
 */
import { assertAllowedUrl, MAX_PAGE_CHARS, MAX_REDIRECTS, TIMEOUT_MS } from "./guard.js";

/** The structural slice of `fetch` the reader needs; `globalThis.fetch` satisfies it. */
export type WebFetchFn = (
  url: string,
  init: { method: string; headers: Record<string, string>; redirect: "manual"; signal?: AbortSignal },
) => Promise<{
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export interface WebPage {
  /** Final URL after redirects. */
  url: string;
  /** Final host — the provenance is `WEB:<host>`. */
  host: string;
  title?: string;
  text: string;
  truncated: boolean;
}

export interface ReadWebPageOptions {
  fetchFn?: WebFetchFn;
  maxChars?: number;
  timeoutMs?: number;
}

export async function readWebPage(rawUrl: string, opts: ReadWebPageOptions = {}): Promise<WebPage> {
  const fetchFn = opts.fetchFn ?? (globalThis.fetch as unknown as WebFetchFn);
  const maxChars = opts.maxChars ?? MAX_PAGE_CHARS;
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;

  let url = assertAllowedUrl(rawUrl);
  for (let hop = 0; ; hop++) {
    const res = await fetchFn(url.toString(), {
      method: "GET",
      headers: { "user-agent": "ost-agent (read-only)", accept: "text/html, text/plain, application/json;q=0.9, */*;q=0.5" },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new Error(`GET ${url} answered ${res.status} with no location`);
      if (hop >= MAX_REDIRECTS) throw new Error(`too many redirects (more than ${MAX_REDIRECTS}) from ${rawUrl}`);
      url = assertAllowedUrl(new URL(location, url).toString());
      continue;
    }
    if (!res.ok) throw new Error(`GET ${url} failed with HTTP ${res.status}`);

    const contentType = res.headers.get("content-type") ?? "";
    const raw = await res.text();
    let title: string | undefined;
    let text: string;
    if (/html/i.test(contentType) || /^\s*</.test(raw)) {
      ({ title, text } = htmlToText(raw));
    } else {
      text = raw;
    }
    const truncated = text.length > maxChars;
    return { url: url.toString(), host: url.hostname.toLowerCase(), title, text: truncated ? text.slice(0, maxChars) : text, truncated };
  }
}

/** Reduce HTML to readable text: drop script/style, keep block breaks, decode common entities. */
export function htmlToText(html: string): { title?: string; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? decodeEntities(titleMatch[1]).trim() || undefined : undefined;
  const text = decodeEntities(
    html
      .replace(/<(script|style|noscript|head)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<\/?(p|div|li|ul|ol|h[1-6]|tr|table|section|article|blockquote)\b[^>]*>|<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title, text };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
