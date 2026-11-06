import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Activity, BarChart3, FileText, LayoutDashboard, ScrollText, Settings2, ShieldCheck, Store, UserRound, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AccountView } from "./Account.tsx";
import { AdminAccounts, AdminAudit, AdminOverview, AdminSettings, AdminSystem, Loaded, fetchAdminAccounts, fetchAudit, fetchHealth, fetchSettings, ownerNames, useLoad } from "./Admin.tsx";
import { BuyerDisputes } from "./Buyer.tsx";
import type { BuyerLoad } from "./Buyer.tsx";
import { DisputeDetail } from "./DisputeDetail.tsx";
import { Insights } from "./Intelligence.tsx";
import { DisputeList } from "./DisputeList.tsx";
import { Landing } from "./Landing.tsx";
import { Login } from "./Login.tsx";
import { fetchMe, signOut } from "./auth.ts";
import {
  REASON_LABELS,
  STATUS_FILTERS,
  STATUS_LABELS,
  countByStatus,
  filterByStatus,
  formatMoney,
  labelFor,
  summarize,
} from "../../shared/disputes.ts";
import { SIGNED_OUT_EVENT, fetchBuyerDisputes, fetchDemoDisputes, fetchDemoListing, fetchSandboxDisputes } from "./sandbox.ts";
import type { Readiness } from "../../shared/readiness.ts";
import type { AccountInfo, Dispute, Role, Source } from "../../shared/types.ts";
import { ONE_COLUMN, StatePanel } from "./ui.tsx";

export type SandboxLoad =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; disputes: Dispute[]; readiness?: Record<string, Readiness> };

const SOURCES: { id: Source; label: string }[] = [
  { id: "demo", label: "Demo data" },
  { id: "paypal_sandbox", label: "PayPal sandbox" },
];

const ROLE_LABELS: Record<Role, string> = { merchant: "Merchant", buyer: "Buyer", admin: "Admin (read-only)" };

type View = "overview" | "disputes" | "merchants" | "buyers" | "insights" | "audit" | "system" | "settings" | "account";
const VIEW_LABELS: Record<View, string> = {
  overview: "Overview",
  disputes: "Disputes",
  merchants: "Merchants",
  buyers: "Buyers",
  insights: "Insights",
  audit: "Audit logs",
  system: "System health",
  settings: "Admin settings",
  account: "Account",
};
const VIEW_ICONS: Record<View, LucideIcon> = {
  overview: LayoutDashboard,
  disputes: FileText,
  merchants: Store,
  buyers: Users,
  insights: BarChart3,
  audit: ScrollText,
  system: Activity,
  settings: Settings2,
  account: UserRound,
};
// One line under each page title: what the page is for, in plain words.
const VIEW_LEADS: Record<View, string> = {
  overview: "Every demo account and dispute at a glance. Read-only.",
  disputes: "Each dispute, its evidence checked by fixed rules, and a draft only you can send.",
  merchants: "Merchant accounts and the disputes each one can reach.",
  buyers: "Buyer accounts and the disputes each one can follow.",
  insights: "Patterns across the evidence checks: counts and dispute IDs only.",
  audit: "What the server recorded: sign-ins, refused access and dispute checks.",
  system: "What the server reports about its own setup.",
  settings: "The limits this server runs with. Set in code, shown here read-only.",
  account: "Who is signed in and what this account can do.",
};
const ADMIN_DISPUTES_LEAD = "Every demo dispute and its evidence checks, across all accounts. Read-only.";
const BUYER_LEADS = { disputes: "Where each of your disputes stands, in plain words.", account: VIEW_LEADS.account };
// The rail groups views by what they are about.
const ADMIN_GROUPS: [string, View[]][] = [
  ["Workspace", ["overview", "disputes", "insights"]],
  ["People", ["merchants", "buyers"]],
  ["Oversight", ["audit", "system", "settings"]],
  ["You", ["account"]],
];
const MERCHANT_GROUPS: [string, View[]][] = [
  ["Workspace", ["disputes", "insights"]],
  ["You", ["account"]],
];

function NavButton({ v, view, onView }: { v: View; view: string; onView: (v: View) => void }) {
  const Icon = VIEW_ICONS[v];
  return (
    <button type="button" aria-pressed={view === v} onClick={() => onView(v)}>
      <Icon aria-hidden="true" className="nav-icon" />
      {VIEW_LABELS[v]}
    </button>
  );
}

function PageHead({ title, lead, eyebrow }: { title: string; lead: string; eyebrow: string }) {
  return (
    <header className="page-head">
      <p className="page-eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p className="page-lead">{lead}</p>
    </header>
  );
}


