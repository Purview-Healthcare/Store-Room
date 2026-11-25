# Store Room: test-and-fix plan

## 1. What the app is

Purview Store Room is one web page (`index.html`). It has no server, no sign-in and no outside data. It shows:

- **17 controlled documents**: 9 workflows (WF-01 to WF-09) and 8 policies (PL-01 to PL-08). Each document has a cover, a controlled-document box (number, version, effective date, review date, owner, applies to), a purpose, a stage strip, stages made of steps, tables, notes and do/don't lists.
- **Home page**: welcome banner with counts, three "doors" (Policies, Workflows, Applications), the "What do I do when..." index (situation shortcuts), ground rules and a footer stamp.
- **Category pages**: a card per document; on print, the full text of every document in the category.
- **Applications directory**: 9 Purview tools with status, link and description. Anyone can press Edit; changes are saved only in that browser (localStorage key `purview_store_room_apps`). "Copy config" produces a line (`var APP_BAKED = ...`) for the owner to paste into the file to publish to everyone.
- **Search** across documents and applications, with highlighted matches.
- **Print** of a single document or a whole category.

### Who uses it (roles)
The page has no sign-in, so every visitor sees the same thing. Roles described in the documents: employees, team leads, supervisors, managers, QA, HR, IT, VP. The code comment names one extra role: the **admin** who maintains application links. There is no technical difference between roles.

### Numbers on screen
Document counts (banner, doors, category cards, category cover, footer stamp), application counts, stage counts per document, "read" minutes per document, step numbers, store version and "updated" date.

### Rules used as the reference
There is no README. The rules are taken from: code comments, the sidebar note ("Controlled documents... updated version is redeployed with a new version number and effective date"), the home page ground rules ("These documents are versioned"), and the policy text agreed with the owner in this project.

## 2. Test areas and scenarios

| # | Area | Scenarios (approx.) |
|---|------|------|
| 1 | Main workflows end to end | Home → door → category → document → stage strip / side rail jumps → next/previous → breadcrumb; situation shortcuts; cross-links between documents; search → result → document (about 25) |
| 2 | Bugs and edge cases | Search with empty, 1 letter, odd characters (`&`, `<`, quotes, regex symbols), very long text, words that only appear in tables, notes or lists; app editor with empty, huge, HTML-like and bad-link input (about 30) |
| 3 | Who sees what | No sign-in: confirm nothing private is stored or shown; app edits stay in one browser only and never leak into another browser profile (about 5) |
| 4 | Numbers | Every count agrees across banner, doors, cards, covers, nav and footer; stage counts; read minutes; situation targets exist; every cross-reference points to a real document (about 15) |
| 5 | Dates | Effective and review dates are valid and consistent (review 6 months after effective); "updated" date not older than the latest change; date wording in policies (for example December 2026 payout) consistent (about 8) |
| 6 | Two at once | Double-click on doors and buttons; two tabs editing the same app (about 5) |
| 7 | Copy, print, export | Copy config output; print view of a document and of a category contains every table, list and note, with no raw `**` markers; no patient data anywhere (about 10) |
| 8 | Every screen in a browser | No errors on any screen; every button and link works; phone (390px), tablet (820px), laptop, wide (1800px); keyboard use (Tab + Enter) on cards, doors, situations; reduced-motion on and off (about 25) |
| 9 | Errors and recovery | Broken saved data in the browser, browser storage blocked, clipboard blocked; cancel an edit; undo an edit (about 8) |
| 10 | Speed | Page weight, time to first screen, work done per key press in search (about 4) |
| 11 | Basic security | No secrets or keys in the file; no outside network calls; all shown text escaped; app links only open web addresses (about 6) |

Planned total: about 140 checks.

## 3. How tests run

`npm test` runs every `tests/*.test.js` file in Chromium through Playwright. Each check has a plain-English name and prints PASS or FAIL. All test data is made up; nothing outside the page is touched.
