import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { BuyerDisputes } from "./Buyer.tsx";
import type { BuyerLoad } from "./Buyer.tsx";
import { DisputeDetail } from "./DisputeDetail.tsx";
import { DisputeList } from "./DisputeList.tsx";
import { Login } from "./Login.tsx";
import { fetchMe, signOut } from "./auth.ts";
import {
  STATUS_FILTERS,
  STATUS_LABELS,
  countByStatus,
  filterByStatus,
  formatMoney,
  labelFor,
  summarize,
} from "../../shared/disputes.ts";
import { SIGNED_OUT_EVENT, fetchBuyerDisputes, fetchDemoDisputes, fetchSandboxDisputes } from "./sandbox.ts";
import type { AccountInfo, Dispute, Role, Source } from "../../shared/types.ts";
import { StatePanel } from "./ui.tsx";

export type SandboxLoad =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; disputes: Dispute[] };

const SOURCES: { id: Source; label: string }[] = [
  { id: "demo", label: "Demo data" },
  { id: "paypal_sandbox", label: "PayPal sandbox" },
];

const ROLE_LABELS: Record<Role, string> = { merchant: "Merchant", buyer: "Buyer", admin: "Admin (read-only)" };

// Signed-out, checking and signed-in states. Who is signed in always comes from the server.
export default function App() {
  const [account, setAccount] = useState<AccountInfo | null | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);

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
    return (
      <Shell>
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

function Shell({ children, bar }: { children: ReactNode; bar?: ReactNode }) {
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            DD
          </span>
          <span className="brand-name">DisputeDesk</span>
        </div>
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
export function Dashboard({ account, onSignOut }: { account: AccountInfo; onSignOut: () => void }) {
  const sources = SOURCES.filter((s) => s.id === "demo" || account.role === "admin" || account.paypal_sandbox);
  const [source, setSource] = useState<Source>("demo");
  const [load, setLoad] = useState<SandboxLoad>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoad({ status: "loading" });
    (source === "demo" ? fetchDemoDisputes : fetchSandboxDisputes)(controller.signal)
      .then((disputes) => setLoad({ status: "ready", disputes }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({ status: "error", message: error instanceof Error ? error.message : String(error) });
      });
    return () => controller.abort();
  }, [source, attempt]);

  const bar = (
    <AccountBar account={account} onSignOut={onSignOut}>
      {sources.length > 1 && (
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
      )}
    </AccountBar>
  );

  return (
    <Shell bar={bar}>
      {source === "demo" ? (
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

      <main className="main">
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
        />
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
}: {
  disputes: Dispute[];
  filter: string;
  onFilter: (status: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  canDraft?: boolean;
}) {
  const summary = summarize(disputes);
  const counts = countByStatus(disputes);
  const visible = filterByStatus(disputes, filter);
  const selected = visible.find((d) => d.dispute_id === selectedId) ?? visible[0];
  const detail = useRef<HTMLElement>(null);

  function select(id: string) {
    onSelect(id);
    // On one-column layouts the details sit below the list; take the merchant there.
    if (window.matchMedia("(max-width: 899px)").matches) detail.current?.focus();
  }

  return (
    <>
      <section className="summary" aria-label="Summary">
        <Stat label="Total disputes" value={summary.total} />
        <Stat label="Unresolved" value={summary.unresolved} />
        <Stat label="Amount in dispute" value={summary.amounts.map(formatMoney).join(" · ") || "—"} />      </section>

      <div className="workspace">
        <section className="panel" aria-labelledby="list-heading">
          <div className="panel-head">
            <h2 id="list-heading">Disputes</h2>
            <span className="muted">{visible.length} shown</span>
          </div>
          <div className="filters" role="group" aria-label="Filter by status">
            {STATUS_FILTERS.map((f) => (
              <button key={f} type="button" className="chip" aria-pressed={filter === f} onClick={() => onFilter(f)}>
                {f === "ALL" ? "All" : labelFor(STATUS_LABELS, f)}
                <span className="chip-count">{counts[f] ?? 0}</span>
              </button>
            ))}
          </div>
          {visible.length > 0 ? (
            <DisputeList disputes={visible} selectedId={selected?.dispute_id} onSelect={select} />
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
export function BuyerHome({ account, onSignOut }: { account: AccountInfo; onSignOut: () => void }) {
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
    <Shell bar={<AccountBar account={account} onSignOut={onSignOut} />}>
      <div className="banner banner-demo" role="note">
        <strong>DEMO DATA — NOT A REAL PAYPAL DISPUTE</strong>
        <span>Synthetic disputes on this demo buyer account. Nothing here is connected to PayPal.</span>
      </div>
      <main className="main">
        <BuyerDisputes load={load} onRetry={() => setAttempt((n) => n + 1)} />
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