const accountBanner = (
  <div className="banner banner-demo" role="note">
    <strong>DEMO ACCOUNT — SYNTHETIC</strong>
    <span>A demo account from demo-accounts.json. It is not a real person or a PayPal account.</span>
  </div>
);

// Signed-out, checking and signed-in states. Who is signed in always comes from the server.
export default function App() {
  const [account, setAccount] = useState<AccountInfo | null | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchMe(controller.signal)
      .then(setAccount)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setNotice(error instanceof Error ? error.message : String(error));
        setAccount(null);
      });
    const onSignedOut = () => {
      setNotice("Your session has ended. Sign in again to continue.");
      setAccount(null);
    };
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut);
    return () => {
      controller.abort();
      window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut);
    };
  }, []);

  async function handleSignOut() {
    await signOut().catch(() => {});
    setNotice("You are signed out.");
    setAccount(null);
  }

  if (account === undefined) {
    return (
      <Shell>
        <StatePanel title="Checking your session…" busy />
      </Shell>
    );
  }
  if (account === null) {
    // A fresh visit gets the landing page; a sign-in click, a sign-out or a session problem gets the form.
    if (!signInOpen && !notice) return <Landing onSignIn={() => setSignInOpen(true)} />;
    return (
      <Shell
        bar={
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              setNotice(null);
              setSignInOpen(false);
            }}
          >
            Back to overview
          </button>
        }
      >
        <Login
          notice={notice}
          onSignedIn={(signedIn) => {
            setNotice(null);
            setAccount(signedIn);
          }}
        />
      </Shell>
    );
  }
  return account.role === "buyer" ? (
    <BuyerHome account={account} onSignOut={handleSignOut} />
  ) : (
    <Dashboard account={account} onSignOut={handleSignOut} />
  );
}

const brand = (
  <div className="brand">
    <span className="brand-mark" aria-hidden="true">
      DD
    </span>
    <span className="brand-name">DisputeDesk</span>
  </div>
);

// Signed in: a rail (a top bar below 1024px) beside the page. Signed out or checking: a plain top bar.
function Shell({ children, bar, rail }: { children: ReactNode; bar?: ReactNode; rail?: ReactNode }) {
  if (rail) {
    return (
      <div className="shell">
        <header className="rail">
          {brand}
          {rail}
        </header>
        <div className="app-main">{children}</div>
      </div>
    );
  }
  return (
    <div className="app">
      <header className="topbar">
        {brand}
        {bar}
      </header>
      {children}
    </div>
  );
}

