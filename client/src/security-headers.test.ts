import assert from "node:assert/strict";
import { test } from "node:test";
import config from "../vite.config.ts";
import { DEV_HEADERS, PREVIEW_HEADERS } from "./security-headers.ts";

const directives = (csp: string) => Object.fromEntries(csp.split(";").map((d) => d.trim().split(/\s+/)).map(([name, ...v]) => [name, v.join(" ")]));

test("the production page has a strict CSP: own scripts and styles only, no inline code, no framing", () => {
  const csp = directives(PREVIEW_HEADERS["Content-Security-Policy"]);
  assert.equal(csp["default-src"], "'self'");
  assert.equal(csp["script-src"], "'self'");
  assert.equal(csp["style-src"], "'self'");
  assert.equal(csp["connect-src"], "'self'");
  assert.equal(csp["object-src"], "'none'");
  assert.equal(csp["base-uri"], "'none'");
  assert.equal(csp["frame-ancestors"], "'none'");
  assert.ok(!PREVIEW_HEADERS["Content-Security-Policy"].includes("unsafe"), "no unsafe-inline or unsafe-eval");
});

test("both the dev and production pages refuse framing and sniffing and send no referrer", () => {
  for (const headers of [DEV_HEADERS, PREVIEW_HEADERS]) {
    assert.equal(headers["X-Content-Type-Options"], "nosniff");
    assert.equal(headers["X-Frame-Options"], "DENY");
    assert.equal(headers["Referrer-Policy"], "no-referrer");
    assert.equal(headers["Permissions-Policy"], "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    assert.ok(!("Strict-Transport-Security" in headers), "no HSTS on the plain-HTTP dev and preview servers");
    assert.equal(directives(headers["Content-Security-Policy"])["frame-ancestors"], "'none'");
    assert.equal(directives(headers["Content-Security-Policy"])["object-src"], "'none'");
  }
});

test("Vite serves the headers, keeps one hostname and port, and forwards the browser's Host to the API", () => {
  const { server, preview } = config as { server: Record<string, any>; preview: Record<string, any> };
  assert.equal(server.headers, DEV_HEADERS);
  assert.equal(preview.headers, PREVIEW_HEADERS);
  assert.equal(server.host, "localhost");
  assert.equal(server.strictPort, true);
  assert.equal(preview.strictPort, true);
  assert.equal(server.proxy["/api"].changeOrigin, false);
});

test("the deployed page (vercel.json) sends exactly the preview headers plus HSTS, and only /api goes to the API", async () => {
  const { readFile } = await import("node:fs/promises");
  const vercel = JSON.parse(await readFile(new URL("../../vercel.json", import.meta.url), "utf8"));
  assert.equal(vercel.headers.length, 1);
  const [page] = vercel.headers;
  // The API's own headers (server/src/app.ts) are left alone: page headers never apply to /api/.
  assert.equal(page.source, "/((?!api/).*)");
  const sent = Object.fromEntries(page.headers.map((h: { key: string; value: string }) => [h.key, h.value]));
  assert.deepEqual(sent, { ...PREVIEW_HEADERS, "Strict-Transport-Security": "max-age=31536000" });
  assert.equal(vercel.rewrites.length, 1);
  assert.equal(vercel.rewrites[0].source, "/api/:path*");
  assert.match(vercel.rewrites[0].destination, /^https:\/\/[a-z0-9-]+\.onrender\.com\/api\/:path\*$/);
});
