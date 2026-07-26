/**
 * The web fetch policy guard: only public http(s) URLs pass. Everything
 * loopback/private/link-local/non-http is refused with a reason — fail-closed.
 */
import { describe, expect, test } from "vitest";
import { assertAllowedUrl, MAX_REDIRECTS, MAX_PAGE_CHARS, TIMEOUT_MS } from "../../src/web/guard.js";

describe("assertAllowedUrl", () => {
  test("accepts ordinary public http(s) URLs", () => {
    expect(assertAllowedUrl("https://example.com/page").hostname).toBe("example.com");
    expect(assertAllowedUrl("http://arxiv.org/abs/1234.5678").hostname).toBe("arxiv.org");
  });

  test("rejects non-http schemes", () => {
    for (const bad of ["ftp://example.com/x", "file:///etc/passwd", "gopher://x", "javascript:alert(1)"]) {
      expect(() => assertAllowedUrl(bad)).toThrow(/scheme|http/i);
    }
  });

  test("rejects unparseable URLs", () => {
    expect(() => assertAllowedUrl("not a url")).toThrow();
    expect(() => assertAllowedUrl("")).toThrow();
  });

  test("rejects loopback and private-name hosts", () => {
    for (const bad of [
      "http://localhost/x",
      "http://foo.localhost/x",
      "http://printer.local/",
      "http://db.internal/metrics",
    ]) {
      expect(() => assertAllowedUrl(bad)).toThrow(/private|loopback|internal|local/i);
    }
  });

  test("rejects private/link-local IPv4 literals, accepts public ones", () => {
    for (const bad of [
      "http://127.0.0.1/x",
      "http://127.8.8.8/x",
      "http://10.0.0.5/",
      "http://172.16.0.1/",
      "http://172.31.255.255/",
      "http://192.168.1.1/admin",
      "http://169.254.169.254/latest/meta-data", // cloud metadata endpoint
      "http://0.0.0.0/",
    ]) {
      expect(() => assertAllowedUrl(bad)).toThrow();
    }
    expect(assertAllowedUrl("http://8.8.8.8/").hostname).toBe("8.8.8.8");
    expect(assertAllowedUrl("http://172.32.0.1/").hostname).toBe("172.32.0.1");
  });

  test("rejects ALL IPv6 literals (over-blocking is the fail-closed choice)", () => {
    for (const bad of ["http://[::1]/", "http://[fc00::1]/", "http://[2606:4700::1111]/"]) {
      expect(() => assertAllowedUrl(bad)).toThrow(/ipv6/i);
    }
  });

  test("caps are exported named constants", () => {
    expect(MAX_REDIRECTS).toBe(3);
    expect(MAX_PAGE_CHARS).toBe(20_000);
    expect(TIMEOUT_MS).toBe(10_000);
  });
});