function AccountBar({ account, onSignOut, children }: { account: AccountInfo; onSignOut: () => void; children?: ReactNode }) {
  return (
    <div className="topbar-actions">
      {children}
      <div className="account-bar">
        <span className="account-name">{account.display_name}</span>
        <span className="badge badge-neutral">{ROLE_LABELS[account.role]}</span>
        <button type="button" className="button button-secondary" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}

// Merchants and admin. Admin sees every demo dispute and the sandbox, read-only.
export function Dashboard({ account, onSignOut, initialView }: { account: AccountInfo; onSignOut: () => void; initialView?: View }) {
  const isAdmin = account.role === "admin";
  const sources = SOURCES.filter((s) => s.id === "demo" || account.role === "admin" || account.paypal_sandbox);
  const [source, setSource] = useState<Source>("demo");
  const [load, setLoad] = useState<SandboxLoad>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<View>(initialView ?? (isAdmin ? "overview" : "disputes"));
  // Admin only: accounts, the demo records and the server's configuration, for the admin views and the account filter.
  const [accounts, retryAccounts] = useLoad(fetchAdminAccounts, isAdmin);
  const [demo, retryDemo] = useLoad(fetchDemoDisputes, isAdmin);
  const [health, retryHealth] = useLoad(fetchHealth, isAdmin);
  // Loaded only when their view is open, so the audit log is read fresh each time.
  const [auditLog, retryAudit] = useLoad(fetchAudit, isAdmin && view === "audit");
  const [settings, retrySettings] = useLoad(fetchSettings, isAdmin && view === "settings");
  const owners = isAdmin && source === "demo" && accounts.status === "ready" ? ownerNames(accounts.value) : undefined;

  // Opens the Disputes view on the demo records, at one dispute or one status.
  function showDisputes(selected: string | null, status = "ALL") {
    setSource("demo");
    setFilter(status);
    setSelectedId(selected);
    setView("disputes");
  }

  useEffect(() => {
    const controller = new AbortController();
    setLoad({ status: "loading" });
    (source === "demo" ? fetchDemoListing(controller.signal) : fetchSandboxDisputes(controller.signal).then((disputes) => ({ disputes })))
      .then((listing) => setLoad({ status: "ready", ...listing }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({ status: "error", message: error instanceof Error ? error.message : String(error) });
      });
    return () => controller.abort();
  }, [source, attempt]);

  const rail = (
    <>
      <nav className="rail-group rail-views" aria-label="Views">
        {(isAdmin ? ADMIN_GROUPS : MERCHANT_GROUPS).map(([group, views]) => (
          <div key={group} className="rail-section">
            <span className="rail-label" aria-hidden="true">
              {group}
            </span>
            <div className="rail-nav">
              {views.map((v) => (
                <NavButton key={v} v={v} view={view} onView={(next) => { setView(next); window.scrollTo({ top: 0 }); }} />
              ))}
            </div>
          </div>
        ))}
      </nav>
      {isAdmin && (
        <p className="rail-note">
          <ShieldCheck aria-hidden="true" className="nav-icon" /> Read-only access
        </p>
      )}
      {sources.length > 1 && view === "disputes" && (
        <div className="rail-group">
          <span className="rail-label" aria-hidden="true">
            Data source
          </span>
          <div className="segmented" role="group" aria-label="Data source">
            {sources.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={source === s.id}
                onClick={() => {
                  setSource(s.id);
                  setSelectedId(null);
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <AccountBar account={account} onSignOut={onSignOut} />
    </>
  );

  return (
    <Shell rail={rail}>
      {view === "system" || view === "settings" ? null : view === "audit" ? (
        <div className="banner banner-demo" role="note">
          <strong>SERVER AUDIT LOG — DEMO ACCOUNTS</strong>
          <span>Entries the DisputeDesk server wrote for the synthetic demo accounts. Read-only: entries cannot be changed or deleted.</span>
        </div>
      ) : view === "account" ? (
        accountBanner
      ) : view === "overview" || view === "merchants" || view === "buyers" ? (
        <div className="banner banner-demo" role="note">
          <strong>DEMO DATA — NOT REAL ACCOUNTS OR PAYPAL DISPUTES</strong>
          <span>
            Synthetic accounts from demo-accounts.json and the synthetic demo disputes. PayPal sandbox disputes are not included, and
            nothing here is connected to PayPal.
          </span>
        </div>
      ) : view === "insights" ? (
        <div className="banner banner-demo" role="note">
          <strong>DEMO DATA — NOT A REAL PAYPAL DISPUTE</strong>
          <span>
            Insights use only the synthetic demo disputes {account.role === "admin" ? "of every demo merchant" : "on this account"}. PayPal
            sandbox disputes are not included, and nothing here is connected to PayPal.
          </span>
        </div>
      ) : source === "demo" ? (
        <div className="banner banner-demo" role="note">
          <strong>DEMO DATA — NOT A REAL PAYPAL DISPUTE</strong>
          <span>
            Synthetic examples from sample-dispute.json and demo-disputes.json, limited to this account. Nothing here is
            connected to PayPal.
          </span>
        </div>
      ) : (
        <div className="banner banner-sandbox" role="note">
          <strong>PAYPAL SANDBOX</strong>
          <span>Test environment only. No live payments or real customers.</span>
        </div>
      )}

      <main className="main" key={view}>
        <PageHead title={VIEW_LABELS[view]} lead={isAdmin && view === "disputes" ? ADMIN_DISPUTES_LEAD : VIEW_LEADS[view]} eyebrow={isAdmin ? "Admin · read-only" : "Merchant workspace"} />
        {view === "account" ? (
          <AccountView account={account} onSignOut={onSignOut} />
        ) : view === "overview" ? (
          <Loaded loads={[accounts, demo, health]} onRetry={() => (retryAccounts(), retryDemo(), retryHealth())} what="the overview">
            {() =>
              accounts.status === "ready" &&
              demo.status === "ready" &&
              health.status === "ready" && (
                <AdminOverview
                  accounts={accounts.value}
                  disputes={demo.value}
                  health={health.value}
                  onOpen={(id) => showDisputes(id)}
                  onStatus={(status) => showDisputes(null, status)}
                  onSystem={() => setView("system")}
                />
              )
            }
          </Loaded>
        ) : view === "merchants" || view === "buyers" ? (
          <Loaded loads={[accounts, demo]} onRetry={() => (retryAccounts(), retryDemo())} what="accounts">
            {() =>
              accounts.status === "ready" &&
              demo.status === "ready" && (
                <AdminAccounts
                  key={view}
                  role={view === "merchants" ? "merchant" : "buyer"}
                  accounts={accounts.value}
                  disputes={demo.value}
                  onOpen={(id) => showDisputes(id)}
                />
              )
            }
          </Loaded>
        ) : view === "audit" ? (
          <Loaded loads={[auditLog, accounts]} onRetry={() => (retryAudit(), retryAccounts())} what="the audit log">
            {() => auditLog.status === "ready" && accounts.status === "ready" && <AdminAudit entries={auditLog.value} accounts={accounts.value} onRetry={retryAudit} />}
          </Loaded>
        ) : view === "settings" ? (
          <Loaded loads={[settings]} onRetry={retrySettings} what="the server settings">
            {() => settings.status === "ready" && <AdminSettings settings={settings.value} />}
          </Loaded>
        ) : view === "system" ? (
          <Loaded loads={[health]} onRetry={retryHealth} what="the system configuration">
            {() => health.status === "ready" && <AdminSystem health={health.value} onRetry={retryHealth} />}
          </Loaded>
        ) : view === "insights" ? (
          <Insights canExplain={account.role === "merchant"} />
        ) : (
          <DisputesView
            source={source}
            disputes={load.status === "ready" ? load.disputes : null}
            sandbox={load}
            onRetry={() => setAttempt((n) => n + 1)}
            filter={filter}
            onFilter={setFilter}
            selectedId={selectedId}
            onSelect={setSelectedId}
            canDraft={account.role === "merchant"}
            owners={owners}
            readiness={load.status === "ready" ? load.readiness : undefined}
          />
        )}
      </main>
    </Shell>
  );
}

const LIST_TEXT: Record<Source, { loading: string; error: string; where: string; empty: string; emptyHint: string }> = {
  paypal_sandbox: {
    loading: "Loading PayPal sandbox disputes…",
    error: "Couldn't load PayPal sandbox disputes",
    where: "The sandbox is reached through the DisputeDesk server, which holds the PayPal credentials.",
    empty: "No disputes in the PayPal sandbox",
    emptyHint: "Sandbox disputes appear here after a sandbox buyer account opens one.",
  },
  demo: {
    loading: "Loading demo disputes…",
    error: "Couldn't load demo disputes",
    where: "Demo disputes are served by the DisputeDesk server for the signed-in account.",
    empty: "No demo disputes on this account",
    emptyHint: "Demo disputes are assigned to accounts in demo-accounts.json.",
  },
};

// Loading, error and empty states for a list, else the list and the selected dispute.
export function DisputesView({
  disputes,
  sandbox,
  onRetry,
  source = "paypal_sandbox",
  ...workspace
}: {
  disputes: Dispute[] | null;
  sandbox: SandboxLoad;
  onRetry: () => void;
  source?: Source;
  filter: string;
  onFilter: (status: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  canDraft?: boolean;
  owners?: Map<string, string>;
  readiness?: Record<string, Readiness>;
}) {
  const t = LIST_TEXT[source];
  return disputes === null ? (
    sandbox.status === "error" ? (
      <StatePanel title={t.error} tone="error">
        <p>{sandbox.message}</p>
        <p className="muted">{t.where}</p>
        <button type="button" className="button" onClick={onRetry}>
          Try again
        </button>
      </StatePanel>
    ) : (
      <StatePanel title={t.loading} busy />
    )
  ) : disputes.length === 0 ? (
    <StatePanel title={t.empty}>
      <p>{t.emptyHint}</p>
      <button type="button" className="button" onClick={onRetry}>
        Refresh
      </button>
    </StatePanel>
  ) : (
    <Workspace disputes={disputes} {...workspace} />
  );
}

export function Workspace({
  disputes,
  filter,
  onFilter,
  selectedId,
  onSelect,
  canDraft = true,
  owners,
  readiness,
}: {
  disputes: Dispute[];
  filter: string;
  onFilter: (status: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  canDraft?: boolean;
  // Admin, demo data only: dispute ID to the merchant account it belongs to.
  owners?: Map<string, string>;
  // Demo data only: the rules' evidence counts per dispute ID.
  readiness?: Record<string, Readiness>;
}) {
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState("ALL");
  const summary = summarize(disputes);
  const counts = countByStatus(disputes);
  // Search only narrows what is already loaded: dispute ID, reason label or reason code.
  const q = query.trim().toLowerCase();
  const visible = filterByStatus(disputes, filter).filter(
    (d) =>
      (!owners || owner === "ALL" || owners.get(d.dispute_id) === owner) &&
      (!q || [d.dispute_id, d.reason, labelFor(REASON_LABELS, d.reason)].some((s) => s.toLowerCase().includes(q))),
  );
  const selected = visible.find((d) => d.dispute_id === selectedId) ?? visible[0];
  const detail = useRef<HTMLElement>(null);

  function select(id: string) {
    onSelect(id);
    // On one-column layouts the details sit below the list; take the merchant there.
    if (window.matchMedia(ONE_COLUMN).matches) detail.current?.focus();
  }

  return (
    <>
      <section className="summary" aria-label="Summary">
        <Stat label="Total disputes" value={summary.total} />
        <Stat label="Unresolved" value={summary.unresolved} />
        <Stat label="Amount in dispute" value={summary.amounts.map(formatMoney).join(" · ") || "—"} />
      </section>

      <div className="workspace">
        <section className="panel list-panel" aria-labelledby="list-heading">
          <div className="panel-head">
            <h2 id="list-heading">Dispute list</h2>
            <span className="muted">{visible.length} shown</span>
          </div>
          <input
            type="search"
            className="search"
            aria-label="Search disputes by ID or reason"
            placeholder="Search ID or reason"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {owners && (
            <label className="field">
              <span className="field-label">Account</span>
              <select className="select" value={owner} onChange={(e) => setOwner(e.target.value)}>
                <option value="ALL">All accounts</option>
                {[...new Set(owners.values())].map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="filters" role="group" aria-label="Filter by status">
            {STATUS_FILTERS.map((f) => (
              <button key={f} type="button" className="chip" aria-pressed={filter === f} onClick={() => onFilter(f)}>
                {f === "ALL" ? "All" : labelFor(STATUS_LABELS, f)}
                <span className="chip-count">{counts[f] ?? 0}</span>
              </button>
            ))}
          </div>
          {visible.length > 0 ? (
            <DisputeList disputes={visible} selectedId={selected?.dispute_id} onSelect={select} owners={owners} readiness={readiness} />
          ) : q ? (
            <div className="empty-inline">
              <p>No disputes match “{query.trim()}”.</p>
              <button type="button" className="button button-secondary" onClick={() => setQuery("")}>
                Clear search
              </button>
            </div>
          ) : (
            <p className="empty-inline">No disputes with this status.</p>
          )}
        </section>

        <section className="panel detail-panel" aria-label="Dispute details" ref={detail} tabIndex={-1}>
          {selected ? (
            <DisputeDetail key={selected.dispute_id} dispute={selected} canDraft={canDraft} />
          ) : (
            <p className="empty-inline">Select a dispute to see its details.</p>
          )}
        </section>
      </div>
    </>
  );
}

// Buyers see the status of their own disputes only, without the merchant's records.
export function BuyerHome({
  account,
  onSignOut,
  initialView = "disputes",
}: {
  account: AccountInfo;
  onSignOut: () => void;
  initialView?: "disputes" | "account";
}) {
  const [view, setView] = useState<"disputes" | "account">(initialView);
  const [load, setLoad] = useState<BuyerLoad>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoad({ status: "loading" });
    fetchBuyerDisputes(controller.signal)
      .then((disputes) => setLoad({ status: "ready", disputes }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({ status: "error", message: error instanceof Error ? error.message : String(error) });
      });
    return () => controller.abort();
  }, [attempt]);

  return (
    <Shell
      rail={
        <>
          <nav className="rail-group" aria-label="Views">
            <div className="rail-nav">
              {(["disputes", "account"] as const).map((v) => (
                <NavButton key={v} v={v} view={view} onView={(next) => { setView(next as "disputes" | "account"); window.scrollTo({ top: 0 }); }} />
              ))}
            </div>
          </nav>
          <AccountBar account={account} onSignOut={onSignOut} />
        </>
      }
    >
      {view === "account" ? (
        accountBanner
      ) : (
        <div className="banner banner-demo" role="note">
          <strong>DEMO DATA — NOT A REAL PAYPAL DISPUTE</strong>
          <span>Synthetic disputes on this demo buyer account. Nothing here is connected to PayPal.</span>
        </div>
      )}
      <main className="main" key={view}>
        <PageHead title={VIEW_LABELS[view]} lead={BUYER_LEADS[view]} eyebrow="Buyer" />
        {view === "account" ? (
          <AccountView account={account} onSignOut={onSignOut} />
        ) : (
          <BuyerDisputes load={load} onRetry={() => setAttempt((n) => n + 1)} />
        )}
      </main>
    </Shell>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}
