import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { REASON_LABELS, STATUS_FILTERS, STATUS_LABELS, countByStatus, formatMoney, labelFor, summarize } from "../../shared/disputes.ts";
import type { AccountInfo, AiStatus, Dispute } from "../../shared/types.ts";
import { serverError } from "./sandbox.ts";
import { ONE_COLUMN, StatePanel, StatusBadge } from "./ui.tsx";

// Admin views: read-only, built only from what the server already sends an admin
// (/api/admin/accounts, /api/disputes and /api/health). Nothing here changes an account, a dispute or a setting.

export type AdminAccount = AccountInfo & { dispute_ids: string[] };
export type Health = { checked_at: Date; paypal_configured: boolean; ai: AiStatus };
export type Load<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; value: T };

const isAccount = (a: Partial<AdminAccount> | null) =>
  typeof a?.id === "string" && typeof a.email === "string" && typeof a.display_name === "string" && Array.isArray(a.dispute_ids);

export async function fetchAdminAccounts(signal?: AbortSignal): Promise<AdminAccount[]> {
  const response = await fetch("/api/admin/accounts", { signal });
  const body = (await response.json().catch(() => null)) as { accounts?: unknown } | null;
  if (!response.ok) throw serverError(response, body);
  if (!Array.isArray(body?.accounts) || !body.accounts.every(isAccount)) throw new Error("The DisputeDesk server sent an unexpected response.");
  return body.accounts as AdminAccount[];
}

// Reads the server's own configuration. The server answers without contacting PayPal or Gemini.
export async function fetchHealth(signal?: AbortSignal): Promise<Health> {
  const response = await fetch("/api/health", { signal });
  const body = (await response.json().catch(() => null)) as {
    paypal?: { configured?: unknown };
    ai?: { configured?: unknown; model?: unknown; reason?: unknown };
  } | null;
  if (!response.ok) throw serverError(response, body);
  const ai = body?.ai;
  const status: AiStatus | null =
    ai?.configured === true && typeof ai.model === "string"
      ? { on: true, model: ai.model }
      : ai?.configured === false && typeof ai.reason === "string"
        ? { on: false, reason: ai.reason }
        : null;
  if (!status || typeof body?.paypal?.configured !== "boolean") throw new Error("The DisputeDesk server sent an unexpected status.");
  return { checked_at: new Date(), paypal_configured: body.paypal.configured, ai: status };
}

export function useLoad<T>(fetcher: (signal: AbortSignal) => Promise<T>, enabled: boolean): [Load<T>, () => void] {
  const [load, setLoad] = useState<Load<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setLoad({ status: "loading" });
    fetcher(controller.signal)
      .then((value) => setLoad({ status: "ready", value }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({ status: "error", message: error instanceof Error ? error.message : String(error) });
      });
    return () => controller.abort();
  }, [fetcher, enabled, attempt]);
  return [load, () => setAttempt((n) => n + 1)];
}

// One loading or error state for a view that needs several loads.
export function Loaded({ loads, onRetry, what, children }: { loads: Load<unknown>[]; onRetry: () => void; what: string; children: () => ReactNode }) {
  const failed = loads.find((l) => l.status === "error");
  if (failed?.status === "error") {
    return (
      <StatePanel title={`Couldn't load ${what}`} tone="error">
        <p>{failed.message}</p>
        <button type="button" className="button" onClick={onRetry}>
          Try again
        </button>
      </StatePanel>
    );
  }
  if (loads.some((l) => l.status === "loading")) return <StatePanel title={`Loading ${what}…`} busy />;
  return <>{children()}</>;
}

// Which merchant account each demo dispute belongs to, from the accounts' own dispute lists.
export const ownerNames = (accounts: AdminAccount[]) =>
  new Map(accounts.filter((a) => a.role === "merchant").flatMap((a) => a.dispute_ids.map((id) => [id, a.display_name] as const)));

