import { useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { ArrowDown, Ban, Check, CircleDashed, EyeOff, FileSearch, Lock, Menu, MessageSquare, ScanLine, ShieldCheck, Sparkles, TriangleAlert, Truck, UserCheck, X } from "lucide-react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { REASON_LABELS } from "../../shared/disputes.ts";

gsap.registerPlugin(useGSAP, ScrollTrigger);

// Signed-out landing page. Static copy only: it fetches nothing and holds no demo records (those reach the browser
// only through the server, after sign-in). Every product fragment here is illustrative and labelled so.
//
// The page's one object is a pane of smoked glass with a single example dispute etched into it. The merchant reads
// one side, the buyer the other: the reason, status and stage are the same lines on both, and merchant-only evidence
// is frosted on the buyer's side. GSAP turns the pane (a button in the hero, the scroll in "How it works"). All
// animation is added by script from a fully visible default, so the page reads the same without it, and GSAP only
// writes styles through the CSSOM, which the strict CSP allows.

type Side = "merchant" | "buyer";
type Kind = "present" | "missing" | "cracked";

// The four evidence items the engine checks on every dispute, with the engine's own status words.
const EVIDENCE: { label: string; kind: Kind; word: string; note: string }[] = [
  { label: "Order confirmation", kind: "present", word: "Available", note: "On record." },
  { label: "Shipping tracking", kind: "cracked", word: "Unverified", note: "Another record disagrees with it." },
  { label: "Proof of delivery", kind: "missing", word: "Missing", note: "Not on record. That alone doesn’t show it didn’t happen." },
  { label: "Customer communication", kind: "present", word: "Available", note: "On record." },
];

// The lines both sides read, word for word.
const FACTS: [string, string][] = [
  ["Reason", "Item not received"],
  ["Status", "Awaiting seller"],
  ["Stage", "2 of 4 · Seller and buyer respond"],
  ["Decided by", "A person, never automatically"],
];

const STAGES = ["Opened", "Seller and buyer respond", "Payment provider review", "Closed"];

const LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#roles", label: "Who it’s for" },
  { href: "#engine", label: "Under the hood" },
  { href: "#safeguards", label: "Safeguards" },
  { href: "#faq", label: "Questions" },
];

const REDUCED = "(prefers-reduced-motion: reduce)";
const reduced = () => typeof window !== "undefined" && window.matchMedia(REDUCED).matches;

// The opening plays on every load, never for reduced motion.
const shouldIntro = () => typeof window !== "undefined" && !reduced();

// The opening reel (reports/intro-reel): decorative, so assistive tech skips straight to the page under it.
// Any click or key skips it; it also ends early if the video can't load or play.
function Intro({ onSkip }: { onSkip: () => void }) {
  return (
    <div className="intro" aria-hidden="true" onClick={onSkip}>
      <video className="intro-video" src="/intro.mp4" muted autoPlay playsInline preload="auto" onEnded={onSkip} onError={onSkip} />
      <button type="button" tabIndex={-1} className="intro-skip">
        Skip intro
      </button>
    </div>
  );
}

const MARK_ICON = { present: Check, missing: CircleDashed, cracked: TriangleAlert };

// One etched line of evidence: present is etched solid, missing is a dashed outline, a contradiction is cracked.
function Mark({ item }: { item: (typeof EVIDENCE)[number] }) {
  const Icon = MARK_ICON[item.kind];
  return (
    <li data-etch className={cn("gl-mark", `gl-mark-${item.kind}`)}>
      {item.kind === "cracked" && (
        <svg className="crack" viewBox="0 0 200 40" preserveAspectRatio="xMaxYMin meet" aria-hidden="true">
          <path pathLength={1} d="M112 0 L126 8 L121 14 L141 20 L136 27 L160 31 L200 40" />
        </svg>
      )}
      <p className="text-sm text-muted-foreground">{item.label}</p>
      <p className="mark-word mt-1 flex items-center gap-1.5 font-medium">
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        {item.word}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{item.note}</p>
    </li>
  );
}

