# DisputeDesk AI — Phase 6.1: Visual Sign-off Audit

The evidence intelligence layer for payment disputes.

- Audit date: Nov 6, 2026
- Commit audited: `4346fd0` on `master`
- Audit only: no source, CSS, token, API, backend, database or auth changes. Nothing installed, committed, pushed or deployed.
- No PayPal or Gemini calls: the data source stayed on demo, and no AI button was clicked.
- 37 screenshots of the running app, in `reports/visual-qa/`.

## Final visual sign-off: PARTIAL

| Scope | Result |
|---|---|
| Desktop and laptop (1440, 1024), light and dark | PASS |
| Tablet (768) | PASS |
| Phone (375, 320) | PARTIAL: works, but the menu fills the first screen |
| Dark theme | PARTIAL: secondary buttons hard to see |
| Product messaging (measurements not scores, conflicts, fair gaps, demo labels, human review, buyer separation) | PASS |
| Critical or High defects | None |

There are two Medium defects: secondary buttons in dark mode, and the phone menu pushing content below the first screen.
Both are small CSS fixes. Desktop is ready for the demo video now.

## 1. Git baseline

| Check | Result |
|---|---|
| Branch | `master` |
| HEAD | `4346fd0` Wrap the admin menu, flag refund IDs in the list and test complete evidence |
| Remote | Ahead of `origin/master` by 1 (`4346fd0` not pushed) |
| P0 `7ba49a1`, P1 `f08ba14`, fixes `4346fd0` | All present |
| Uncommitted changes to tracked files | None |
| Untracked, preserved | `reports/demo-video-script.md`, `reports/devpost-description.md`, `reports/disputedesk-audit.pdf`, `reports/phase-0.2-validation-report.md` |
| New in this audit | `reports/visual-qa/` (37 screenshots), this report |
| Server tests | 189 of 189 PASS |
| Client tests | 85 of 85 PASS |
| Typecheck (server, client) | PASS |
| Production build | PASS |
| Dev scripts | client `vite` (5173), server `node src/index.ts` (3001), from `.claude/launch.json` |
| Screenshot tooling in the repo | None (no Playwright or Puppeteer). Screenshots came from the Claude desktop browser pane. |

## 2. Capabilities used

| Capability | Installed | Used for |
|---|---|---|
| Impeccable (`audit.md`) | Yes | Audit dimensions and P0–P3 severity scale. Its detector engine is not downloaded; fetching it would be an install, so it was not run. |
| Taste (`app-screens.md`: check, phone, house rules) | Yes | App-screen review questions and phone rules |
| Vercel Web Interface Guidelines | Yes (skill fetches rules from GitHub) | Visual checklist: focus, overflow, truncation, numbers, dark mode |
| Emil design engineering | Yes | Button feedback and motion notes |
| UI UX Pro Max | Yes (Python 3.14 via `py -3`) | Not needed; the other guides covered the audit |
| GSAP | Yes | Not relevant: no animation work in this audit |
| Claude browser pane | Yes | Running the app, screenshots, layout checks |

## 3. Screenshot inventory

All files are in `reports/visual-qa/`. Screenshots of 1440 and 1024 widths are scaled down to fit the pane (about 800px wide).

