import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ArrowRight, Check, Menu, X } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

// Signed-out landing page. Static copy only: it fetches nothing and holds no demo records (those reach the browser
// only through the server, after sign-in). Every product fragment here is illustrative and labelled so.

type Status = "available" | "unverified" | "missing";
const STATUS: Record<Status, { word: string; className: string }> = {
  available: { word: "Available", className: "bg-ok text-ok-foreground" },
  unverified: { word: "Unverified", className: "bg-warn text-warn-foreground" },
  missing: { word: "Missing", className: "bg-gap text-gap-foreground" },
};

function Chip({ status }: { status: Status }) {
  return <Badge className={cn("rounded-md border-transparent font-medium", STATUS[status].className)}>{STATUS[status].word}</Badge>;
}

// The four evidence items the engine checks on every dispute, with the engine's own labels.
const EVIDENCE: { label: string; status: Status; note: string }[] = [
  { label: "Order confirmation", status: "available", note: "On record." },
  { label: "Shipping tracking", status: "unverified", note: "On record, but another record disagrees." },
  { label: "Proof of delivery", status: "missing", note: "Not in the records. That alone doesn't show it didn't happen." },
  { label: "Customer communication", status: "available", note: "On record." },
];

const LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#roles", label: "Who it’s for" },
  { href: "#safeguards", label: "Safeguards" },
  { href: "#faq", label: "Questions" },
];

