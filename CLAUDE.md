# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

「存摺記帳」— a single-user personal finance PWA (Traditional Chinese UI), served by GitHub Pages from `main` at `https://taya20081-stack.github.io/ledger/`. No build step or package.json. Local write regressions can be checked with `node --test tests/local-writes.test.cjs`. The whole app is the inline `<script>` in `index.html` (~3,400 very long lines, minified-style code). The user communicates in 繁體中文; UI strings, comments and commit messages are in 繁體中文.

## Commands

There is no build/lint/test tooling. Useful checks:

```bash
# Syntax-check the inline app script (extract <script> blocks without src, then node --check)
python3 -c "import re;s=open('index.html',encoding='utf-8').read();open('/tmp/app.js','w').write('\n;\n'.join(re.findall(r'<script(?![^>]*src)[^>]*>(.*?)</script>',s,re.S)))" && node --check /tmp/app.js
```

- Smoke test in a browser: Playwright can open `file:///…/index.html` directly (Firebase CDN may be blocked in sandboxes; that's expected). Viewport 390×844 matches the primary device (iPhone).
- Lines are extremely long — `grep -n` output gets truncated; use Python `s.find(...)` / slicing to inspect context instead of trusting an empty grep.

## Release convention (every app change)

1. Bump the version in **both** `index.html` (`window.APP_VER='v2.0.N'`, ~line 570) and `sw.js` (`const CACHE='passbook-ledger-v2.0.N'`). The SW cache name is what forces clients to pick up the new `index.html`; forgetting it leaves users on the old version.
2. Commit message format: `v2.0.N: <繁中描述>`.
3. GitHub Actions bots commit `prices.json`, `rates.json`, `push-sent.json` to `main` several times a day — fetch/merge before pushing to avoid rejected pushes.

## Architecture (index.html)

Code is organized by `/* ================= section ================= */` banners (utilities, constants, storage, state, recurring & installments, record building, pages, render, editor, actions, events, boot, cloud sync, …). Key pieces:

- **State**: `S` = persisted state (`recs`, `byId`, `accts`, `cats`, `budgets`, `rules`, `tpls`, `rates`, `settings`, `sellers`) plus UI state (`view`, `stack`, `month`…). `D` = derived data rebuilt by `recompute()` (`D.live` = non-deleted records, `D.acct`, `D.bal`, …).
- **Writes**: records go through `mutate(add=[], del=[])` (stamps `r.u`, persists to IndexedDB, queues cloud push). Everything else is a whole-value KV saved with `saveKV(key)`. After changes call `scheduleRender()` / `render(true)`.
- **Record shape** (short keys): `id a(account id) t('支出'|'收入'|transfer types…) c s(category/subcategory) m(amount, signed) f(fee, negative) d n(name) sh(shop) dt(YYYY-MM-DD) tm(HH:MM) p(project) ds(desc) tg(source tag: 'claude'|'ap'…) g(group/rule id) cu xr(foreign currency/rate) u(updated ms) x(deleted flag)`. Recurring-rule generated records have ids `<ruleId>_<n>_<k>`.
- **UI**: `PAGES[name]()` returns `{head, body, …}`; `render()` draws the top of `S.stack` or `S.view`. All clicks dispatch via `data-act="…"` to handlers in the `ACT` object.
- **Local storage**: IndexedDB `ledger-pwa` (stores `rec`, `kv`); falls back to in-memory.
- **Cloud sync** (`Cloud` object, Firebase compat SDK 10.12.2, project `money-app-54e0d`; config in `window.FIREBASE_CONFIG`): `users/{uid}/mon/{YYYY-MM}` holds records (per-record last-writer-wins by `u`), `users/{uid}/kv/{key}` holds `{j: JSON, u}` for each key in `SYNC_KV`. `kv/botinfo` (written by the app) and `kv/notify` (push subscriptions + scheduled reminders) are read by GitHub Actions. Cloud is disabled when `window.__ARTIFACT__` is set.

### Claude inbox (how Claude edits the user's data)

Claude cannot read the user's records; it can only write command docs to Firestore `users/{uid}/inbox/{id}`. The app processes them in `processInbox()` (comment block above it documents the protocol), waits for cloud confirmation, then tries to delete the doc. Supported `kind`s: `exp`/`inc` (new record; `rep` makes a recurring rule; `sp` = splits), `edit`/`del` (match by `dt` + `n` [+ `tm`, `a`, `oamt`] — must match exactly 1 record), `inst`, `bal` (adjust an account to a target balance — App computes the diff via `balAt(acctId, dt, tm)` since Claude can't read balances; `amt` is always the target, never the diff), `updrule`, `delrule`, `rensub`, `clrshop`, `mvproj`, `renproj`, `hold`, `gold`, `osshop`, `px` (US prices from the Action), and `src:'ap'` (Apple Pay shortcut). The Firestore transaction sets the owner-only `_ledgerInbox` marker before local effects. Only the claimant starts execution. The app marks the document `completed` after cloud acknowledgement so any updated device can retry deletion. An interrupted or uncertain command remains reserved for review. Use deterministic ids derived from `ib_<docId>` (e.g. installments use `ib_<docId>_i<n>`). Apply the rules and mixed-version rollout procedure in `README.md` before enabling the release. Full field reference for every `kind`: `README.md`. When adding a new command, update three places: the protocol comment above `processInbox()`, `README.md`'s table, and the user's own 記帳 Claude skill (not in this repo).

## GitHub Actions (`.github/workflows/`)

Workflows use inline Python and validation/publishing helpers in `scripts/`; secrets `OWNER_UID`, `BOT_EMAIL`, `BOT_PASSWORD`, `VAPID_PRIVATE` sign in a bot Firebase account.

- `prices.yml` — TWSE/TPEx closing prices → `prices.json` (`{d, u, p:{code:[name, close, cur?, date?]}}`, public). US stocks (tickers from `kv/botinfo`) are fetched from Yahoo/Stooq and written **only** to the private inbox as `kind:'px'`, never to the repo. Gold → `p.GOLD` (Taiwan Bank 黃金存摺本行買進 per gram). The parser tries HTTP, then bounded Playwright. It retains the last official quote and its source timestamp when unavailable. The TWSE and TPEx snapshots must agree on the trading date. The 14:25 Taiwan-time workflow_dispatch and built-in backup schedules share the same publishing concurrency group per ref. `rates.yml` is also invoked through `workflow_call`.
- `rates.yml` — Taiwan Bank cash-buy FX rates → `rates.json` (`{d:{date:{CUR:rate}}, updated, source}`). The Taiwan Bank CSV is usually blocked by the same challenge; data in practice comes from the FinMind fallback (same Taiwan Bank `cash_buy` figures).
- `push.yml` — reads `kv/notify`, sends due Web Push reminders, logs sent hashes to `push-sent.json`.

The app fetches `prices.json` / `rates.json` from `raw.githubusercontent.com/.../main/`, so they take effect without an app release.