| # | File | Module | Page | Theme | Width |
|---|---|---|---|---|---|
| 01 | `01-merchant-dashboard-1440-light.jpg` | Merchant | Dashboard, list, detail | Light | 1440 |
| 02 | `02-merchant-readiness-claim-1440-light.jpg` | Merchant | Readiness, claim and records | Light | 1440 |
| 03 | `03-merchant-next-steps-draft-1440-light.jpg` | Merchant | Contradictions, next steps, draft, review notice | Light | 1440 |
| 04 | `04-merchant-evidence-citations-1440-light.jpg` | Merchant | Evidence analysis, record citations | Light | 1440 |
| 05 | `05-merchant-check-my-edits-1440-light.jpg` | Merchant | Check my edits result | Light | 1440 |
| 06 | `06-merchant-conflict-demo-1002-1440-light.jpg` | Merchant | Conflict (DEMO-1002) | Light | 1440 |
| 07 | `07-merchant-loading-1440-dark.jpg` | Merchant | Loading state | Dark | 1440 |
| 08 | `08-merchant-dashboard-1440-dark.jpg` | Merchant | Dashboard | Dark | 1440 |
| 09 | `09-merchant-conflict-demo-1002-1440-dark.jpg` | Merchant | Conflict, claim and records | Dark | 1440 |
| 10 | `10-merchant-check-my-edits-1440-dark.jpg` | Merchant | Check my edits result | Dark | 1440 |
| 11 | `11-merchant-insights-1440-light.jpg` | Merchant | Insights | Light | 1440 |
| 12 | `12-merchant-insights-1440-dark.jpg` | Merchant | Insights | Dark | 1440 |
| 13 | `13-merchant-insights-suggestions-1440-dark.jpg` | Merchant | Insights suggestions | Dark | 1440 |
| 14 | `14-buyer-dashboard-detail-1440-light.jpg` | Buyer | Dashboard, detail, stages | Light | 1440 |
| 15 | `15-buyer-next-steps-guidance-1440-light.jpg` | Buyer | Next steps, guidance, not on record | Light | 1440 |
| 16 | `16-buyer-dashboard-detail-1440-dark.jpg` | Buyer | Dashboard, detail | Dark | 1440 |
| 17 | `17-admin-overview-1440-dark.jpg` | Admin | Overview | Dark | 1440 |
| 18 | `18-admin-disputes-1440-dark.jpg` | Admin | Dispute management | Dark | 1440 |
| 19 | `19-admin-merchants-1440-dark.jpg` | Admin | Merchants | Dark | 1440 |
| 20 | `20-admin-buyers-1440-dark.jpg` | Admin | Buyers | Dark | 1440 |
| 21 | `21-admin-audit-logs-1440-dark.jpg` | Admin | Audit logs | Dark | 1440 |
| 22 | `22-admin-system-health-1440-dark.jpg` | Admin | System health | Dark | 1440 |
| 23 | `23-admin-settings-1440-dark.jpg` | Admin | Admin settings | Dark | 1440 |
| 24 | `24-admin-overview-1440-light.jpg` | Admin | Overview | Light | 1440 |
| 25 | `25-admin-audit-logs-1440-light.jpg` | Admin | Audit logs | Light | 1440 |
| 26 | `26-admin-settings-1440-light.jpg` | Admin | Admin settings | Light | 1440 |
| 27 | `27-admin-disputes-1024-light.jpg` | Admin | Dispute management | Light | 1024 |
| 28 | `28-admin-overview-768-dark.jpg` | Admin | Overview | Dark | 768 |
| 29 | `29-admin-audit-logs-768-dark.jpg` | Admin | Audit logs | Dark | 768 |
| 30 | `30-merchant-dashboard-375-light.jpg` | Merchant | Dashboard | Light | 375 |
| 31 | `31-merchant-list-readiness-refund-375-light.jpg` | Merchant | List readiness, refund ID note | Light | 375 |
| 32 | `32-merchant-evidence-375-light.jpg` | Merchant | Evidence analysis (DEMO-2004) | Light | 375 |
| 33 | `33-admin-nav-320-dark.jpg` | Admin | Menu after the wrap fix | Dark | 320 |
| 34 | `34-admin-audit-stacked-320-dark.jpg` | Admin | Audit log as stacked rows | Dark | 320 |
| 35 | `35-buyer-list-320-dark.jpg` | Buyer | Dashboard list | Dark | 320 |
| 36 | `36-buyer-detail-source-labels-320-dark.jpg` | Buyer | Source labels, detail | Dark | 320 |
| 37 | `37-merchant-empty-filter-1440-light.jpg` | Merchant | Empty list state | Light | 1440 |

Most important screens: 02, 06, 05, 14, 15, 21, 33.

## 4. Visual review by module

### Merchant workspace

| Item | Result | Screenshot | Notes |
|---|---|---|---|
| Dashboard | PASS | 01, 08 | Clear title, three KPI tiles, list beside detail |
| List readiness | PASS | 01, 31 | Plain words: "Key evidence 1 of 2 · 1 conflict", "Evidence 4 of 4 · refund ID needed" |
| Dispute detail | PASS | 01 | Sticky header with in-page tabs; tabs land with the heading visible |
| Readiness summary | PASS | 02, 06 | Four counts plus "This is not a score and does not predict the outcome" |
| Claim and records | PASS | 02, 09 | Buyer's claim, what records show, what they leave out, in three columns |
| Evidence and citations | PASS | 04, 32 | Status pill, key label, "Based on:" record path for each item |
| Draft and review notice | PASS | 03 | "Draft only. It requires merchant review, is never sent to PayPal" |
| Check my edits | PASS, with a Medium wording issue | 05, 10 | Flags work; reasons are one long run of technical text (D3) |
| Insights | PASS | 11, 12, 13 | Counts and dispute IDs, a limitation on every suggestion |
| Empty state | PASS | 37 | "No disputes with this status." and "Select a dispute to see its details." |
| Loading state | PASS | 07 | "Analyzing evidence…" while the detail loads |

