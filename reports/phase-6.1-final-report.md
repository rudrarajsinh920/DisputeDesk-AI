# DisputeDesk AI — Phase 6.1: Visual Sign-off and Fixes

The evidence intelligence layer for payment disputes.

- Date: Nov 6, 2026
- Commit audited: `4346fd0` on `master`
- Fixes applied after approval: `a34db75` (local commit, not pushed; `master` is 2 ahead of `origin/master`)
- No PayPal or Gemini calls: the data source stayed on demo, and no AI button was clicked. Nothing was installed or deployed.
- Screenshots: 37 before the fixes and 3 after them (38–40), all in `reports/visual-qa/`.

## Summary

| Scope | At audit (`4346fd0`) | After fixes (`a34db75`) |
|---|---|---|
| Desktop and laptop (1440, 1024), light and dark | PASS | PASS |
| Tablet (768) | PASS | PASS |
| Phone (375, 320) | PARTIAL: the menu filled the first screen | PASS: the menu is one row and the figures sit two to a row; the first dispute is still below the fold |
| Dark theme | PARTIAL: secondary buttons hard to see | PASS: own fill and a 3.6:1 edge |
| Check my edits | PASS, with a Medium wording issue | PASS: one plain sentence per reason, the merchant's own paragraphs numbered |
| Product messaging | PASS | PASS |
| Critical or High defects | None | None |
| Medium defects open | 3 (D1, D2, D3) | 0 |
| Low defects open | 7 | 5 (D4, D5, D6, D8, D9), all optional |

**Final visual sign-off: PASS.** Desktop, tablet, phone and both themes are ready for the demo video.

## 1. Git baseline and checks

| Check | At audit | After fixes |
|---|---|---|
| Branch | `master` | `master` |
| HEAD | `4346fd0` Wrap the admin menu, flag refund IDs in the list and test complete evidence | `a34db75` Fix dark buttons, phone menu and edit-check wording from visual sign-off |
| Ahead of `origin/master` | 1 | 2 (not pushed) |
| P0 `7ba49a1`, P1 `f08ba14`, `4346fd0` in history | All present | All present |
| Server tests | 189 of 189 PASS | 189 of 189 PASS (edit-check test extended) |
| Client tests | 85 of 85 PASS | 85 of 85 PASS (Check my edits test extended) |
| Typecheck (server, client) | PASS | PASS |
| Production build | PASS | PASS |
| Secret scan of the staged diff | — | No matches |
| Untracked, preserved | `reports/demo-video-script.md`, `reports/devpost-description.md`, `reports/disputedesk-audit.pdf`, `reports/phase-0.2-validation-report.md` | Same, plus `reports/phase-6.1-visual-signoff.md`, `reports/visual-qa/` and this report |

Dev servers: client `vite` (5173) and server `node src/index.ts` (3001), from `.claude/launch.json`. The repo has no
screenshot tooling (no Playwright or Puppeteer); screenshots came from the Claude desktop browser pane.

## 2. Capabilities used

| Capability | Installed | Used for |
|---|---|---|
| Impeccable (`audit.md`) | Yes | Audit dimensions and severity scale. Its detector engine is not downloaded; fetching it would be an install, so it was not run. |
| Taste (`app-screens.md`) | Yes | App-screen review questions and phone rules |
| Vercel Web Interface Guidelines | Yes | Visual checklist: focus, overflow, truncation, numbers, dark mode |
| Emil design engineering | Yes | Button feedback and motion notes |
| UI UX Pro Max | Yes | Not needed; the other guides covered the audit |
| GSAP | Yes | Not relevant: no animation work |
| Claude browser pane | Yes | Running the app, screenshots, layout checks |

## 3. Visual review by module (at audit)

### Merchant workspace

| Item | Result | Screenshot | Notes |
|---|---|---|---|
| Dashboard | PASS | 01, 08 | Clear title, three KPI tiles, list beside detail |
| List readiness | PASS | 01, 31 | "Key evidence 1 of 2 · 1 conflict", "Evidence 4 of 4 · refund ID needed" |
| Dispute detail | PASS | 01 | Sticky header with in-page tabs |
| Readiness summary | PASS | 02, 06 | Four counts plus "This is not a score and does not predict the outcome" |
| Claim and records | PASS | 02, 09 | Buyer's claim, what the records show and what they leave out, in three columns |
| Evidence and citations | PASS | 04, 32 | Status pill, key label and a "Based on:" record path for each item |
| Draft and review notice | PASS | 03 | "Draft only. It requires merchant review, is never sent to PayPal" |
| Check my edits | PASS, wording issue (D3, now fixed) | 05, 10, 38 | Flags work |
| Insights | PASS | 11, 12, 13 | Counts and dispute IDs, with a limitation on every suggestion |
| Empty state | PASS | 37 | "No disputes with this status." |
| Loading state | PASS | 07 | "Analyzing evidence…" |

