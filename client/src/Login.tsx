import { useState } from "react";
import type { FormEvent } from "react";
import type { AccountInfo } from "../../shared/types.ts";
import { signIn } from "./auth.ts";

export function Login({ notice, onSignedIn }: { notice: string | null; onSignedIn: (account: AccountInfo) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await signIn(String(form.get("email") ?? ""), String(form.get("password") ?? "")));
    } catch (e) {
      setError((e instanceof Error ? e.message : String(e)).replace(/ \(HTTP \d+\)$/, ""));
      setBusy(false);
    }
  }

  return (
    <main className="main">
      <section className="panel login" aria-labelledby="login-heading">
        <h1 id="login-heading">Sign in to DisputeDesk</h1>
        <div className="banner banner-demo" role="note">
          <strong>SYNTHETIC DEMO ACCOUNTS</strong>
          <span>Sign in with a demo account listed in README.md. Never enter a real password here.</span>
        </div>
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        <form className="login-form" onSubmit={submit}>
          <label htmlFor="login-email">Email</label>
          <input id="login-email" name="email" type="email" autoComplete="username" required maxLength={254} autoFocus />
          <label htmlFor="login-password">Password</label>
          <input id="login-password" name="password" type="password" autoComplete="current-password" required maxLength={200} />
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="button" aria-disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}
