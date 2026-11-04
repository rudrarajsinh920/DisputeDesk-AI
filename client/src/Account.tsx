import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { AccountInfo, Role } from "../../shared/types.ts";

// The signed-in account, read-only. Everything shown comes from /api/auth/me, already loaded at sign-in;
// this page makes no request and changes nothing. Sign out uses the app's existing handler.

const ROLE_NAMES: Record<Role, string> = { merchant: "Merchant", buyer: "Buyer", admin: "Admin (read-only)" };

function reachFor(account: AccountInfo): string[] {
  if (account.role === "merchant") {
    return [
      "The demo disputes on this account, with their evidence checks and draft responses.",
      "Every draft needs your review. Nothing is submitted to PayPal automatically.",
      "Insights from the demo disputes on this account.",
      ...(account.paypal_sandbox ? ["PayPal sandbox disputes, read-only."] : []),
    ];
  }
  if (account.role === "buyer") {
    return [
      "The status of the disputes on this account.",
      "The merchant's order records, evidence, messages and drafts are never shown to buyers.",
    ];
  }
  return [
    "Every demo account and demo dispute, read-only.",
    "PayPal sandbox disputes, read-only.",
    "Admin can't change accounts or disputes, and can't generate AI drafts or summaries.",
  ];
}

const DARK = "(prefers-color-scheme: dark)";

// The device's current light or dark setting, or null where there is no window (tests, server render).
function useDeviceTheme(): "light" | "dark" | null {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);
  useEffect(() => {
    const query = window.matchMedia(DARK);
    const update = () => setTheme(query.matches ? "dark" : "light");
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return theme;
}

function Section({ id, title, description, children }: { id: string; title: string; description: string; children: ReactNode }) {
  return (
    <section className="account-section" aria-labelledby={id}>
      <div className="account-section-intro">
        <h2 id={id}>{title}</h2>
        <p className="muted">{description}</p>
      </div>
      <div className="account-section-body">{children}</div>
    </section>
  );
}

export function AccountView({ account, onSignOut }: { account: AccountInfo; onSignOut: () => void }) {
  const theme = useDeviceTheme();
  const role = ROLE_NAMES[account.role];

  return (
    <div className="account">
      <header className="account-identity">
        <p className="account-display-name">{account.display_name}</p>
        <p className="muted">
          {role} · <span className="wrap">{account.email}</span>
        </p>
      </header>

      <Section id="account-profile" title="Profile" description="Set in the demo data. It can't be changed here.">
        <dl className="config">
          <div>
            <dt>Name</dt>
            <dd>{account.display_name}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd className="wrap">{account.email}</dd>
          </div>
          <div>
            <dt>Account ID</dt>
            <dd className="mono">{account.id}</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd>{role}</dd>
          </div>
          {account.role !== "buyer" && (
            <div>
              <dt>PayPal sandbox</dt>
              <dd>
                {account.role === "admin" || account.paypal_sandbox ? "Can read sandbox disputes" : "No sandbox access"}
                <span className="config-note">Sandbox only, read-only. DisputeDesk never changes a PayPal dispute.</span>
              </dd>
            </div>
          )}
        </dl>
      </Section>

      <Section id="account-reach" title="What this account can reach" description="Checked by the server on every request.">
        <ul className="steps">
          {reachFor(account).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Section>

      <Section id="account-appearance" title="Appearance" description="DisputeDesk follows your device's light or dark setting.">
        <dl className="config">
          <div>
            <dt>Theme</dt>
            <dd>
              Follows your device
              {theme && <span className="config-note">Your device is set to {theme} right now.</span>}
            </dd>
          </div>
        </dl>
      </Section>

      <Section id="account-unavailable" title="Not available in this demo" description="These aren't part of DisputeDesk yet.">
        <ul className="steps not-recorded">
          <li>Changing your name, email or password.</li>
          <li>Two-step sign-in.</li>
          <li>Notification preferences. DisputeDesk doesn't send notifications.</li>
          <li>Choosing a theme other than your device's.</li>
          <li>Signing out other browsers or devices.</li>
        </ul>
      </Section>

      <Section id="account-session" title="Sign-in on this browser" description="Your session is kept by the server, never in the page.">
        <p className="account-session-text">
          Signing out ends this session. A session also ends after a period of inactivity, and signing in again on this browser
          replaces it.
        </p>
        <button type="button" className="button button-secondary" onClick={onSignOut}>
          Sign out
        </button>
      </Section>
    </div>
  );
}