### Buyer experience

| Item | Result | Screenshot | Notes |
|---|---|---|---|
| Dashboard | PASS | 14, 16, 35 | Two disputes, each with its status and usual stage |
| Dispute detail | PASS | 14, 36 | Amount, reason and opened date, each tagged "From the record" |
| Timeline and next steps | PASS | 14, 15 | "The usual order of a dispute, not a recorded history" |
| Source labels and guidance | PASS | 14, 36 | Key: from the record, general guidance, not on record |
| Separation from merchant data | PASS | 14, 15 | No order, tracking, evidence, buyer message or draft on any buyer screen |

### Admin platform

| Item | Result | Screenshot | Notes |
|---|---|---|---|
| Overview | PASS | 17, 24, 28 | "Admin · read-only" eyebrow and a read-only badge |
| Dispute management | PASS | 18, 27 | Account filter and the owner on each row |
| Merchants and buyers | PASS | 19, 20 | Email, account ID and disputes reached; no hashes |
| Audit logs | PASS | 21, 25, 29, 34 | Stacks into labelled rows on a phone |
| System health | PASS | 22 | Says the health check does not contact PayPal or Gemini |
| Admin settings | PASS | 23, 26 | Read-only limits |

### Product messaging

| Question | Result | Evidence |
|---|---|---|
| Readiness looks like a measurement, not a win score | PASS | "0 of 2" counts and a "not a score" line (02); no percentages or gauges |
| Conflicting evidence is visually distinct | PASS | Red tile and red "Records disagree" note (06, 09); missing items are amber |
| Missing evidence is explained fairly | PASS | "Missing from the records does not show that it did not happen" (02, 04) |
| Buyer content stays separate from merchant evidence | PASS | 14, 15, 36 |
| Synthetic demo data is labelled | PASS | Banner on every data page, "Demo dispute" on each detail |
| Merchant control and human review | PASS | Draft notice and "never edits or blocks your text" (03, 05) |

## 4. Light and dark, responsive

| Area | Light | Dark at audit | Dark after fixes |
|---|---|---|---|
| Surfaces, text, status colours, demo banner, primary buttons, KPI tiles | PASS | PASS | PASS |
| Secondary buttons | PASS | Medium defect: panel fill and a 1.2:1 border (D1) | PASS: `--surface-2` fill and a `#6b726a` edge, 3.6:1 against the panel (38) |

| Width | At audit | After fixes |
|---|---|---|
| 1440 | PASS | PASS; sidebar labels 12px |
| 1024 | PASS; the menu scrolls on its own at 768px tall (D6) | Unchanged (D6 open) |
| 768 | PASS; the menu is a top bar of two rows | PASS; the menu is one row |
| 375 | PARTIAL; first dispute at 1122px on an 812px screen (Merchant C) | PASS; one menu row, two figures per row (39). First dispute at 989px (Merchant A, which also has the data-source switch) |
| 320 | PARTIAL; the admin menu filled the first screen (33) | PASS; the admin menu is one row (40); page width 320, no sideways scroll |

## 5. Defects and what happened to them

| ID | Problem | Severity | Status |
|---|---|---|---|
| D1 | Dark secondary buttons matched the panel fill, with a 1.2:1 border | Medium | **Fixed**: new `--control-line` dark token, `--surface-2` fill and a lighter edge on hover |
| D2 | On phones the menu, account row and stacked KPI tiles filled the first screen | Medium | **Fixed**: below 1024px the views sit on one row that scrolls sideways (scrollbar hidden); below 640px the figures sit two to a row, and with an odd count the first takes the whole row |
| D3 | Check my edits reasons ran as one technical semicolon list; "Paragraph 8" counted the whole draft | Medium | **Fixed**: each reason is a plain sentence on its own line ("Names a carrier. No carrier is in DisputeDesk's records."), and paragraphs are numbered among the merchant's own ("Your paragraph 1"). The AI checks keep their wording. |
| D4 | Record paths and codes break mid-word | Low | Open, optional |
| D5 | Admin settings: the Audit log card sits alone in its row | Low, subjective | Open, optional |
| D6 | The menu scrolls at 1024×768, with Sign out below the fold | Low | Open, optional |
| D7 | Sidebar group labels were 11px | Low | **Fixed**: 12px |
| D8 | Long KPI values wrap | Low, subjective | Open, optional |
| D9 | The first KPI tile is always lime | Low, subjective | Open, optional |
| D10 | The audit "Dispute" label was 12.9px; the others were 14px | Low | **Fixed**: every stacked-table label is a fixed 14px (measured: Time, Event, Account, Dispute and Detail are all 14px) |

## 6. Fixes applied (`a34db75`)

