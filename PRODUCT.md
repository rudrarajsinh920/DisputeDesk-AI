# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Merchants and buyers in a PayPal payment dispute, served equally. Merchants (small online sellers) need to know which evidence they have, which is missing, and what a fair response says. Buyers need to understand where their dispute stands and what happens next, in plain language. Admins review the demo data read-only.

## Product Purpose

DisputeDesk AI makes payment disputes fairer and clearer. A rule-based evidence engine reads the records, marks each piece of evidence as present, missing or contradictory, and drafts a response a person must review. Gemini only rewords explanations; every AI line is checked against the records and invented facts are dropped. Success: both sides see the same facts, gaps stay marked as gaps, and a person makes every decision.

## Positioning

The same evidence for merchants and buyers, with deterministic rules as the source of truth and AI limited to wording. Missing evidence is never treated as proof that something didn't happen. Nothing is ever submitted to PayPal automatically.

## Operating Context

Merchants work a list of disputes, open one, read the evidence ledger (statuses with citations), and edit a draft that always carries a review warning. Buyers see their own disputes' status, a four-stage tracker and next steps. PayPal access is sandbox-only and read-only. Demo data is synthetic and labelled everywhere.

## Capabilities and Constraints

- Roles: merchant, buyer, admin (read-only). Every account sees only its own data.
- Evidence engine, buyer guidance and Insights are rule-based; counts and dispute IDs only, no invented percentages or predictions.
- No payments, checkout, fees or account settings exist. No live PayPal changes, no automatic submissions.
- Stack: React 19 + Vite, Tailwind + shadcn/ui on the landing page, plain CSS tokens in the app, strict CSP (`style-src 'self'`).

## Brand Commitments

Name: DisputeDesk AI (wordmark "DisputeDesk", mark "DD"). Voice: plain, calm, exact; says what is not known. Must not look like a generic AI startup (no purple gradients, glowing cards or floating blobs).

## Evidence on Hand

Synthetic demo disputes (`sample-dispute.json`, `demo-disputes.json`) and demo accounts (`demo-accounts.json`). There are no real customers, testimonials, press, usage numbers or benchmarks; future work must not invent any.

## Product Principles

1. Records first, wording second.
2. A gap is shown as a gap.
3. A person decides; the product never submits.
4. Both sides get the same facts.
5. Synthetic data is always labelled.

## Accessibility & Inclusion

WCAG AA contrast in light and dark, keyboard access with visible focus, 44px touch targets, and reduced-motion support for every animation.