const WAITING = new Set(["WAITING_FOR_SELLER_RESPONSE", "WAITING_FOR_BUYER_RESPONSE"]);

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}

function OpenButton({ id, onOpen }: { id: string; onOpen: (id: string) => void }) {
  return (
    <button type="button" className="button button-secondary button-sm" aria-label={`View ${id} in Disputes`} onClick={() => onOpen(id)}>
      View
    </button>
  );
}

// A ruled table. Below 640px each row stacks into labelled fields, so no column is hidden.
function DisputeTable({ disputes, owners, onOpen, caption }: { disputes: Dispute[]; owners?: Map<string, string>; onOpen: (id: string) => void; caption: string }) {
  return (
    <table className="data-table">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Dispute</th>
          {owners && <th scope="col">Account</th>}
          <th scope="col">Reason</th>
          <th scope="col" className="num">
            Amount
          </th>
          <th scope="col">Status</th>
          <th scope="col">
            <span className="sr-only">View</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {disputes.map((d) => (
          <tr key={d.dispute_id}>
            <th scope="row" className="mono" data-label="Dispute">
              {d.dispute_id}
            </th>
            {owners && <td data-label="Account">{owners.get(d.dispute_id) ?? "Owner not listed"}</td>}
            <td data-label="Reason">{labelFor(REASON_LABELS, d.reason)}</td>
            <td data-label="Amount" className="num">
              {formatMoney(d.amount)}
            </td>
            <td data-label="Status">
              <StatusBadge status={d.status} />
            </td>
            <td className="cell-action">
              <OpenButton id={d.dispute_id} onOpen={onOpen} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function AdminOverview({
  accounts,
  disputes,
  health,
  onOpen,
  onStatus,
  onSystem,
}: {
  accounts: AdminAccount[];
  disputes: Dispute[];
  health: Health;
  onOpen: (id: string) => void;
  onStatus: (status: string) => void;
  onSystem: () => void;
}) {
  const summary = summarize(disputes);
  const counts = countByStatus(disputes);
  const owners = ownerNames(accounts);
  const waiting = disputes.filter((d) => WAITING.has(d.status));
  return (
    <div className="admin">
      <section className="summary" aria-label="Platform summary">
        <Stat label="Merchant accounts" value={accounts.filter((a) => a.role === "merchant").length} />
        <Stat label="Buyer accounts" value={accounts.filter((a) => a.role === "buyer").length} />
        <Stat label="Demo disputes" value={summary.total} />
        <Stat label="Unresolved" value={summary.unresolved} />
      </section>

      <div className="admin-grid">
        <section className="panel" aria-labelledby="status-heading">
          <div className="panel-head">
            <h2 id="status-heading">Demo disputes by status</h2>
          </div>
          <ul className="status-counts">
            {STATUS_FILTERS.filter((f) => f !== "ALL").map((f) => (
              <li key={f}>
                <button type="button" className="status-count" onClick={() => onStatus(f)}>
                  <span>{labelFor(STATUS_LABELS, f)}</span>
                  <span className="status-count-value">{counts[f] ?? 0}</span>
                  <span className="sr-only">: show in Disputes</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel" aria-labelledby="config-heading">
          <div className="panel-head">
            <h2 id="config-heading">Configuration</h2>
            <button type="button" className="link-button" onClick={onSystem}>
              System details
            </button>
          </div>
          <ConfigList health={health} brief />
        </section>
      </div>

      <section className="panel" aria-labelledby="waiting-heading">
        <div className="panel-head">
          <h2 id="waiting-heading">Waiting for a response</h2>
          <span className="muted">{waiting.length} demo disputes</span>
        </div>
        {waiting.length > 0 ? (
          <DisputeTable disputes={waiting} owners={owners} onOpen={onOpen} caption="Demo disputes waiting for the seller or the buyer" />
        ) : (
          <p className="empty-inline">No demo disputes are waiting for a response.</p>
        )}
      </section>
    </div>
  );
}

const ROLE_NAMES = { merchant: "Merchant", buyer: "Buyer" } as const;

export function AdminAccounts({
  role,
  accounts,
  disputes,
  onOpen,
}: {
  role: "merchant" | "buyer";
  accounts: AdminAccount[];
  disputes: Dispute[];
  onOpen: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const detail = useRef<HTMLElement>(null);
  const plural = role === "merchant" ? "merchant accounts" : "buyer accounts";
  const ofRole = accounts.filter((a) => a.role === role);
  const q = query.trim().toLowerCase();
  const visible = ofRole.filter((a) => !q || [a.display_name, a.email, a.id].some((s) => s.toLowerCase().includes(q)));
  const selected = visible.find((a) => a.id === selectedId) ?? visible[0];
  const byId = new Map(disputes.map((d) => [d.dispute_id, d]));

  function select(id: string) {
    setSelectedId(id);
    if (window.matchMedia(ONE_COLUMN).matches) detail.current?.focus();
  }

  if (ofRole.length === 0) {
    return (
      <StatePanel title={`No ${plural}`}>
        <p>Accounts are defined in demo-accounts.json.</p>
      </StatePanel>
    );
  }

  return (
    <div className="workspace admin">
      <section className="panel list-panel" aria-labelledby="accounts-heading">
        <div className="panel-head">
          <h2 id="accounts-heading">{role === "merchant" ? "Merchant accounts" : "Buyer accounts"}</h2>
          <span className="muted">{visible.length} shown</span>
        </div>
        <input
          type="search"
          className="search"
          aria-label={`Search ${plural} by name, email or ID`}
          placeholder="Search name, email or ID"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {visible.length > 0 ? (
          <ul className="dispute-list">
            {visible.map((a) => (
              <li key={a.id}>
                <button type="button" className="dispute-row" aria-current={a.id === selected?.id ? "true" : undefined} onClick={() => select(a.id)}>
                  <span className="row-line">
                    <span className="row-name">{a.display_name}</span>
                    <span className="row-amount">
                      {a.dispute_ids.length} {a.dispute_ids.length === 1 ? "dispute" : "disputes"}
                    </span>
                  </span>
                  <span className="muted row-email">{a.email}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-inline">
            <p>No {plural} match “{query.trim()}”.</p>
            <button type="button" className="button button-secondary" onClick={() => setQuery("")}>
              Clear search
            </button>
          </div>
        )}
      </section>

      <section className="panel detail-panel admin-detail" aria-label="Account details" ref={detail} tabIndex={-1}>
        {selected ? (
          <article className="detail" key={selected.id}>
            <header className="detail-head">
              <div>
                <p className="eyebrow">{ROLE_NAMES[role]} account · demo</p>
                <h2>{selected.display_name}</h2>
              </div>
            </header>
            <dl className="facts">
              <div>
                <dt>Email</dt>
                <dd className="wrap">{selected.email}</dd>
              </div>
              <div>
                <dt>Account ID</dt>
                <dd className="mono">{selected.id}</dd>
              </div>
              {role === "merchant" && (
                <div>
                  <dt>PayPal sandbox access</dt>
                  <dd>{selected.paypal_sandbox ? "Yes" : "No"}</dd>
                </div>
              )}
            </dl>
            <section className="detail-section" aria-labelledby="account-disputes-heading">
              <h3 id="account-disputes-heading">Disputes on this account ({selected.dispute_ids.length})</h3>
              {selected.dispute_ids.length === 0 ? (
                <p className="muted">No demo disputes are assigned to this account.</p>
              ) : (
                <>
                  <DisputeTable
                    disputes={selected.dispute_ids.map((id) => byId.get(id)).filter((d): d is Dispute => d !== undefined)}
                    onOpen={onOpen}
                    caption={`Demo disputes on ${selected.display_name}`}
                  />
                  {selected.dispute_ids.some((id) => !byId.has(id)) && (
                    <p className="muted">
                      Not in the demo records: {selected.dispute_ids.filter((id) => !byId.has(id)).join(", ")}.
                    </p>
                  )}
                </>
              )}
            </section>
            <p className="footnote">Read-only. Accounts come from demo-accounts.json, and nothing on this page changes them.</p>
          </article>
        ) : (
          <p className="empty-inline">Select an account to see its details.</p>
        )}
      </section>
    </div>
  );
}

function ConfigList({ health, brief = false }: { health: Health; brief?: boolean }) {
  const time = health.checked_at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return (
    <dl className="config">
      <div>
        <dt>DisputeDesk server</dt>
        <dd>
          Answered at {time}
          {!brief && <span className="config-note">The time this page asked. It is not a continuous check.</span>}
        </dd>
      </div>
      <div>
        <dt>PayPal sandbox</dt>
        <dd>
          {health.paypal_configured ? "Credentials configured" : "Credentials not configured"}
          {!brief && (
            <span className="config-note">Sandbox only. DisputeDesk asks PayPal for a token and reads disputes; it never changes them.</span>
          )}
        </dd>
      </div>
      <div>
        <dt>AI wording (Gemini)</dt>
        <dd>
          {health.ai.on ? (
            <>
              On · <span className="mono">{health.ai.model}</span>
            </>
          ) : (
            "Off"
          )}
          {!health.ai.on && <span className="config-note">{health.ai.reason}</span>}
        </dd>
      </div>
    </dl>
  );
}

export function AdminSystem({ health, onRetry }: { health: Health; onRetry: () => void }) {
  return (
    <div className="admin admin-system">
      <section className="panel" aria-labelledby="system-config-heading">
        <div className="panel-head">
          <h2 id="system-config-heading">Configuration</h2>
          <button type="button" className="button button-secondary" onClick={onRetry}>
            Ask again
          </button>
        </div>
        <p className="muted">
          What the DisputeDesk server reports about its own setup. Asking does not contact PayPal or Gemini, and there is no uptime or
          performance monitoring.
        </p>
        <ConfigList health={health} />
      </section>

      <section className="panel" aria-labelledby="access-heading">
        <div className="panel-head">
          <h2 id="access-heading">How admin access works</h2>
        </div>
        <ul className="steps">
          <li>Admin is read-only: it can't change accounts, disputes, evidence or drafts.</li>
          <li>Admin can't generate AI drafts or AI summaries. Merchants write drafts for their own disputes.</li>
          <li>Every request except sign-in and sign-out needs a session, checked by the server.</li>
          <li>Sign-ins and dispute views are written to an append-only audit log on the server. Audit logs shows the latest entries.</li>
          <li>PayPal is reached only in its sandbox, with read-only requests.</li>
        </ul>
      </section>
    </div>
  );
}

// ---- Audit logs: the server's append-only log, newest first. Read-only. ----

export type AuditEntry = { id: number; at: number; event: string; account_id: string | null; dispute_id: string | null; detail: string | null };

export async function fetchAudit(signal?: AbortSignal): Promise<AuditEntry[]> {
  const response = await fetch("/api/admin/audit", { signal });
  const body = (await response.json().catch(() => null)) as { entries?: unknown } | null;
  if (!response.ok) throw serverError(response, body);
  const ok = (e: Partial<AuditEntry>) => typeof e?.id === "number" && typeof e.at === "number" && typeof e.event === "string";
  if (!Array.isArray(body?.entries) || !body.entries.every(ok)) throw new Error("The DisputeDesk server sent an unexpected response.");
  return body.entries as AuditEntry[];
}

const EVENT_LABELS: Record<string, string> = {
  login_succeeded: "Signed in",
  login_failed: "Sign-in failed",
  login_locked: "Sign-in locked",
  logout: "Signed out",
  dispute_access_denied: "Access refused",
  analysis_viewed: "Evidence checked",
  ai_draft_generated: "AI draft written",
  ai_example_viewed: "Check example viewed",
  buyer_explanation_generated: "Buyer explanation",
  intelligence_viewed: "Insights viewed",
  intelligence_explanation_generated: "Insights summary",
};
// Events worth a second look get the warning tone; everything else is neutral.
const ALERT_EVENTS = new Set(["login_failed", "login_locked", "dispute_access_denied"]);

export function AdminAudit({ entries, accounts, onRetry }: { entries: AuditEntry[]; accounts: AdminAccount[]; onRetry: () => void }) {
  const [event, setEvent] = useState("ALL");
  const [query, setQuery] = useState("");
  const names = new Map(accounts.map((a) => [a.id, a.display_name]));
  const q = query.trim().toLowerCase();
  const visible = entries.filter(
    (e) =>
      (event === "ALL" || e.event === event) &&
      (!q || [e.account_id, e.dispute_id, e.detail, names.get(e.account_id ?? "")].some((s) => s?.toLowerCase().includes(q))),
  );
  const count = (fn: (e: AuditEntry) => boolean) => entries.filter(fn).length;
  const present = [...new Set(entries.map((e) => e.event))];
  const when = (at: number) => new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });

  return (
    <div className="admin">
      <section className="summary" aria-label="Audit summary">
        <Stat label="Entries shown" value={entries.length} />
        <Stat label="Sign-ins" value={count((e) => e.event === "login_succeeded")} />
        <Stat label="Failed or locked sign-ins" value={count((e) => e.event === "login_failed" || e.event === "login_locked")} />
        <Stat label="Access refused" value={count((e) => e.event === "dispute_access_denied")} />
      </section>

      <section className="panel" aria-labelledby="audit-heading">
        <div className="panel-head">
          <h2 id="audit-heading">Latest entries</h2>
          <button type="button" className="button button-secondary" onClick={onRetry}>
            Refresh
          </button>
        </div>
        <div className="toolbar">
          <input
            type="search"
            className="search"
            aria-label="Search audit entries by account, dispute or detail"
            placeholder="Search account, dispute or detail"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <label className="field">
            <span className="field-label">Event</span>
            <select className="select" value={event} onChange={(e) => setEvent(e.target.value)}>
              <option value="ALL">All events</option>
              {present.map((e) => (
                <option key={e} value={e}>
                  {EVENT_LABELS[e] ?? e}
                </option>
              ))}
            </select>
          </label>
        </div>
        {visible.length === 0 ? (
          <p className="empty-inline">{entries.length === 0 ? "No audit entries yet." : "No entries match these filters."}</p>
        ) : (
          <table className="data-table audit-table">
            <caption className="sr-only">Audit log entries, newest first</caption>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Event</th>
                <th scope="col">Account</th>
                <th scope="col">Dispute</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((e) => (
                <tr key={e.id}>
                  <th scope="row" data-label="Time" className="nowrap">
                    <time dateTime={new Date(e.at).toISOString()}>{when(e.at)}</time>
                  </th>
                  <td data-label="Event">
                    <span className={`badge ${ALERT_EVENTS.has(e.event) ? "badge-warn" : "badge-neutral"}`}>{EVENT_LABELS[e.event] ?? e.event}</span>
                  </td>
                  <td data-label="Account">{e.account_id ? (names.get(e.account_id) ?? e.account_id) : <span className="muted">Unknown email</span>}</td>
                  <td data-label="Dispute" className="mono">
                    {e.dispute_id ?? <span className="muted">—</span>}
                  </td>
                  <td data-label="Detail" className="muted">
                    {e.detail ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="footnote">Append-only: the server refuses to change or delete an entry. Entries never hold passwords, tokens or cookies.</p>
      </section>
    </div>
  );
}

// ---- Admin settings: the limits the server runs with. Nothing here can be changed from the browser. ----

export type Settings = {
  session: { idle_minutes: number; absolute_hours: number };
  sign_in: { max_failures: number; max_failures_per_email: number; max_failures_per_address: number; window_minutes: number };
  paypal: { environment: string; configured: boolean; access: string };
  ai: { configured: boolean; model: string | null; reason: string | null };
  audit: { append_only: boolean; shown: number };
};

export async function fetchSettings(signal?: AbortSignal): Promise<Settings> {
  const response = await fetch("/api/admin/settings", { signal });
  const body = (await response.json().catch(() => null)) as Partial<Settings> | null;
  if (!response.ok) throw serverError(response, body);
  if (typeof body?.session?.idle_minutes !== "number" || typeof body.sign_in?.max_failures !== "number" || !body.paypal || !body.ai || !body.audit) {
    throw new Error("The DisputeDesk server sent an unexpected response.");
  }
  return body as Settings;
}

function SettingsGroup({ id, title, note, rows }: { id: string; title: string; note: string; rows: [string, ReactNode][] }) {
  return (
    <section className="panel settings-group" aria-labelledby={id}>
      <div className="panel-head">
        <h2 id={id}>{title}</h2>
        <span className="badge badge-neutral">Read-only</span>
      </div>
      <p className="muted">{note}</p>
      <dl className="config">
        {rows.map(([term, value]) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function AdminSettings({ settings }: { settings: Settings }) {
  const s = settings;
  return (
    <div className="admin settings-grid">
      <SettingsGroup
        id="set-session"
        title="Sessions"
        note="Sessions live in the server's database. Only a hash of each session token is stored."
        rows={[
          ["Signed out after inactivity", `${s.session.idle_minutes} minutes`],
          ["Longest session", `${s.session.absolute_hours} hours`],
          ["Cookie", "HttpOnly, Secure, SameSite=Strict"],
        ]}
      />
      <SettingsGroup
        id="set-signin"
        title="Sign-in limit"
        note="Repeated failed sign-ins are refused for a while, by account and by address."
        rows={[
          ["Failures per account from one address", `${s.sign_in.max_failures} in ${s.sign_in.window_minutes} minutes`],
          ["Failures per account from all addresses", `${s.sign_in.max_failures_per_email} in ${s.sign_in.window_minutes} minutes`],
          ["Failures per address", `${s.sign_in.max_failures_per_address} in ${s.sign_in.window_minutes} minutes`],
          ["Passwords", "Stored as scrypt hashes only"],
        ]}
      />
      <SettingsGroup
        id="set-paypal"
        title="PayPal"
        note="DisputeDesk asks PayPal for a token and reads disputes. It never creates or changes one."
        rows={[
          ["Environment", s.paypal.environment === "sandbox" ? "Sandbox" : s.paypal.environment],
          ["Credentials", s.paypal.configured ? "Configured on the server" : "Not configured"],
          ["Access", s.paypal.access === "read-only" ? "Read-only" : s.paypal.access],
        ]}
      />
      <SettingsGroup
        id="set-ai"
        title="AI wording"
        note="Gemini only words explanations and drafts. The server checks every line against the records."
        rows={[
          ["Status", s.ai.configured ? "On" : "Off"],
          s.ai.configured ? ["Model", <span className="mono">{s.ai.model}</span>] : ["Why it is off", s.ai.reason ?? "Not configured"],
          ["Admin drafts", "Not allowed: admin is read-only"],
        ]}
      />
      <SettingsGroup
        id="set-audit"
        title="Audit log"
        note="Every sign-in, sign-out, refused access and dispute check is written to the log."
        rows={[
          ["Changes and deletions", s.audit.append_only ? "Refused by the database" : "Allowed"],
          ["Shown in Audit logs", `Latest ${s.audit.shown} entries`],
        ]}
      />
      <p className="footnote settings-foot">These values are set in the server's code and environment. Change them there; this page only reads them.</p>
    </div>
  );
}
