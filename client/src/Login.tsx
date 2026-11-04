import { useState } from "react";
import type { FormEvent } from "react";
import type { AccountInfo } from "../../shared/types.ts";
import { signIn } from "./auth.ts";

// The browser's own required and email checks, shown under each field instead of as a pop-up.
export const emailError = (value: string) =>
  !value.trim() ? "Enter your email address." : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? undefined : "Enter an email address like name@example.com.";
export const passwordError = (value: string) => (value ? undefined : "Enter your password.");

export function Login({ notice, onSignedIn }: { notice: string | null; onSignedIn: (account: AccountInfo) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const found = { email: emailError(email), password: passwordError(password) };
    setErrors(found);
    if (found.email || found.password) {
      setError(null);
      formElement.querySelector<HTMLInputElement>(found.email ? "#login-email" : "#login-password")?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await signIn(email, password));
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
        <form className="login-form" onSubmit={submit} noValidate>
          <label htmlFor="login-email">Email</label>
          <input
            id="login-email"
            name="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            spellCheck={false}
            placeholder="name@example.com"
            required
            maxLength={254}
            autoFocus
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? "login-email-error" : undefined}
            onChange={(e) => errors.email && setErrors((prev) => ({ ...prev, email: emailError(e.target.value) }))}
          />
          {errors.email && (
            <p id="login-email-error" className="field-error">
              {errors.email}
            </p>
          )}
          <label htmlFor="login-password">Password</label>
          <input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={200}
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={errors.password ? "login-password-error" : undefined}
            onChange={(e) => errors.password && setErrors((prev) => ({ ...prev, password: passwordError(e.target.value) }))}
          />
          {errors.password && (
            <p id="login-password-error" className="field-error">
              {errors.password}
            </p>
          )}
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