| File | Change |
|---|---|
| `client/src/styles.css` | Dark `--control-line` token and secondary button rule (D1); one-row phone menu below 1024px and two-column figures below 640px (D2); one line per reason (D3); 12px sidebar labels (D7); fixed 14px stacked labels (D10) |
| `server/src/assist.ts` | `forMerchant()` rewords each edit-check reason for the merchant; flags are numbered by the merchant's own paragraphs |
| `client/src/AnalysisPanel.tsx` | "Your paragraph N"; reasons as a list |
| `server/src/app.test.ts` | Flags are numbered 1 and 2 among the merchant's own paragraphs; every reason is one sentence with no "supplied" wording |
| `client/src/ui.test.ts` | Each reason renders as its own list item; new label text |

Checked in the browser after the server restart:

- Dark buttons measured `rgb(29, 33, 30)` fill and `rgb(107, 114, 106)` border.
- Check my edits showed "Your paragraph 1" and "Your paragraph 2", with one reason per line.
- Page width is 320 at 320px and 375 at 375px.
- Desktop rail labels are 12px, and the light theme is unchanged.

## 7. Accessibility

- Body text contrast passes in both themes.
- Dark secondary button edges now meet 3:1 (WCAG 1.4.11).
- Status never relies on colour alone: every status has a word.
- Labels are 12px or larger everywhere checked.

## 8. Not tested

| Item | Reason |
|---|---|
| AI-assisted draft and buyer AI explanation output | Would call Gemini |
| PayPal sandbox data source | Would call PayPal |
| Error state | Would need the server stopped or changed |
| Keyboard focus, screen reader, real phones, 200% text zoom | Outside this pass |
| The sideways-scrolling phone menu with a keyboard or on a real phone | Its scrollbar is hidden; a cut-off last item is the only sign it scrolls |
| Buyer at 768 and 1024, merchant at 768 | Covered only by the earlier scripted checks |

## 9. Screenshot inventory (`reports/visual-qa/`)

| # | Module | Page | Theme | Width |
|---|---|---|---|---|
| 01 | Merchant | Dashboard, list, detail | Light | 1440 |
| 02 | Merchant | Readiness, claim and records | Light | 1440 |
| 03 | Merchant | Contradictions, next steps, draft, review notice | Light | 1440 |
| 04 | Merchant | Evidence analysis, record citations | Light | 1440 |
| 05 | Merchant | Check my edits (before fix) | Light | 1440 |
| 06 | Merchant | Conflict (DEMO-1002) | Light | 1440 |
| 07 | Merchant | Loading state | Dark | 1440 |
| 08 | Merchant | Dashboard | Dark | 1440 |
| 09 | Merchant | Conflict, claim and records | Dark | 1440 |
| 10 | Merchant | Check my edits (before fix) | Dark | 1440 |
| 11 | Merchant | Insights | Light | 1440 |
| 12 | Merchant | Insights | Dark | 1440 |
| 13 | Merchant | Insights suggestions | Dark | 1440 |
| 14 | Buyer | Dashboard, detail, stages | Light | 1440 |
| 15 | Buyer | Next steps, guidance, not on record | Light | 1440 |
| 16 | Buyer | Dashboard, detail | Dark | 1440 |
| 17 | Admin | Overview | Dark | 1440 |
| 18 | Admin | Dispute management | Dark | 1440 |
| 19 | Admin | Merchants | Dark | 1440 |
| 20 | Admin | Buyers | Dark | 1440 |
| 21 | Admin | Audit logs | Dark | 1440 |
| 22 | Admin | System health | Dark | 1440 |
| 23 | Admin | Admin settings | Dark | 1440 |
| 24 | Admin | Overview | Light | 1440 |
| 25 | Admin | Audit logs | Light | 1440 |
| 26 | Admin | Admin settings | Light | 1440 |
| 27 | Admin | Dispute management | Light | 1024 |
| 28 | Admin | Overview | Dark | 768 |
| 29 | Admin | Audit logs | Dark | 768 |
| 30 | Merchant | Dashboard (before fix) | Light | 375 |
| 31 | Merchant | List readiness, refund ID note | Light | 375 |
| 32 | Merchant | Evidence analysis (DEMO-2004) | Light | 375 |
| 33 | Admin | Menu (before fix) | Dark | 320 |
| 34 | Admin | Audit log as stacked rows | Dark | 320 |
| 35 | Buyer | Dashboard list | Dark | 320 |
| 36 | Buyer | Source labels, detail | Dark | 320 |
| 37 | Merchant | Empty list state | Light | 1440 |
| 38 | Merchant | Check my edits and dark buttons (after fix) | Dark | 1440 |
| 39 | Merchant | Dashboard, one-row menu, two-column figures (after fix) | Light | 375 |
| 40 | Admin | One-row menu (after fix) | Dark | 320 |

The filenames start with the number, e.g. `38-after-check-my-edits-1440-dark.jpg`.

## 10. Next

- Push `master` when ready (2 local commits).
- Optional polish: D4, D5, D6, D8, D9.
- Before the demo video: one keyboard pass and one real-phone pass.
