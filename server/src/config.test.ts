import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { AI_OFF_BAD_MODEL, AI_OFF_NO_KEY, DEFAULT_GEMINI_MODEL, ENV_PATH, loadConfig } from "./config.ts";

function tempEnv(content: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "disputedesk-config-"));
  const file = path.join(dir, ".env");
  writeFileSync(file, content);
  return { file, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test(".env path is fixed to the repo root, whatever the working directory", () => {
  assert.equal(ENV_PATH, path.resolve(import.meta.dirname, "../../.env"));
});

test("reads credentials from the .env file without touching process.env", () => {
  const env = tempEnv("PAYPAL_CLIENT_ID=file-id\nPAYPAL_CLIENT_SECRET=file-secret\n");
  try {
    const config = loadConfig(env.file, {});
    assert.deepEqual(config, {
      port: 3001,
      paypal: { clientId: "file-id", clientSecret: "file-secret" },
      ai: null,
      aiOff: AI_OFF_NO_KEY,
      trustProxy: 0,
      host: "127.0.0.1",
      allowedHosts: [],
      pageOrigins: [],
    });
    // Compare only these keys so a failure never prints the whole environment.
    assert.notEqual(process.env.PAYPAL_CLIENT_ID, "file-id");
    assert.notEqual(process.env.PAYPAL_CLIENT_SECRET, "file-secret");
  } finally {
    env.cleanup();
  }
});

test("shell variables win over the .env file", () => {
  const env = tempEnv("PAYPAL_CLIENT_ID=file-id\nPAYPAL_CLIENT_SECRET=file-secret\nPORT=4000\n");
  try {
    const config = loadConfig(env.file, { PAYPAL_CLIENT_ID: "shell-id", PORT: "5000" });
    assert.equal(config.paypal?.clientId, "shell-id");
    assert.equal(config.paypal?.clientSecret, "file-secret");
    assert.equal(config.port, 5000);
  } finally {
    env.cleanup();
  }
});

test("missing .env or missing secret means PayPal is not configured", () => {
  assert.equal(loadConfig(path.join(tmpdir(), "no-such-dir", ".env"), {}).paypal, null);
  assert.equal(loadConfig(path.join(tmpdir(), "no-such-dir", ".env"), { PAYPAL_CLIENT_ID: "id" }).paypal, null);
});

test("Gemini is configured only when a key is set, with a default model", () => {
  const noFile = path.join(tmpdir(), "no-such-dir", ".env");
  assert.equal(loadConfig(noFile, {}).ai, null);
  assert.deepEqual(loadConfig(noFile, { GEMINI_API_KEY: "test-gemini-key" }).ai, { apiKey: "test-gemini-key", model: DEFAULT_GEMINI_MODEL });
  assert.equal(loadConfig(noFile, { GEMINI_API_KEY: "k", GEMINI_MODEL: "gemini-3.8-flash" }).ai?.model, "gemini-3.8-flash");
  assert.equal(loadConfig(noFile, {}).aiOff, AI_OFF_NO_KEY);
  assert.equal(loadConfig(noFile, { GEMINI_API_KEY: "k" }).aiOff, null);
});

test("an invalid GEMINI_MODEL turns AI drafting off, never the server, and no other model is picked", () => {
  const noFile = path.join(tmpdir(), "no-such-dir", ".env");
  // The model code goes into the URL, so anything else is refused.
  for (const bad of ["../keys", "gemini?alt=x", "Gemini Flash", "a/b", "your_gemini_model_here", " "]) {
    const config = loadConfig(noFile, { GEMINI_API_KEY: "test-gemini-key", GEMINI_MODEL: bad, PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "s" });
    assert.equal(config.ai, null, bad);
    assert.equal(config.aiOff, AI_OFF_BAD_MODEL, bad);
    assert.ok(!AI_OFF_BAD_MODEL.includes(bad.trim() || "\u0000") && !AI_OFF_BAD_MODEL.includes("test-gemini-key"), bad);
    assert.notEqual(config.paypal, null, "the rest of the config still loads");
  }
  // Missing key wins: there is nothing to configure a model for.
  assert.equal(loadConfig(noFile, { GEMINI_MODEL: "a/b" }).aiOff, AI_OFF_NO_KEY);
});

test("invalid PORT is rejected", () => {
  assert.throws(() => loadConfig(path.join(tmpdir(), "no-such-dir", ".env"), { PORT: "abc" }), /PORT/);
});

test("TRUST_PROXY is a small whole number and defaults to 0", () => {
  const noFile = path.join(tmpdir(), "no-such-dir", ".env");
  assert.equal(loadConfig(noFile, {}).trustProxy, 0);
  assert.equal(loadConfig(noFile, { TRUST_PROXY: "1" }).trustProxy, 1);
  for (const bad of ["-1", "11", "1.5", "yes"]) assert.throws(() => loadConfig(noFile, { TRUST_PROXY: bad }), /TRUST_PROXY must be/);
});

test("deployment settings: localhost by default, and only valid hosts and https origins are accepted", () => {
  const noFile = path.join(tmpdir(), "no-such-dir", ".env");
  const plain = loadConfig(noFile, {});
  assert.equal(plain.host, "127.0.0.1");
  assert.deepEqual(plain.allowedHosts, []);
  assert.deepEqual(plain.pageOrigins, []);

  const deployed = loadConfig(noFile, {
    HOST: "0.0.0.0",
    ALLOWED_HOSTS: " DisputeDesk-API.onrender.com , api.example.com",
    PAGE_ORIGINS: "https://disputedesk.vercel.app,https://app.example.com",
  });
  assert.equal(deployed.host, "0.0.0.0");
  assert.deepEqual(deployed.allowedHosts, ["disputedesk-api.onrender.com", "api.example.com"]);
  assert.deepEqual(deployed.pageOrigins, ["https://disputedesk.vercel.app", "https://app.example.com"]);

  for (const bad of ["localhost", "example.com", "1.2.3", "0.0.0.0:80"]) assert.throws(() => loadConfig(noFile, { HOST: bad }), /HOST must be/);
  for (const bad of ["api.example.com:443", "https://api.example.com", "*.example.com", "localhost", "bad_host.com"]) {
    assert.throws(() => loadConfig(noFile, { ALLOWED_HOSTS: bad }), /ALLOWED_HOSTS must be/, bad);
  }
  for (const bad of ["http://app.example.com", "https://app.example.com/", "https://app.example.com/path", "app.example.com", "*"]) {
    assert.throws(() => loadConfig(noFile, { PAGE_ORIGINS: bad }), /PAGE_ORIGINS must be/, bad);
  }
});