### Buyer experience

| Item | Result | Screenshot | Notes |
|---|---|---|---|
| Dashboard | PASS | 14, 16, 35 | Two disputes, status and usual stage |
| Dispute detail | PASS | 14, 36 | Amount, reason, opened date, each tagged "From the record" |
| Timeline and next steps | PASS | 14, 15 | Stage track says "The usual order of a dispute, not a recorded history" |
| Source labels and guidance | PASS | 14, 36 | Key at the top: from the record, general guidance, not on record |
| Separation from merchant data | PASS | 14, 15 | No order, tracking, evidence, buyer message or draft on any buyer screen |

### Admin platform

| Item | Result | Screenshot | Notes |
|---|---|---|---|
| Overview | PASS | 17, 24, 28 | "Admin · read-only" eyebrow and a read-only access badge in the menu |
| Dispute management | PASS | 18, 27 | Account filter, owner on each row |
| Merchants and buyers | PASS | 19, 20 | Email, account ID, disputes reached; no hashes |
| Audit logs | PASS | 21, 25, 29, 34 | Time, event, account, dispute, detail; stacks into labelled rows on a phone |
| System health | PASS | 22 | Says asking does not contact PayPal or Gemini |
| Admin settings | PASS | 23, 26 | Read-only limits in four cards, plus an audit log card |

### Product messaging (special attention items)

| Question | Result | Evidence |
|---|---|---|
| Readiness looks like a measurement, not a win score | PASS | "0 of 2" counts and a "not a score" line (02); no percentages or gauges |
| Conflicting evidence is visually distinct | PASS | Red tile and red "Records disagree" note (06, 09); missing items are amber instead |
| Missing evidence is explained fairly | PASS | "Missing from the records does not show that it did not happen" (02, 04) |
| Buyer content stays separate from merchant evidence | PASS | 14, 15, 36 |
| Synthetic demo data is labelled | PASS | Banner on every data page, "Demo dispute" on each detail (01, 14, 17) |
| Merchant control and human review | PASS | Draft notice, "a draft only you can send", "never edits or blocks your text" (03, 05) |

## 5. Light and dark comparison

| Area | Light | Dark | Difference |
|---|---|---|---|
| Surfaces and text | PASS | PASS | Same layout, true neutral darks, readable body text |
| Status colours (available, missing, conflict) | PASS | PASS | Same meaning in both themes (06 vs 09) |
| Demo banner | PASS | PASS | Amber in both |
| Primary (lime) buttons | PASS | PASS | Same |
| Secondary buttons | PASS | **Medium defect** | In dark they have the panel's own fill and a 1.2:1 border, so they look like plain text (10, D1) |
| KPI tiles | PASS | PASS | Same |

## 6. Responsive review

| Width | Merchant | Buyer | Admin | Notes |
|---|---|---|---|---|
| 1440 | PASS | PASS | PASS | List and detail side by side |
| 1024 | PASS | — | PASS | One column. Menu panel scrolls on its own at 768px tall (27, D6) |
| 768 | — | — | PASS | Menu becomes a top bar of two rows (28) |
| 375 | PARTIAL | — | — | Header and three stacked KPI tiles push the first dispute to 1122px on an 812px screen (30, D2) |
| 320 | — | PASS | PARTIAL | Admin menu now wraps with no sideways scroll (33). It fills the first screen (D2) |

No page scrolls sideways at any width. "—" means no screenshot at that width; the earlier scripted checks (Phase 0.2) passed there.

## 7. Accessibility observations

- Body text contrast passes in both themes (scripted check in Phase 0.2 and visual review here).
- Dark secondary button border is about 1.2:1 against its panel (WCAG 1.4.11 asks 3:1 for the part that shows a control; D1).
- Status never relies on colour alone: every status has a word ("Available", "Missing", "Records disagree").
- Long record paths and reason codes break mid-word (D4), which a screen reader does not mind but sighted readers may.
- 11px sidebar group labels (D7).
- Not checked: keyboard focus rings, screen reader output, real touch devices, text zoom at 200%.

## 8. Defect list