// A product fragment: always a figure, always labelled illustrative.
function Fragment({ label, title, sub, children, className }: { label: string; title: string; sub?: string; children: ReactNode; className?: string }) {
  return (
    <figure data-ui aria-label={label} className={cn("rounded-xl border bg-card text-card-foreground", className)}>
      <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{title}</p>
          {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
        </div>
        <Badge variant="outline" className="shrink-0 rounded-md text-muted-foreground">
          Illustrative example
        </Badge>
      </div>
      {children}
    </figure>
  );
}

function EvidenceRows({ notes }: { notes?: boolean }) {
  return (
    <ul className="divide-y">
      {EVIDENCE.map((e) => (
        <li key={e.label} className="flex items-start justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">{e.label}</p>
            {notes && <p className="text-xs text-muted-foreground">{e.note}</p>}
          </div>
          <Chip status={e.status} />
        </li>
      ))}
    </ul>
  );
}

function SignIn({ onSignIn, className, children = "Sign in", variant }: { onSignIn: () => void; className?: string; children?: string; variant?: "default" | "outline" }) {
  return (
    <Button type="button" variant={variant} onClick={onSignIn} className={cn("active:scale-[0.97] transition-[transform,background-color]", className)}>
      {children}
    </Button>
  );
}

function Header({ onSignIn }: { onSignIn: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="mx-auto flex w-full max-w-[88rem] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-4 md:px-8 lg:px-16">
      <a href="#top" className="flex items-center gap-2 text-base font-semibold tracking-tight" translate="no">
        <span aria-hidden="true" className="grid size-7 place-items-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
          DD
        </span>
        DisputeDesk
      </a>
      <div className="flex items-center gap-2 md:order-last">
        <SignIn onSignIn={onSignIn} variant="outline" className="h-10 md:h-9" />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-10 md:hidden"
          aria-expanded={open}
          aria-controls="l-nav"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </Button>
      </div>
      <nav id="l-nav" aria-label="Sections" className={cn("w-full md:flex md:w-auto", open ? "block" : "hidden")}>
        <ul className="flex flex-col gap-1 md:flex-row md:gap-6">
          {LINKS.map((l) => (
            <li key={l.href}>
              <a
                href={l.href}
                onClick={() => setOpen(false)}
                className="block rounded-md py-2 text-sm text-muted-foreground transition-colors hover:text-foreground md:py-0"
              >
                {l.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}

const FACTS = ["Read-only with PayPal", "A person reviews every draft", "Synthetic demo data, labelled"];

function Hero({ onSignIn }: { onSignIn: () => void }) {
  return (
    <section aria-labelledby="hero-h" className="px-2 md:px-4">
      <div className="mx-auto grid max-w-[88rem] gap-12 rounded-3xl bg-band px-6 py-14 text-band-foreground md:px-12 md:py-20 lg:grid-cols-12 lg:gap-8 lg:py-24">
        <div className="flex flex-col justify-center lg:col-span-6">
          <h1 id="hero-h" className="motion-safe:animate-rise text-[2.6rem] leading-[1.02] font-semibold tracking-[-0.035em] sm:text-6xl lg:text-[4.5rem]">
            Every dispute, checked against the record.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-band-muted motion-safe:animate-rise motion-safe:[animation-delay:90ms]">
            DisputeDesk reviews PayPal disputes for merchants and buyers. It shows the same facts to both sides, marks gaps as gaps, and leaves every decision to a person.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3 motion-safe:animate-rise motion-safe:[animation-delay:160ms]">
            <SignIn onSignIn={onSignIn} className="h-11 bg-signal px-5 text-signal-foreground hover:bg-signal/90">
              Sign in to the demo
            </SignIn>
            <a href="#how" className="inline-flex h-11 items-center gap-2 rounded-md px-4 text-sm font-medium text-band-foreground transition-colors hover:bg-white/10">
              See how it works <ArrowRight aria-hidden="true" className="size-4" />
            </a>
          </div>
          <ul className="mt-10 flex flex-col gap-2 text-sm text-band-muted sm:flex-row sm:flex-wrap sm:gap-x-6">
            {FACTS.map((f) => (
              <li key={f} className="flex items-center gap-2">
                <Check aria-hidden="true" className="size-4 text-signal" />
                {f}
              </li>
            ))}
          </ul>
        </div>
        <div className="lg:col-span-6 lg:pl-6">
          <Fragment label="Illustrative example of a checked dispute" title="Item not received" sub="Awaiting seller · example dispute" className="border-band-border shadow-2xl">
            <EvidenceRows notes />
            <div className="m-4 rounded-lg bg-warn px-3 py-2.5 text-sm text-warn-foreground">
              <p className="font-semibold">Records disagree</p>
              <p>The shipping status says delivered, but no proof of delivery is on record.</p>
            </div>
            <p className="border-t px-4 py-3 text-sm text-muted-foreground">Next step: add proof of delivery from a carrier record, if you have one.</p>
          </Fragment>
        </div>
      </div>
    </section>
  );
}

function SectionHead({ id, title, lead }: { id: string; title: string; lead: string }) {
  return (
    <div className="grid gap-4 md:grid-cols-12 md:gap-8">
      <h2 id={id} className="text-3xl leading-[1.08] font-semibold tracking-[-0.03em] md:col-span-6 md:text-5xl">
        {title}
      </h2>
      <p className="max-w-xl text-lg text-muted-foreground md:col-span-5 md:col-start-8 md:self-end">{lead}</p>
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
    <Fragment label="Illustrative example of a checked draft" title="Response draft" sub={drafted ? "Drafted · waiting for your review" : "Evidence checked"}>
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
          <Button ref={againButton} type="button" size="sm" variant="outline" onClick={() => toggle(false)} className="h-10 active:scale-[0.97] md:h-8">
            Start again
          </Button>
        ) : (
          <Button ref={draftButton} type="button" size="sm" onClick={() => toggle(true)} className="h-10 active:scale-[0.97] md:h-8">
            Draft a response
          </Button>
        )}
      </div>
    </Fragment>
  );
}

const STEPS: { step: string; title: string; body: string; fragment: ReactNode }[] = [
  {
    step: "Step 1",
    title: "Check every record",
    body: "Fixed rules read the order, shipping, delivery and message records, then mark each one available, unverified or missing.",
    fragment: (
      <Fragment label="Illustrative example of evidence statuses" title="Evidence" sub="4 items checked">
        <EvidenceRows />
      </Fragment>
    ),
  },
  {
    step: "Step 2",
    title: "Flag what disagrees",
    body: "Where two records contradict each other, DisputeDesk says so. A missing record is shown as a gap, never as proof.",
    fragment: (
      <Fragment label="Illustrative example of a contradiction" title="Contradictions" sub="1 found">
        <div className="space-y-3 px-4 py-4 text-sm">
          <div className="rounded-lg border px-3 py-2.5">
            <p className="text-xs text-muted-foreground">Shipping tracking</p>
            <p className="font-medium">Says delivered</p>
          </div>
          <div className="rounded-lg border border-dashed px-3 py-2.5">
            <p className="text-xs text-muted-foreground">Proof of delivery</p>
            <p className="font-medium">Not on record</p>
          </div>
          <p className="text-muted-foreground">Gap, not proof. Add a carrier record if you have one.</p>
        </div>
      </Fragment>
    ),
  },
  {
    step: "Step 3",
    title: "Draft, check, then you decide",
    body: "Gemini words a draft. The server checks every line against the records and drops what they don’t support. Try it.",
    fragment: <DraftFragment />,
  },
];

function HowItWorks() {
  return (
    <section id="how" aria-labelledby="how-h" className="mx-auto max-w-6xl px-4 py-24 md:px-8 md:py-32">
      <SectionHead id="how-h" title="From scattered records to a draft you can check." lead="Three steps, in the same order every time. The rules decide the facts; the AI only puts them into words." />
      <ol className="mt-14 grid gap-10 md:grid-cols-3 md:gap-6">
        {STEPS.map((s) => (
          <li key={s.step} className="flex flex-col gap-5">
            <div>
              <p className="text-sm font-medium text-muted-foreground">{s.step}</p>
              <h3 className="mt-1 text-xl font-semibold tracking-tight">{s.title}</h3>
              <p className="mt-2 text-muted-foreground">{s.body}</p>
            </div>
            {s.fragment}
          </li>
        ))}
      </ol>
    </section>
  );
}

const ROLES: { id: string; tab: string; title: string; body: string; points: string[]; fragment: ReactNode }[] = [
  {
    id: "merchants",
    tab: "Merchants",
    title: "Know what you can prove before you reply.",
    body: "See which evidence is on record, what is missing and where records disagree. Then review a checked draft before you send anything yourself.",
    points: ["Status for each evidence item", "Contradictions flagged", "Drafts that need your review"],
    fragment: (
      <Fragment label="Illustrative example of the merchant view" title="Item not received" sub="Awaiting seller · example dispute">
        <EvidenceRows />
      </Fragment>
    ),
  },
  {
    id: "buyers",
    tab: "Buyers",
    title: "Plain answers about where your dispute stands.",
    body: "Guidance built only from what a buyer can see: what the status means, the usual stages and what to have ready. Never the merchant’s evidence or drafts.",
    points: ["What the status means", "The usual stages", "What to have ready"],
    fragment: (
      <Fragment label="Illustrative example of the buyer view" title="Your dispute" sub="Awaiting seller">
        <ol className="space-y-1 px-4 py-4 text-sm">
          {["Opened", "Seller and buyer respond", "Payment provider review", "Closed"].map((stage, i) => (
            <li key={stage} className={cn("flex items-center justify-between rounded-md px-3 py-2", i === 1 ? "bg-signal font-medium text-signal-foreground" : "text-muted-foreground")}>
              {stage}
              {i === 1 && <span className="text-xs">Current status</span>}
            </li>
          ))}
        </ol>
      </Fragment>
    ),
  },
  {
    id: "insights",
    tab: "Insights",
    title: "Patterns across your disputes, counted.",
    body: "Fixed rules over the evidence checks: counts and dispute IDs only. No predictions, causes or averages.",
    points: ["Counts, not guesses", "The disputes behind each count", "For merchants and admin"],
    fragment: (
      <Fragment label="Illustrative example of an insight" title="Proof of delivery missing" sub="Across this account’s disputes">
        <div className="px-4 py-5">
          <p className="text-3xl font-semibold tracking-tight tabular-nums">6 of 7</p>
          <p className="text-sm text-muted-foreground">disputes have no proof of delivery on record</p>
          <div className="mt-4 h-2 rounded-full bg-muted" aria-hidden="true">
            <div className="h-2 w-6/7 rounded-full bg-foreground" />
          </div>
        </div>
      </Fragment>
    ),
  },
  {
    id: "admin",
    tab: "Admin",
    title: "Oversight that can’t change anything.",
    body: "Admin reads across accounts to check the work. It can’t draft, edit or send. One account never sees another’s disputes.",
    points: ["Read across accounts", "No drafting or editing", "Each account kept apart"],
    fragment: (
      <Fragment label="Illustrative example of the admin view" title="All accounts" sub="Read-only">
        <ul className="divide-y text-sm">
          {[
            ["Merchant account", "4 disputes"],
            ["Second merchant account", "2 disputes"],
            ["Buyer account", "2 disputes"],
          ].map(([name, count]) => (
            <li key={name} className="flex justify-between gap-4 px-4 py-3">
              <span>{name}</span>
              <span className="text-muted-foreground tabular-nums">{count}</span>
            </li>
          ))}
        </ul>
      </Fragment>
    ),
  },
];

function Roles() {
  return (
    <section id="roles" aria-labelledby="roles-h" className="border-y bg-card">
      <div className="mx-auto max-w-6xl px-4 py-24 md:px-8 md:py-32">
        <SectionHead id="roles-h" title="One set of facts, four views." lead="Each account sees only its own disputes, and only the parts its role needs." />
        <Tabs defaultValue="merchants" className="mt-12 gap-10">
          <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-muted p-1 sm:w-fit">
            {ROLES.map((r) => (
              <TabsTrigger key={r.id} value={r.id} className="h-10 flex-none px-4 md:h-9">
                {r.tab}
              </TabsTrigger>
            ))}
          </TabsList>
          {ROLES.map((r) => (
            <TabsContent key={r.id} value={r.id} className="grid gap-10 md:grid-cols-12 md:gap-8">
              <div className="md:col-span-5">
                <h3 className="text-2xl font-semibold tracking-tight">{r.title}</h3>
                <p className="mt-3 text-muted-foreground">{r.body}</p>
                <ul className="mt-6 space-y-2">
                  {r.points.map((p) => (
                    <li key={p} className="flex items-center gap-2 text-sm">
                      <Check aria-hidden="true" className="size-4 shrink-0" />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="md:col-span-6 md:col-start-7">{r.fragment}</div>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </section>
  );
}

const SAFEGUARDS: { title: string; body: string }[] = [
  { title: "The records decide", body: "Evidence statuses and contradictions come from fixed rules, not from the AI." },
  { title: "The AI only words", body: "Every AI line is checked against the records. Lines they don’t support are dropped." },
  { title: "No invented facts", body: "No made-up tracking numbers, carriers, dates, people, messages or delivery claims." },
  { title: "Gaps stay gaps", body: "A missing record is never treated as proof that something didn’t happen." },
  { title: "Read-only with PayPal", body: "DisputeDesk never submits responses, uploads evidence or changes a dispute." },
  { title: "Each account kept apart", body: "Another account’s dispute answers exactly like one that doesn’t exist." },
];

function Safeguards() {
  return (
    <section id="safeguards" aria-labelledby="safeguards-h" className="mx-auto max-w-6xl px-4 py-24 md:px-8 md:py-32">
      <SectionHead id="safeguards-h" title="What DisputeDesk will and won’t do." lead="These rules are built into the code, not just written on this page." />
      <ul className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SAFEGUARDS.map((s) => (
          <li key={s.title}>
            <Card className="h-full gap-2 py-6 shadow-none">
              <CardHeader>
                <h3 className="text-lg font-semibold tracking-tight">{s.title}</h3>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">{s.body}</p>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}

const FAQ: { q: string; a: string }[] = [
  { q: "Does DisputeDesk send anything to PayPal?", a: "No. It only reads dispute data. It never submits responses, uploads evidence or changes a dispute. You send any response yourself." },
  { q: "Is the data in the demo real?", a: "No. The demo uses synthetic disputes, labelled as demo data and kept apart from PayPal sandbox data." },
  { q: "What does the AI do?", a: "Gemini only puts the checked facts into words for explanations and drafts. The server checks each line against the records and drops anything they don’t support. The rule-based checks work without it." },
  { q: "Can a buyer see the merchant’s evidence?", a: "No. Buyers see only buyer-visible fields: never the order, the evidence, the merchant’s messages or drafts." },
  { q: "How do I try it?", a: "Sign in with one of the synthetic demo accounts listed in the project README: a merchant, a buyer or the read-only admin." },
];

function Questions() {
  return (
    <section id="faq" aria-labelledby="faq-h" className="mx-auto grid max-w-6xl gap-10 px-4 pb-24 md:grid-cols-12 md:gap-8 md:px-8 md:pb-32">
      <h2 id="faq-h" className="text-3xl leading-[1.08] font-semibold tracking-[-0.03em] md:col-span-4 md:text-5xl">
        Questions
      </h2>
      <Accordion type="single" collapsible className="border-t md:col-span-8">
        {FAQ.map((f, i) => (
          <AccordionItem key={f.q} value={`q${i}`}>
            <AccordionTrigger className="py-5 text-base">{f.q}</AccordionTrigger>
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
      <div className="mx-auto flex max-w-[88rem] flex-col items-start gap-8 rounded-3xl bg-signal px-6 py-16 text-signal-foreground md:flex-row md:items-end md:justify-between md:px-12 md:py-20">
        <div>
          <h2 id="close-h" className="max-w-3xl text-4xl leading-[1.04] font-semibold tracking-[-0.035em] md:text-6xl">
            See a dispute checked against its records.
          </h2>
          <p className="mt-4 max-w-xl text-lg">Sign in with a synthetic demo account to see the merchant, buyer and admin views.</p>
        </div>
        <SignIn onSignIn={onSignIn} className="h-11 shrink-0 bg-signal-foreground px-5 text-signal hover:bg-signal-foreground/90">
          Sign in to the demo
        </SignIn>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="mx-auto max-w-6xl px-4 py-12 md:px-8">
      <div className="flex flex-col gap-6 border-b pb-8 md:flex-row md:items-center md:justify-between">
        <p className="text-base font-semibold tracking-tight" translate="no">
          DisputeDesk
        </p>
        <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
          {LINKS.map((l) => (
            <li key={l.href}>
              <a href={l.href} className="transition-colors hover:text-foreground">
                {l.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-6 text-sm text-muted-foreground">
        Synthetic demo. Not affiliated with or endorsed by PayPal or Google. DisputeDesk never submits dispute responses.
      </p>
    </footer>
  );
}

export function Landing({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div className="landing" id="top">
      <a href="#main" className="sr-only rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-10">
        Skip to content
      </a>
      <Header onSignIn={onSignIn} />
      <main id="main">
        <Hero onSignIn={onSignIn} />
        <HowItWorks />
        <Roles />
        <Safeguards />
        <Questions />
        <Close onSignIn={onSignIn} />
      </main>
      <Footer />
    </div>
  );
}
