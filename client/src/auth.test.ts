import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { fetchMe, signIn, signOut } from "./auth.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const calls: { url: string; init?: RequestInit }[] = [];
function respond(status: number, body: unknown) {
  calls.length = 0;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(body === undefined ? null : JSON.stringify(body), { status });
  }) as typeof fetch;
}
const account = { id: "buyer-a", email: "buyer-a@demo.disputedesk.test", role: "buyer", display_name: "Demo Buyer A", paypal_sandbox: false };

test("fetchMe returns the account, null when signed out, and throws when the server fails", async () => {
  respond(200, { account });
  assert.deepEqual(await fetchMe(), account);
  respond(401, { error: { code: "not_signed_in", message: "Sign in to continue." } });
  assert.equal(await fetchMe(), null);
  respond(502, null);
  await assert.rejects(fetchMe(), /not responding/);
  respond(200, { account: { ...account, role: "owner" } });
  await assert.rejects(fetchMe(), /unexpected response/);
});

test("signIn sends only email and password as JSON and surfaces the server's message", async () => {
  respond(200, { account });
  assert.deepEqual(await signIn("buyer-a@demo.disputedesk.test", "pw"), account);
  assert.equal(calls[0].url, "/api/auth/login");
  assert.equal(calls[0].init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { email: "buyer-a@demo.disputedesk.test", password: "pw" });

  respond(401, { error: { code: "invalid_credentials", message: "Email or password is incorrect." } });
  await assert.rejects(signIn("x@demo.disputedesk.test", "nope"), /Email or password is incorrect\. \(HTTP 401\)/);
});

test("signOut posts to the logout route", async () => {
  respond(204, undefined);
  await signOut();
  assert.deepEqual([calls[0].url, calls[0].init?.method], ["/api/auth/logout", "POST"]);
});