| ID | Screenshot | Page and theme | Width | Problem | Severity | Type | Minimal correction |
|---|---|---|---|---|---|---|---|
| D1 | `10-merchant-check-my-edits-1440-dark.jpg` | Merchant draft and others, dark | All | Secondary buttons ("Reset to generated draft", "Check my edits", "Show a validation example", "Refresh") have the same fill as the panel (#151816) and a #252925 border (about 1.2:1), so they read as plain text | Medium | Genuine | In the dark theme, give `.button-secondary` a `--surface-2` fill or a stronger border token |
| D2 | `30-merchant-dashboard-375-light.jpg`, `33-admin-nav-320-dark.jpg` | Merchant, admin, buyer, both | 375, 320 | The full menu, account row and stacked KPI tiles fill the first screen; the first dispute row starts at 1122px on an 812px phone | Medium | Genuine | Fold the phone menu behind a menu button, or show KPI tiles in a 2- or 3-column grid below 640px |
| D3 | `05-merchant-check-my-edits-1440-light.jpg` | Merchant Check my edits, both | All | Reasons run as one semicolon list of technical phrases (`states "7712345678", "3", which is not in the supplied records; mentions a date…`); "Paragraph 8" counts the whole draft | Medium | Genuine (copy) | Show each reason as its own line in plain words, and number only the merchant's own paragraphs |
| D4 | `02-merchant-readiness-claim-1440-light.jpg`, `36-buyer-detail-source-labels-320-dark.jpg` | Claim and records; buyer reason code | All | Record paths and codes break mid-word ("evidence.customer_communica / tion", "…NOT_AS_DESCR / IBED") | Low | Genuine | Use `overflow-wrap: anywhere` only at `.` and `_` with `<wbr>`, or let the code line truncate with a title |
| D5 | `26-admin-settings-1440-light.jpg` | Admin settings, both | 1440 | The fifth card (Audit log) sits alone in the last row of a two-column grid | Low | Subjective | Let the last card span both columns |
| D6 | `27-admin-disputes-1024-light.jpg` | Admin menu, light | 1024 | The menu panel scrolls on its own; "Sign out" is below the fold at 768px tall | Low | Genuine | Reduce menu item spacing below 900px tall, or pin the account block |
| D7 | `01-merchant-dashboard-1440-light.jpg` | Sidebar, both | 1440 | Group labels ("Workspace", "You", "Data source") are 11px | Low | Genuine | 12px |
| D8 | `11-merchant-insights-1440-light.jpg`, `27-admin-disputes-1024-light.jpg` | KPI tiles, both | 1440, 1024 | "10 of 14 (71%)" and "$1,337.73 · €75.50" wrap inside their tiles | Low | Subjective | Smaller figure size for long values, or keep the separator with the next value |
| D9 | `01-merchant-dashboard-1440-light.jpg`, `24-admin-overview-1440-light.jpg` | All dashboards, both | All | The first KPI tile is always lime, whatever it measures, so it reads as the most important or selected figure | Low | Subjective | Keep lime for the selection and the main action only |
| D10 | `34-admin-audit-stacked-320-dark.jpg` | Admin audit log, dark | 320 | Stacked rows take about 200px per entry; the "Dispute" label is 12.9px while the others are 14px | Low | Genuine (size), subjective (length) | Same label size; consider a two-line row (time and event, then account and dispute) |

No Critical or High defects.

Not defects: colour transitions that looked half-finished in some captures happened because the page was caught
mid-transition (150 ms). They settle normally.

## 9. Recommended minimal fixes (need approval)

| Order | Fix | Defect | Files |
|---|---|---|---|
| 1 | Dark secondary buttons: `--surface-2` fill or a stronger border | D1 | `client/src/styles.css` |
| 2 | Phone: fold the menu or put KPI tiles in a grid below 640px | D2 | `client/src/styles.css` (menu fold may need `App.tsx`) |
| 3 | Check my edits: one reason per line, number the merchant's paragraphs only | D3 | `server/src/assist.ts`, `client/src/AnalysisPanel.tsx` |
| 4 | Sidebar labels 12px; audit "Dispute" label same size as the others | D7, D10 | `client/src/styles.css` |

D4, D5, D6, D8 and D9 can wait.

## 10. Not tested

| Item | Reason |
|---|---|
| AI-assisted draft and buyer AI explanation output | Would call Gemini |
| PayPal sandbox data source | Would call PayPal |
| Error state | Would need the server stopped or changed |
| Keyboard focus, screen reader, real phones, 200% text zoom | Outside this screenshot pass |
| Buyer at 768 and 1024, merchant at 768 | Covered only by the earlier scripted checks |
