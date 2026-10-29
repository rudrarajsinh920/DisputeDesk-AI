import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ENV_PATH, loadConfig } from "./config.ts";

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
    assert.deepEqual(config, { port: 3001, paypal: { clientId: "file-id", clientSecret: "file-secret" } });
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

test("invalid PORT is rejected", () => {
  assert.throws(() => loadConfig(path.join(tmpdir(), "no-such-dir", ".env"), { PORT: "abc" }), /PORT/);
});