function Facts() {
  return (
    <dl className="gl-facts">
      {FACTS.map(([term, value]) => (
        <div key={term} data-etch>
          <dt className="text-sm text-muted-foreground">{term}</dt>
          <dd className="etch mt-0.5 font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Face({ side, shown, children }: { side: Side; shown: boolean; children: ReactNode }) {
  return (
    <div className={cn("pane-face glass", side === "buyer" && "pane-back")} data-side={side} aria-hidden={!shown} inert={!shown}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4 md:px-7">
        <div className="min-w-0">
          <p className="etch text-lg font-semibold tracking-tight md:text-xl">Item not received</p>
          <p className="text-sm text-muted-foreground">Example dispute · synthetic record</p>
        </div>
        <p className="side-tag">{side === "merchant" ? "Merchant’s side" : "Buyer’s side"}</p>
      </div>
      <Facts />
      {children}
      <p className="border-t px-5 py-3 text-sm text-muted-foreground md:px-7">Illustrative example. Not a real dispute.</p>
    </div>
  );
}

function MerchantBody() {
  return (
    <div className="px-5 pb-5 md:px-7">
      <ul className="gl-marks">
        {EVIDENCE.map((e) => (
          <Mark key={e.label} item={e} />
        ))}
      </ul>
      <p data-etch className="etch mt-4 text-sm">
        Next step: add proof of delivery from a carrier record, if you have one.
      </p>
    </div>
  );
}

function BuyerBody() {
  return (
    <div className="px-5 pb-5 md:px-7">
      <ol className="gl-stages">
        {STAGES.map((stage, i) => (
          <li key={stage} data-etch aria-current={i === 1 ? "step" : undefined}>
            <span className="text-sm text-muted-foreground">Stage {i + 1}</span>
            <span className="block font-medium">{stage}</span>
          </li>
        ))}
      </ol>
      {/* The merchant's evidence slots, frosted over: present on the glass, unreadable from this side. No text. */}
      <ul aria-hidden="true" className="gl-marks mt-4">
        {EVIDENCE.map((e) => (
          <li key={e.label} className="frost-slot">
            <span />
            <span />
            <span />
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Merchant evidence and drafts:</span> not shown to buyers.
      </p>
    </div>
  );
}

// The glass pane: both readings of one record, back to back. `face` decides which side is readable.
function Pane({ label, face, turnRef, className }: { label: string; face: Side; turnRef: RefObject<HTMLDivElement | null>; className?: string }) {
  return (
    <figure data-ui aria-label={label} className={cn("pane-stage", className)}>
      {/* The tilt layer leans toward the pointer; the turn layer inside it flips between the two sides. */}
      <div className="pane-tilt">
        <div ref={turnRef} className="pane-turn">
          <Face side="merchant" shown={face === "merchant"}>
            <MerchantBody />
          </Face>
          <Face side="buyer" shown={face === "buyer"}>
            <BuyerBody />
          </Face>
        </div>
      </div>
    </figure>
  );
}

// A smaller glass plate for the other product fragments.
function Plate({ label, title, sub, children, className }: { label: string; title: string; sub?: string; children: ReactNode; className?: string }) {
  return (
    <figure data-ui aria-label={label} className={cn("plate glass", className)}>
      <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <p className="etch truncate text-sm font-semibold">{title}</p>
          {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
        </div>
        <span className="shrink-0 rounded-md border px-2 py-0.5 text-xs text-muted-foreground">Illustrative example</span>
      </div>
      {children}
    </figure>
  );
}

function SignIn({ onSignIn, className, children = "Sign in", variant }: { onSignIn: () => void; className?: string; children?: string; variant?: "default" | "outline" }) {
  return (
    <Button type="button" variant={variant} onClick={onSignIn} className={cn("press", className)}>
      {children}
    </Button>
  );
}

// Sticky glass bar: it slides away while you read down and returns when you scroll up, marks the section you are in,
// and a hairline along its foot shows how far down the page you are.
function Header({ onSignIn, active }: { onSignIn: () => void; active: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <div className="l-header" data-open={open || undefined}>
    <header className="mx-auto flex w-full max-w-[90rem] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3 md:px-8 lg:px-12">
      <a href="#top" className="flex min-h-11 items-center gap-2.5 text-base font-semibold tracking-tight" translate="no">
        <span aria-hidden="true" className="logo-mark">
          DD
        </span>
        DisputeDesk
      </a>
      <div className="flex items-center gap-2 md:order-last">
        <SignIn onSignIn={onSignIn} variant="outline" className="h-11 md:h-10" />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 md:hidden"
          aria-expanded={open}
          aria-controls="l-nav"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </Button>
      </div>
      <nav id="l-nav" aria-label="Sections" className={cn("l-menu w-full md:flex md:w-auto", open ? "block" : "hidden")}>
        <ul className="flex flex-col gap-1 md:flex-row md:gap-7">
          {LINKS.map((l) => (
            <li key={l.href}>
              <a
                href={l.href}
                onClick={() => setOpen(false)}
                aria-current={active === l.href.slice(1) ? "location" : undefined}
                className="nav-link block py-2.5 text-sm md:py-1"
              >
                {l.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </header>
    <span aria-hidden="true" className="l-progress" />
    </div>
  );
}

function SideToggle({ face, onFace }: { face: Side; onFace: (side: Side) => void }) {
  return (
    <div role="group" aria-label="Read the record as" className="side-toggle">
      {(["merchant", "buyer"] as const).map((side) => (
        <button key={side} type="button" data-side={side} aria-pressed={face === side} onClick={() => onFace(side)} className="press">
          {side === "merchant" ? "Merchant’s side" : "Buyer’s side"}
        </button>
      ))}
    </div>
  );
}

function Hero({ onSignIn, face, onFace, turnRef }: { onSignIn: () => void; face: Side; onFace: (side: Side) => void; turnRef: RefObject<HTMLDivElement | null> }) {
  return (
    <section aria-labelledby="hero-h">
      <div className="mx-auto grid max-w-[90rem] gap-12 px-4 pt-10 pb-20 md:px-8 md:pt-14 lg:px-12 lg:pb-28 xl:grid-cols-12 xl:items-center xl:gap-10">
        <div className="xl:col-span-5">
          <p data-arrive className="hero-chip mb-6 motion-safe:animate-rise">
            <span aria-hidden="true" className="hero-chip-dot">
              <Sparkles className="size-3.5" />
            </span>
            The evidence intelligence layer for payment disputes
          </p>
          <h1 id="hero-h" data-arrive className="motion-safe:animate-rise text-[2.9rem] leading-[0.98] font-semibold tracking-[-0.05em] sm:text-7xl xl:text-[5rem]">
            Every dispute, checked against the record.
          </h1>
          <div data-arrive className="mt-6 motion-safe:animate-rise motion-safe:[animation-delay:120ms]">
            <p className="max-w-md text-lg">
              DisputeDesk checks the evidence records behind PayPal disputes, for merchants and buyers. Both sides read the same facts, gaps stay marked as gaps, and a person makes every decision.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-2">
              <SignIn onSignIn={onSignIn} className="cta h-12 px-6 text-base">
                Sign in to the demo
              </SignIn>
              <a href="#how" className="nav-link inline-flex h-12 items-center gap-2 px-3 text-sm font-medium">
                How it works <ArrowDown aria-hidden="true" className="size-4" />
              </a>
            </div>
            <ul className="hero-proof mt-8">
              {["Read-only with PayPal", "Synthetic demo data", "A person reviews every draft"].map((p) => (
                <li key={p}>
                  <Check aria-hidden="true" className="size-4 shrink-0" />
                  {p}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="hero-art xl:col-span-7">
          {/* Decorative: the records the rules read, floating around the one dispute. */}
          <div aria-hidden="true">
            <span className="float-icon" data-tone="lime">
              <FileSearch />
            </span>
            <span className="float-icon">
              <Truck />
            </span>
            <span className="float-icon">
              <MessageSquare />
            </span>
            <span className="float-icon">
              <ShieldCheck />
            </span>
          </div>
          <Pane label="Illustrative example of one dispute record, read from the merchant’s and the buyer’s side" face={face} turnRef={turnRef} className="hero-pane" />
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <SideToggle face={face} onFace={onFace} />
            <p className="text-sm text-muted-foreground">Turn the pane: the reason, status and stage don’t change.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

// Facts about how the product is built, not results: nothing here is a business figure.
const NUMBERS = [
  { n: "0", label: "Write calls to PayPal", note: "A token, then read requests only." },
  { n: "4", label: "Records checked", note: "On every dispute, by fixed rules." },
  { n: "3", label: "Roles, kept apart", note: "Merchant, buyer and read-only admin." },
  { n: "1", label: "Person decides", note: "Every draft waits for your review." },
];

function Numbers() {
  const reasons = Object.values(REASON_LABELS);
  return (
    <section aria-labelledby="numbers-h" className="numbers mx-auto max-w-[90rem] px-4 md:px-8 lg:px-12">
      <h2 id="numbers-h" className="sr-only">
        DisputeDesk in numbers
      </h2>
      <ul className="num-grid">
        {NUMBERS.map((x) => (
          <li key={x.label} data-num>
            <p className="num-n tabular-nums">{x.n}</p>
            <h3 className="mt-3 text-base font-semibold tracking-tight">{x.label}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{x.note}</p>
          </li>
        ))}
      </ul>
      <div className="ticker mt-6">
        <p className="ticker-label">Reads every dispute reason</p>
        <div className="ticker-track">
          {[0, 1].map((copy) => (
            <ul key={copy} className="ticker-row" aria-hidden={copy === 1 || undefined}>
              {reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ))}
        </div>
      </div>
    </section>
  );
}

const PIPELINE = [
  { icon: Lock, tag: "Token + read", title: "PayPal, read-only", body: "The server asks PayPal for a token, then only reads disputes. The token never reaches the browser." },
  { icon: ScanLine, tag: "Source of truth", title: "The evidence engine", body: "Fixed rules mark each record available, unverified or missing, and flag records that disagree." },
  { icon: Sparkles, tag: "Words only", title: "Gemini puts it in words", body: "The AI turns the checked facts into an explanation or a draft. It decides nothing." },
  { icon: ShieldCheck, tag: "Every line", title: "The server checks each line", body: "Each AI line is matched against the records. Lines they don’t support are dropped before you see them." },
  { icon: UserCheck, tag: "Human decision", title: "You review and send", body: "Every draft is marked for review. DisputeDesk never submits: you send any response yourself." },
];

// The engine's own table of key evidence per reason (server/src/evidence.ts). Every other reason: all supporting.
const EV_COLS = ["Order confirmation", "Shipping tracking", "Proof of delivery", "Customer communication"];
const KEY_ROWS: [string, string[]][] = [
  ["Item not received", ["Shipping tracking", "Proof of delivery"]],
  ["Not as described", ["Order confirmation", "Customer communication"]],
  ["Unauthorized transaction", ["Order confirmation", "Customer communication"]],
];

function Engine() {
  return (
    <section id="engine" aria-labelledby="engine-h" className="mx-auto max-w-[90rem] px-4 py-20 md:px-8 md:py-24 lg:px-12">
      <SectionHead id="engine-h" title="Rules first. Words second." lead="Five stages, in the same order on every dispute. Each one can only narrow what the next may say." />
      <div className="pipe-wrap mt-14 md:mt-16">
      <span aria-hidden="true" className="pipe-rail">
        <span className="pipe-fill" />
      </span>
      <ol className="pipe">
        {PIPELINE.map(({ icon: Icon, tag, title, body }, i) => (
          <li key={title} data-pipe>
            <span aria-hidden="true" className="pipe-node">
              <Icon className="size-5" />
            </span>
            <p className="pipe-tag">
              <span className="tabular-nums">0{i + 1}</span> · {tag}
            </p>
            <h3 className="mt-2 text-lg font-semibold tracking-tight">{title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{body}</p>
          </li>
        ))}
      </ol>
      </div>

      <div className="mt-16 grid gap-10 md:mt-20 lg:grid-cols-12 lg:gap-12">
        <div className="lg:col-span-4">
          <h3 className="text-2xl font-semibold tracking-tight md:text-3xl">Which records matter most.</h3>
          <p className="mt-3 text-muted-foreground">
            The engine checks all four records on every dispute. For these reasons it marks two of them as key evidence. For every other reason, all four count as supporting.
          </p>
        </div>
        <div className="matrix card-white lg:col-span-8">
          <table>
            <caption className="sr-only">Key evidence by dispute reason</caption>
            <thead>
              <tr>
                <th scope="col">Reason</th>
                {EV_COLS.map((c) => (
                  <th key={c} scope="col">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {KEY_ROWS.map(([reason, keys]) => (
                <tr key={reason}>
                  <th scope="row">{reason}</th>
                  {EV_COLS.map((c) => (
                    <td key={c} data-key={keys.includes(c) || undefined}>
                      {keys.includes(c) ? (
                        <span className="m-key">
                          <Check aria-hidden="true" className="size-3.5" /> Key
                        </span>
                      ) : (
                        <span className="m-sup">Supporting</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function SectionHead({ id, title, lead }: { id: string; title: string; lead: string }) {
  return (
    <div className="grid gap-4 md:grid-cols-12 md:gap-8">
      <h2 id={id} data-reveal className="text-[2rem] leading-[1.06] font-semibold tracking-[-0.035em] md:col-span-7 md:text-5xl lg:text-[3.5rem]">
        {title}
      </h2>
      <p className="max-w-xl text-lg text-muted-foreground md:col-span-5 md:self-end">{lead}</p>
    </div>
  );
}

// The one live thing: draft a response and see which lines survive the checks. Nothing is sent anywhere.
function DraftFragment() {
  const [drafted, setDrafted] = useState(false);
  const draftButton = useRef<HTMLButtonElement>(null);
  const againButton = useRef<HTMLButtonElement>(null);
  const changed = useRef(false);
  useEffect(() => {
    if (!changed.current) return;
    (drafted ? againButton : draftButton).current?.focus();
  }, [drafted]);
  const toggle = (next: boolean) => {
    changed.current = true;
    setDrafted(next);
  };

  return (
    <Plate label="Illustrative example of a checked draft" title="Response draft" sub={drafted ? "Drafted · waiting for your review" : "Evidence checked"}>
      <div aria-live="polite" className="px-4 py-4 text-sm">
        {drafted ? (
          <ul className="space-y-2.5">
            <li className="flex gap-2">
              <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ok-foreground" />
              <span>The order confirmation is on record.</span>
            </li>
            <li className="flex gap-2">
              <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ok-foreground" />
              <span>Tracking is on record, but another record disagrees with it.</span>
            </li>
            <li className="flex gap-2 rounded-md bg-gap px-2 py-1.5 text-gap-foreground">
              <X aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>
                <s>“The parcel was signed for.”</s> Removed: no proof of delivery is on record.
              </span>
            </li>
          </ul>
        ) : (
          <p className="text-muted-foreground">2 available, 1 unverified, 1 missing. Ready to draft.</p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
        <p className="text-xs text-muted-foreground">Nothing is sent. You send any response yourself.</p>
        {drafted ? (
          <Button ref={againButton} type="button" size="sm" variant="outline" onClick={() => toggle(false)} className="press h-11 md:h-9">
            Start again
          </Button>
        ) : (
          <Button ref={draftButton} type="button" size="sm" onClick={() => toggle(true)} className="press h-11 md:h-9">
            Draft a response
          </Button>
        )}
      </div>
    </Plate>
  );
}

const STEPS: { title: string; body: string; extra?: ReactNode }[] = [
  {
    title: "Read every record",
    body: "Fixed rules read the order, shipping, delivery and message records, and etch each one onto the record as available, unverified or missing.",
  },
  {
    title: "Crack what disagrees, outline what’s missing",
    body: "When two records contradict each other, the line cracks and says so. A missing record stays an empty outline: a gap, never proof.",
  },
  {
    title: "Draft, check, then you decide",
    body: "Gemini words a draft. The server checks every line against the records and drops what they don’t support. Try it.",
    extra: <DraftFragment />,
  },
  {
    title: "The buyer reads the same lines",
    body: "On the other side of the pane, the buyer sees the same reason, status and stage, in plain words, and never the merchant’s evidence or drafts.",
  },
];

// The example rows the laptop's dispute list shows. Illustrative only: no demo records reach this page.
const SHOW_ROWS = [
  { reason: "Item not received", amount: "$84.00", status: "Awaiting seller", active: true },
  { reason: "Not as described", amount: "$129.00", status: "Under review", active: false },
  { reason: "Unauthorised payment", amount: "$42.50", status: "Closed", active: false },
];

// Two devices drawn in HTML: the merchant's workspace on a laptop, the buyer's view of the same dispute on a phone.
function Showcase() {
  return (
    <section id="showcase" aria-labelledby="showcase-h" className="mx-auto max-w-[90rem] px-4 pt-8 pb-20 md:px-8 md:pb-24 lg:px-12">
      <SectionHead id="showcase-h" title="Your dispute desk, on every screen." lead="Merchants work the case on a laptop. Buyers follow it on a phone. Both read the same checked record." />
      <figure data-ui aria-label="Illustrative example of the merchant workspace on a laptop and the buyer’s view on a phone" className="devices mt-12 md:mt-16">
        <div className="device-laptop">
          <div className="laptop-screen">
            <div className="scr-bar" aria-hidden="true">
              <span />
              <span />
              <span />
              <p>DisputeDesk · Merchant workspace</p>
            </div>
            <div className="scr-body">
              <div className="scr-rail" aria-hidden="true">
                <span className="scr-logo">D</span>
                <span className="scr-nav" data-on="">
                  <FileSearch className="size-4" />
                </span>
                <span className="scr-nav">
                  <ScanLine className="size-4" />
                </span>
                <span className="scr-nav">
                  <Lock className="size-4" />
                </span>
              </div>
              <div className="scr-list">
                <p className="scr-label">Disputes</p>
                <ul>
                  {SHOW_ROWS.map((r) => (
                    <li key={r.reason} data-on={r.active ? "" : undefined}>
                      <span className="scr-row-top">
                        <b>{r.reason}</b>
                        <span>{r.amount}</span>
                      </span>
                      <span className="scr-status">{r.status}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="scr-detail">
                <div className="scr-case">
                  <p className="scr-case-kicker">Example dispute</p>
                  <p className="scr-case-title">Item not received</p>
                  <span className="scr-pill">Awaiting seller</span>
                </div>
                <p className="scr-label">Evidence</p>
                <ul className="scr-evidence">
                  {EVIDENCE.map((e) => (
                    <li key={e.label} data-kind={e.kind}>
                      <span className="ev-dot" aria-hidden="true" />
                      <span className="ev-label">{e.label}</span>
                      <span className="ev-word">{e.word}</span>
                    </li>
                  ))}
                </ul>
                <div className="scr-draft">
                  <p>
                    <Sparkles aria-hidden="true" className="size-3.5" /> Draft reply · needs your review
                  </p>
                  <span className="bar w-11/12" />
                  <span className="bar w-9/12" />
                  <span className="bar w-7/12" />
                </div>
              </div>
            </div>
          </div>
          <div className="laptop-base" aria-hidden="true" />
        </div>

        <div className="device-phone">
          <div className="phone-screen">
            <span className="phone-notch" aria-hidden="true" />
            <p className="scr-case-kicker">Your dispute</p>
            <p className="phone-title">Item not received</p>
            <span className="scr-pill">Awaiting seller</span>
            <ol className="phone-stages" aria-label="Stage 2 of 4">
              {STAGES.map((s, i) => (
                <li key={s} data-done={i < 2 ? "" : undefined} />
              ))}
            </ol>
            <p className="phone-stage">Stage 2 of 4 · Seller and buyer respond</p>
            <div className="phone-card">
              <p>What this status means</p>
              <span className="bar w-full" />
              <span className="bar w-10/12" />
              <span className="bar w-8/12" />
            </div>
            <div className="phone-card">
              <p>Not on record yet</p>
              <span className="bar w-9/12" />
              <span className="bar w-6/12" />
            </div>
          </div>
        </div>

        <div className="device-chip device-chip-a" aria-hidden="true">
          <span className="chip-in">
            <span className="chip-icon">
              <Check className="size-4" />
            </span>
            <span>
              <b>4 records checked</b>
              <small>By fixed rules, not the AI</small>
            </span>
          </span>
        </div>
        <div className="device-chip device-chip-b" aria-hidden="true">
          <span className="chip-in">
            <span className="chip-icon" data-tone="ink">
              <ShieldCheck className="size-4" />
            </span>
            <span>
              <b>Every AI line checked</b>
              <small>Unsupported lines dropped</small>
            </span>
          </span>
        </div>
        <figcaption className="devices-cap">Illustrative example. Not a real dispute.</figcaption>
      </figure>
    </section>
  );
}

function HowItWorks({ step, turnRef, face, onFace }: { step: number; turnRef: RefObject<HTMLDivElement | null>; face: Side; onFace: (side: Side) => void }) {
  return (
    <section id="how" aria-labelledby="how-h" className="how mx-auto max-w-[90rem] px-4 py-20 md:px-8 md:py-24 lg:px-12">
      <SectionHead id="how-h" title="One record, checked in four steps." lead="The same order every time. The rules decide the facts; the AI only puts them into words." />
      <div className="mt-14 grid gap-12 lg:mt-20 lg:grid-cols-12 lg:gap-12">
        <div className="lg:sticky lg:top-24 lg:col-span-6 lg:self-start">
          <Pane label="Illustrative example of the record as each step changes it" face={step === 3 ? "buyer" : face} turnRef={turnRef} />
          {/* Below 1024 the scroll doesn't turn this pane, so the reader turns it. */}
          <div className="mt-5 lg:hidden">
            <SideToggle face={face} onFace={onFace} />
          </div>
        </div>
        <ol id="how-steps" className="gl-steps lg:col-span-6">
          {STEPS.map((s, i) => (
            <li key={s.title} data-step data-active={step === i || undefined} className="step">
              <span aria-hidden="true" className="step-num">
                {i + 1}
              </span>
              <div className="min-w-0">
                <h3 className="text-2xl font-semibold tracking-tight">{s.title}</h3>
                <p className="mt-3 max-w-lg text-muted-foreground">{s.body}</p>
                {s.extra && <div className="mt-6 max-w-lg">{s.extra}</div>}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

const ROLES: { id: string; tab: string; side?: Side; title: string; body: string; points: string[]; fragment: ReactNode }[] = [
  {
    id: "merchants",
    tab: "Merchants",
    side: "merchant",
    title: "Know what you can prove before you reply.",
    body: "See which evidence is on record, what is missing and where records disagree. Then review a checked draft before you send anything yourself.",
    points: ["Status for each evidence item", "Contradictions flagged", "Drafts that need your review"],
    fragment: (
      <Plate label="Illustrative example of the merchant view" title="Item not received" sub="Awaiting seller · example dispute">
        <ul className="gl-marks p-4">
          {EVIDENCE.map((e) => (
            <Mark key={e.label} item={e} />
          ))}
        </ul>
      </Plate>
    ),
  },
  {
    id: "buyers",
    tab: "Buyers",
    side: "buyer",
    title: "Plain answers about where your dispute stands.",
    body: "Guidance built only from what a buyer can see: what the status means, the usual stages and what to have ready. Never the merchant’s evidence or drafts.",
    points: ["What the status means", "The usual stages", "What to have ready"],
    fragment: (
      <Plate label="Illustrative example of the buyer view" title="Your dispute" sub="Awaiting seller">
        <ol className="gl-stages p-4">
          {STAGES.map((stage, i) => (
            <li key={stage} aria-current={i === 1 ? "step" : undefined}>
              <span className="text-sm text-muted-foreground">Stage {i + 1}</span>
              <span className="block font-medium">{stage}</span>
            </li>
          ))}
        </ol>
      </Plate>
    ),
  },
  {
    id: "insights",
    tab: "Insights",
    title: "Patterns across your disputes, counted.",
    body: "Fixed rules over the evidence checks: counts and dispute IDs only. No predictions, causes or averages.",
    points: ["Counts, not guesses", "The disputes behind each count", "For merchants and admin"],
    fragment: (
      <Plate label="Illustrative example of an insight" title="Proof of delivery missing" sub="Across this account’s disputes">
        <div className="px-4 py-5">
          <p className="etch text-4xl font-semibold tracking-tight tabular-nums">6 of 7</p>
          <p className="mt-1 text-sm text-muted-foreground">disputes have no proof of delivery on record</p>
        </div>
      </Plate>
    ),
  },
  {
    id: "admin",
    tab: "Admin",
    title: "Oversight that can’t change anything.",
    body: "Admin reads across accounts to check the work. It can’t draft, edit or send. One account never sees another’s disputes.",
    points: ["Read across accounts", "No drafting or editing", "Each account kept apart"],
    fragment: (
      <Plate label="Illustrative example of the admin view" title="All accounts" sub="Read-only">
        <ul className="divide-y text-sm">
          {[
            ["Merchant account", "Merchant"],
            ["Second merchant account", "Merchant"],
            ["Buyer account", "Buyer"],
          ].map(([name, count]) => (
            <li key={name} className="flex justify-between gap-4 px-4 py-3">
              <span>{name}</span>
              <span className="text-muted-foreground tabular-nums">{count}</span>
            </li>
          ))}
        </ul>
      </Plate>
    ),
  },
];

function Roles() {
  return (
    <section id="roles" aria-labelledby="roles-h" className="roles">
      <div className="mx-auto max-w-[90rem] px-4 py-20 md:px-8 md:py-24 lg:px-12">
        <SectionHead id="roles-h" title="One set of facts, four views." lead="Each account sees only its own disputes, and only the parts its role needs." />
        <Tabs defaultValue="merchants" className="mt-12 gap-10">
          <TabsList className="role-tabs h-auto group-data-[orientation=horizontal]/tabs:h-auto w-full flex-wrap justify-start gap-1 p-1 sm:w-fit">
            {ROLES.map((r) => (
              <TabsTrigger key={r.id} value={r.id} data-side={r.side} className="role-tab h-11 flex-none px-4 md:h-10">
                {r.tab}
              </TabsTrigger>
            ))}
          </TabsList>
          {ROLES.map((r) => (
            <TabsContent key={r.id} value={r.id} className="role-panel grid gap-10 md:grid-cols-12 md:gap-8">
              <div className="md:col-span-5">
                <h3 className="text-2xl font-semibold tracking-tight md:text-3xl">{r.title}</h3>
                <p className="mt-3 text-muted-foreground">{r.body}</p>
                <ul className="mt-6 space-y-2.5">
                  {r.points.map((p) => (
                    <li key={p} className="flex items-center gap-2.5">
                      <Check aria-hidden="true" className="size-4 shrink-0" />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="md:col-span-7 lg:col-span-6 lg:col-start-7">{r.fragment}</div>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </section>
  );
}

const SAFEGUARDS: { title: string; body: string; icon: typeof Check }[] = [
  { title: "The records decide", body: "Evidence statuses and contradictions come from fixed rules, not from the AI.", icon: ScanLine },
  { title: "The AI only words", body: "Every AI line is checked against the records. Lines they don’t support are dropped.", icon: Sparkles },
  { title: "No invented facts", body: "No made-up tracking numbers, carriers, dates, people, messages or delivery claims.", icon: Ban },
  { title: "Gaps stay gaps", body: "A missing record is never treated as proof that something didn’t happen.", icon: CircleDashed },
  { title: "Read-only with PayPal", body: "DisputeDesk never submits responses, uploads evidence or changes a dispute.", icon: Lock },
  { title: "Each account kept apart", body: "Another account’s dispute answers exactly like one that doesn’t exist.", icon: EyeOff },
];

function Safeguards() {
  return (
    <section id="safeguards" aria-labelledby="safeguards-h" className="px-2 py-8 md:px-4 md:py-12">
      <div className="dark-panel mx-auto grid max-w-[90rem] gap-14 px-5 py-16 md:px-10 md:py-20 lg:grid-cols-12 lg:gap-12 lg:px-14">
      <div className="lg:col-span-5">
        <h2 id="safeguards-h" data-reveal className="text-[2rem] leading-[1.06] font-semibold tracking-[-0.035em] md:text-5xl lg:text-[3.5rem]">
          What DisputeDesk will and won’t do.
        </h2>
        <p className="mt-5 max-w-md text-lg text-muted-foreground">These rules are built into the code, not just written on this page. The record shows each one the same way.</p>
        <Plate label="Illustrative example of how the record marks evidence" title="How evidence is marked" className="mt-10">
          <ul className="gl-marks marks-stack p-4">
            {EVIDENCE.slice(0, 3).map((e) => (
              <Mark key={e.label} item={e} />
            ))}
          </ul>
        </Plate>
      </div>
      <ul className="rules lg:col-span-7">
        {SAFEGUARDS.map(({ title, body, icon: Icon }) => (
          <li key={title}>
            <span aria-hidden="true" className="rule-icon">
              <Icon className="size-5" />
            </span>
            <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
            <p className="mt-2 text-muted-foreground">{body}</p>
          </li>
        ))}
      </ul>
      </div>
    </section>
  );
}

const FAQ: { q: string; a: string }[] = [
  { q: "Does DisputeDesk send anything to PayPal?", a: "No. It only reads dispute data. It never submits responses, uploads evidence or changes a dispute. You send any response yourself." },
  { q: "Is the data in the demo real?", a: "No. The demo uses synthetic disputes, labelled as demo data and kept apart from PayPal sandbox data." },
  { q: "What does the AI do?", a: "Gemini only puts the checked facts into words for explanations and drafts. The server checks each line against the records and drops anything they don’t support. The rule-based checks work without it." },
  { q: "Can a buyer see the merchant’s evidence?", a: "No. Buyers see only buyer-visible fields: never the order, the evidence, the merchant’s messages or drafts." },
  { q: "What if the AI writes something the records don’t support?", a: "The server drops that line before you see it. For buyers, an explanation that fails a check isn’t shown at all; the rule-based guidance is shown instead." },
  { q: "Can one merchant see another merchant’s disputes?", a: "No. Every request is checked against the signed-in account on the server. Another account’s dispute answers exactly like one that doesn’t exist." },
  { q: "Where do PayPal tokens and passwords go?", a: "PayPal access tokens stay on the server and never reach the browser. Passwords are stored only as scrypt hashes, and sessions store only a hash of their token." },
  { q: "How do I try it?", a: "Sign in with one of the synthetic demo accounts listed in the project README: a merchant, a buyer or the read-only admin." },
];

function Questions() {
  return (
    <section id="faq" aria-labelledby="faq-h" className="mx-auto grid max-w-[90rem] gap-10 px-4 pb-20 md:grid-cols-12 md:gap-8 md:px-8 md:pb-24 lg:px-12">
      <h2 id="faq-h" data-reveal className="text-[2rem] leading-[1.06] font-semibold tracking-[-0.035em] md:col-span-4 md:text-5xl">
        Questions
      </h2>
      <Accordion type="single" collapsible className="card-white px-5 md:col-span-8 md:px-8 [&>*:last-child]:border-b-0">
        {FAQ.map((f, i) => (
          <AccordionItem key={f.q} value={`q${i}`}>
            <AccordionTrigger className="py-5 text-base md:text-lg">{f.q}</AccordionTrigger>
            <AccordionContent className="max-w-2xl pb-5 text-base text-muted-foreground">{f.a}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}

function Close({ onSignIn }: { onSignIn: () => void }) {
  return (
    <section aria-labelledby="close-h" className="px-2 md:px-4">
      <div className="close mx-auto flex max-w-[90rem] flex-col items-start gap-8 px-6 py-16 md:flex-row md:items-end md:justify-between md:px-12 md:py-24">
        <div>
          <h2 id="close-h" data-reveal className="etch max-w-3xl text-4xl leading-[1.02] font-semibold tracking-[-0.04em] md:text-6xl">
            See a dispute checked against its records.
          </h2>
          <p className="mt-4 max-w-xl text-lg text-muted-foreground">Sign in with a synthetic demo account to read the merchant’s side, the buyer’s side and the admin view.</p>
        </div>
        <SignIn onSignIn={onSignIn} className="cta h-12 shrink-0 px-6 text-base">
          Sign in to the demo
        </SignIn>
      </div>
    </section>
  );
}

const FOOT_COLS: { title: string; items: (string | { href: string; label: string })[] }[] = [
  { title: "On this page", items: LINKS },
  { title: "The demo", items: ["Synthetic disputes", "Merchant, buyer, admin", "Accounts in the README"] },
  { title: "Built with", items: ["React and TypeScript", "Express and SQLite", "Gemini, words only", "PayPal REST, read-only"] },
];

function Footer() {
  return (
    <footer className="mx-auto max-w-[90rem] px-4 pt-16 pb-10 md:px-8 lg:px-12">
      <div className="grid gap-10 border-b pb-12 md:grid-cols-12 md:gap-8">
        <div className="md:col-span-6">
          <p className="flex items-center gap-2.5 text-base font-semibold tracking-tight" translate="no">
            <span aria-hidden="true" className="logo-mark">
              DD
            </span>
            DisputeDesk
          </p>
          <p className="mt-4 max-w-sm text-sm text-muted-foreground">AI-assisted dispute review for merchants and buyers. Rules decide the facts, the AI words them, a person decides.</p>
        </div>
        {FOOT_COLS.map((col) => (
          <div key={col.title} role={col.title === "On this page" ? "navigation" : undefined} aria-label={col.title === "On this page" ? col.title : undefined} className="md:col-span-2">
            <p className="foot-title">{col.title}</p>
            <ul className="mt-4 space-y-2.5 text-sm">
              {col.items.map((it) =>
                typeof it === "string" ? (
                  <li key={it} className="text-muted-foreground">
                    {it}
                  </li>
                ) : (
                  <li key={it.href}>
                    <a href={it.href} className="nav-link">
                      {it.label}
                    </a>
                  </li>
                ),
              )}
            </ul>
          </div>
        ))}
      </div>
      <p aria-hidden="true" className="foot-word" translate="no">
        DisputeDesk
      </p>
      <p className="mt-6 text-sm text-muted-foreground">
        Synthetic demo. Not affiliated with or endorsed by PayPal or Google. DisputeDesk never submits dispute responses.
      </p>
    </footer>
  );
}

export function Landing({ onSignIn }: { onSignIn: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const heroTurn = useRef<HTMLDivElement>(null);
  const howTurn = useRef<HTMLDivElement>(null);
  const [heroFace, setHeroFace] = useState<Side>("merchant");
  const [howFace, setHowFace] = useState<Side>("merchant");
  const [step, setStep] = useState(0);
  const [active, setActive] = useState("");
  // "on" while the opening shows, "done" after it (the hero text then keeps the arrival GSAP gave it).
  const [intro, setIntro] = useState<"off" | "on" | "done">(() => (shouldIntro() ? "on" : "off"));
  const introTl = useRef<gsap.core.Timeline | null>(null);

  const { contextSafe } = useGSAP(
    () => {
      const scope = root.current!;

      // Navigation runs with or without motion: the bar marks the section in view and the hairline tracks the scroll.
      LINKS.forEach(({ href }) => {
        const id = href.slice(1);
        ScrollTrigger.create({
          trigger: href,
          start: "top 40%",
          end: "bottom 40%",
          onToggle: (self) => setActive((prev) => (self.isActive ? id : prev === id ? "" : prev)),
        });
      });
      gsap.fromTo(".l-progress", { scaleX: 0 }, { scaleX: 1, ease: "none", scrollTrigger: { start: 0, end: "max", scrub: true } });

      const mm = gsap.matchMedia();
      mm.add(
        {
          motion: "(prefers-reduced-motion: no-preference)",
          wide: "(min-width: 1024px)",
          tilt: "(prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine) and (min-width: 1280px)",
        },
        (ctx) => {
        const { motion, wide, tilt } = ctx.conditions as { motion: boolean; wide: boolean; tilt: boolean };
        const hero = heroTurn.current;
        const how = howTurn.current;
        const section = document.getElementById("how");
        const bar = scope.querySelector<HTMLElement>(".l-header");
        if (!hero || !how || !section || !bar) return;
        const cleanups: (() => void)[] = [];
        // Reduced motion switched on mid-opening: drop it rather than leave the glass up.
        if (!motion && scope.querySelector(".intro")) setIntro("done");

        if (motion) {
          const curtain = scope.querySelector<HTMLElement>(".intro");
          // Arrival: the pane clears out of the smoke, then its lines are etched in, then the crack runs.
          const arrive = gsap
            .timeline({ delay: curtain ? 0 : 0.15 })
            // Fade and blur go on the figure: a filter on a 3D layer would flatten its faces mid-turn.
            .from(hero.closest("figure"), { opacity: 0, filter: "blur(18px)", duration: 1.2, ease: "expo.out", clearProps: "opacity,filter" })
            .from(hero, { y: 36, rotationX: 12, duration: 1.2, ease: "expo.out" }, 0)
            .from(hero.querySelectorAll('[data-side="merchant"] [data-etch]'), { clipPath: "inset(0 100% 0 0)", duration: 0.7, stagger: 0.06, ease: "expo.out", clearProps: "clipPath" }, 0.35)
            .from(hero.querySelector('[data-side="merchant"] .crack path'), { strokeDashoffset: 1, duration: 0.6, ease: "power2.out" }, 0.95);

          if (curtain) {
            // The opening reel plays on its own sheet; when it ends or is skipped the sheet slides up and the hero arrives.
            arrive.from(scope.querySelectorAll("[data-arrive]"), { opacity: 0, y: 14, duration: 0.64, stagger: 0.12, ease: "expo.out", clearProps: "opacity,transform" }, 0);
            const html = document.documentElement;
            html.style.overflow = "hidden";
            const unlock = () => (html.style.overflow = "");
            const end = () => {
              unlock();
              setIntro((v) => (v === "on" ? "done" : v));
            };
            // Held until the reel ends or is skipped, then the sheet lifts and the hero arrives.
            introTl.current = gsap
              .timeline({ paused: true })
              .addLabel("lift", 0)
              .to(curtain, { yPercent: -100, duration: 1, ease: "expo.inOut" }, "lift")
              .add(arrive, "lift+=0.45")
              .call(end, [], "lift+=1.1");
            // Only unlock here: React's dev double run reverts this once, and the opening must survive it.
            cleanups.push(unlock);
          }

          // The bar slides away while reading down and comes back on the way up.
          ScrollTrigger.create({
            start: 0,
            end: "max",
            onUpdate: (self) => {
              if (self.direction === 1 && self.scroll() > 160) bar.dataset.away = "";
              else delete bar.dataset.away;
            },
          });
          cleanups.push(() => delete bar.dataset.away);

          // Section headings are etched in from the left, once, as they arrive.
          gsap.utils.toArray<HTMLElement>("h2[data-reveal]", scope).forEach((h) =>
            gsap.fromTo(
              h,
              { clipPath: "inset(-12% 100% -12% 0)" },
              { clipPath: "inset(-12% 0% -12% 0)", duration: 1.1, ease: "expo.out", clearProps: "clipPath", scrollTrigger: { trigger: h, start: "top 88%", once: true } },
            ),
          );
          // Safeguard rules and questions settle in as a group, not one by one.
          const groups = ".rules li, #faq [data-slot=accordion-item]";
          gsap.set(groups, { opacity: 0, y: 18 });
          ScrollTrigger.batch(groups, {
            start: "top 92%",
            once: true,
            onEnter: (els) => gsap.to(els, { opacity: 1, y: 0, duration: 0.8, stagger: 0.07, ease: "expo.out", clearProps: "opacity,transform" }),
          });

          // The devices rise in once, then the phone drifts a little faster than the laptop as the page scrolls.
          const devices = scope.querySelector(".devices");
          if (devices) {
            gsap
              .timeline({ scrollTrigger: { trigger: devices, start: "top 82%", once: true }, defaults: { ease: "expo.out" } })
              .from(".device-laptop", { y: 70, opacity: 0, duration: 1.2 })
              .from(".device-phone", { y: 140, opacity: 0, duration: 1.3 }, 0.15)
              .from(".device-chip", { y: 24, scale: 0.94, opacity: 0, duration: 0.9, stagger: 0.12 }, 0.45);
            gsap.to(".device-phone", { yPercent: -8, ease: "none", scrollTrigger: { trigger: devices, start: "top bottom", end: "bottom top", scrub: true } });
          }

          // The four numbers rise in together; the pipeline rail fills with the scroll and lights each stage it reaches.
          gsap.from("[data-num]", { y: 28, opacity: 0, duration: 1, stagger: 0.08, ease: "expo.out", clearProps: "opacity,transform", scrollTrigger: { trigger: ".num-grid", start: "top 88%", once: true } });
          const pipe = scope.querySelector<HTMLElement>(".pipe-wrap");
          if (pipe) {
            const stages = gsap.utils.toArray<HTMLElement>("[data-pipe]", pipe);
            gsap.from(stages, { y: 24, opacity: 0, duration: 0.9, stagger: 0.09, ease: "expo.out", clearProps: "opacity,transform", scrollTrigger: { trigger: pipe, start: "top 85%", once: true } });
            gsap.fromTo(
              ".pipe-fill",
              { scaleX: wide ? 0 : 1, scaleY: wide ? 1 : 0 },
              {
                scaleX: 1,
                scaleY: 1,
                ease: "none",
                scrollTrigger: {
                  trigger: pipe,
                  start: "top 70%",
                  end: wide ? "top 30%" : "bottom 60%",
                  scrub: 0.6,
                  onUpdate: (self) => stages.forEach((el, i) => (self.progress >= i / (stages.length - 1) - 0.02 ? (el.dataset.lit = "") : delete el.dataset.lit)),
                },
              },
            );
            cleanups.push(() => stages.forEach((el) => delete el.dataset.lit));
          }
        }

        if (tilt) {
          // The resting hero pane leans a few degrees toward the pointer, with some weight to it.
          const layer = hero.parentElement!;
          const stage = layer.parentElement!;
          const rx = gsap.quickTo(layer, "rotationX", { duration: 0.7, ease: "power3.out" });
          const ry = gsap.quickTo(layer, "rotationY", { duration: 0.7, ease: "power3.out" });
          const move = (e: PointerEvent) => {
            const r = stage.getBoundingClientRect();
            rx(((e.clientY - r.top) / r.height - 0.5) * -5);
            ry(((e.clientX - r.left) / r.width - 0.5) * 7);
          };
          const leave = () => {
            rx(0);
            ry(0);
          };
          stage.addEventListener("pointermove", move);
          stage.addEventListener("pointerleave", leave);
          cleanups.push(() => {
            stage.removeEventListener("pointermove", move);
            stage.removeEventListener("pointerleave", leave);
          });
        }

        if (!wide) {
          // On phones the record is etched in once as it scrolls into view; the toggle under it turns it.
          if (motion) {
            const front = how.querySelector('[data-side="merchant"]')!;
            gsap
              .timeline({ scrollTrigger: { trigger: how, start: "top 80%", once: true } })
              .from(front.querySelectorAll("[data-etch]"), { clipPath: "inset(0 100% 0 0)", duration: 0.7, stagger: 0.07, ease: "expo.out", clearProps: "clipPath" })
              .from(front.querySelector(".crack path"), { strokeDashoffset: 1, duration: 0.6, ease: "power2.out" }, "-=0.2");
          }
          return () => cleanups.forEach((fn) => fn());
        }
        // The scroll drives this pane on wide screens, so the phone toggle's choice is dropped.
        setHowFace("merchant");
        section.dataset.crank = "on";
        gsap.utils.toArray<HTMLElement>("[data-step]", section).forEach((el, i) =>
          ScrollTrigger.create({
            trigger: el,
            start: "top 55%",
            end: "bottom 55%",
            onToggle: (self) => {
              if (!self.isActive) return;
              setStep(i);
              if (!motion) gsap.set(how, { rotationY: i === 3 ? 180 : 0 });
            },
          }),
        );

        // One scrubbed timeline over the four steps etches the record, cracks and outlines it, holds for
        // the draft, then turns the pane to the buyer's side.
        if (motion) {
          const front = how.querySelector('[data-side="merchant"]')!;
          gsap
            .timeline({ scrollTrigger: { trigger: "#how-steps", start: "top 60%", end: "bottom 75%", scrub: 0.8 }, defaults: { ease: "none" } })
            .fromTo(front.querySelectorAll("[data-etch]"), { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", stagger: 0.12, duration: 0.5 })
            .fromTo(front.querySelector(".crack path"), { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.5 })
            .fromTo(front.querySelector(".gl-mark-missing"), { "--outline": 0 }, { "--outline": 1, duration: 0.4 }, "<")
            .to({}, { duration: 0.9 })
            .fromTo(how, { rotationY: 0, "--spec": "0%" }, { rotationY: 180, "--spec": "100%", duration: 1, ease: "power2.inOut" });
        }

        return () => {
          cleanups.forEach((fn) => fn());
          delete section.dataset.crank;
          setStep(0);
        };
        },
      );
    },
    { scope: root },
  );

  // Skipping starts the lift, so the page still arrives rather than snapping in.
  const skipIntro = () => {
    const tl = introTl.current;
    if (tl && tl.paused()) tl.play();
  };
  useEffect(() => {
    if (intro !== "on") return;
    document.addEventListener("keydown", skipIntro);
    // If the browser never starts the video (and so never ends it), the page still arrives after the reel's length.
    const cap = window.setTimeout(skipIntro, 16000);
    return () => {
      document.removeEventListener("keydown", skipIntro);
      window.clearTimeout(cap);
    };
  }, [intro]);

  const turn = (el: HTMLDivElement | null, side: Side) =>
    gsap.to(el, { rotationY: side === "buyer" ? 180 : 0, "--spec": side === "buyer" ? "100%" : "0%", duration: reduced() ? 0 : 0.9, ease: "expo.inOut", overwrite: true });
  const turnHero = contextSafe((side: Side) => {
    setHeroFace(side);
    turn(heroTurn.current, side);
  });
  const turnHow = contextSafe((side: Side) => {
    setHowFace(side);
    turn(howTurn.current, side);
  });

  return (
    <div className="landing lattice" id="top" ref={root} data-intro={intro === "off" ? undefined : ""}>
      {intro === "on" && <Intro onSkip={skipIntro} />}
      <a href="#main" className="sr-only rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-10">
        Skip to content
      </a>
      <Header onSignIn={onSignIn} active={active} />
      <main id="main">
        <Hero onSignIn={onSignIn} face={heroFace} onFace={turnHero} turnRef={heroTurn} />
        <Numbers />
        <Showcase />
        <HowItWorks step={step} turnRef={howTurn} face={howFace} onFace={turnHow} />
        <Roles />
        <Engine />
        <Safeguards />
        <Questions />
        <Close onSignIn={onSignIn} />
      </main>
      <Footer />
    </div>
  );
}
