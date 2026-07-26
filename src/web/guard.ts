/**
 * The web fetch policy guard — what the agent may point a GET at.
 *
 * Fail-closed: only `http`/`https` URLs to hosts that are plainly public pass.
 * Loopback, RFC-1918, link-local (including the cloud metadata endpoint), and
 * obviously-internal names are refused; IPv6 literals are refused wholesale
 * because over-blocking a rare URL shape is cheaper than enumerating its
 * private ranges correctly.
 *
 * Known limit: this is a hostname-level check. It does not resolve DNS, so a
 * public name pointing at a private address is not caught. Acceptable for a
 * read-only GET issued from an operator machine; documented, not hidden.
 */

/** Maximum redirect hops a single read may follow; each hop is re-validated. */
export const MAX_REDIRECTS = 3;
/** Per-request timeout. */
export const TIMEOUT_MS = 10_000;
/** Cap on the text returned from one page read. */
export const MAX_PAGE_CHARS = 20_000;

const PRIVATE_NAME = /(^|\.)(localhost|local|internal)$/i;

/** Parse and vet a URL for outbound reading. Returns the URL or throws with the reason. */
export function assertAllowedUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`"${raw}" is not a valid URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`scheme "${url.protocol}" is not allowed — only http/https can be read`);
  }
  const host = url.hostname.toLowerCase();
  if (host.startsWith("[") || host.includes(":")) {
    throw new Error(`IPv6 literal hosts are not allowed (refusing "${host}")`);
  }
  if (PRIVATE_NAME.test(host)) {
    throw new Error(`"${host}" is a loopback/internal name — only public hosts can be read`);
  }
  if (isPrivateIpv4(host)) {
    throw new Error(`"${host}" is a private or link-local address — only public hosts can be read`);
  }
  return url;
}

function isPrivateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}
