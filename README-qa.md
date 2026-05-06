# Regression Testing Guide

## Overview

The app has two surfaces to test after any change:
1. **Telegram bot** — commands and inline button flows
2. **HTTP API** — REST endpoints consumed by the Mini App frontend

Both share the same database and state. A regression on either surface can silently break the other.

---

## Environment Setup

Before running any test, make sure the server is running and reachable:

```
node src/index.js
```

For API tests you need either a live Telegram WebApp `initData` token or the dev bypass header:

```
X-Dev-Telegram-Id: <your_telegram_user_id>
```

This bypass is only active when `NODE_ENV !== 'production'`.

---

## 1. Bot Command Flows

Test each command in a **private chat** with the bot.

### 1.1 `/start` — user onboarding

| Step | Action | Expected |
|------|--------|----------|
| Cold start | Send `/start` | Greeting message + inline button to open job search |
| Required channels not joined | `/start` before subscribing | Bot shows list of required channels to join |
| Channel joined → press "Я подписался" button | Bot detects subscription | Confirmation message + bonus opens granted once |
| `/start ref_<chatId>` deeplink | Friend opens bot via your referral link | Referrer receives bonus opens notification |
| `/start apply_<positionId>` deeplink | Candidate opens apply link | Hire Agent scenario starts for that position |
| `/start buy_silver` deeplink | Payment initiation | Telegram Stars invoice for Silver plan is sent |

### 1.2 `/cvscore` — resume review + enhanced CV

| Step | Action | Expected |
|------|--------|----------|
| 1 | Send `/cvscore` | Bot asks to upload CV |
| 2 | Upload a PDF file | Bot shows typing indicator, then returns score (0–100), summary, strengths, improvements |
| 3 | After score message | Inline button "📊 Open Full Report" (opens `/app/cvscore?uid=<chatId>`) |
| 4 | After report button | Inline button "⬇ Скачать улучшенное резюме" with a download URL |
| Edge: unsupported file type | Upload a `.docx` | Bot rejects with message about supported formats |
| Edge: Gemini API down | Upload any file | Bot replies with an error message, does not crash |

### 1.3 `/hireagent` — hire agent flow

| Step | Action | Expected |
|------|--------|----------|
| 1 | Send `/hireagent` | Intro message + "Да" / "Нет" buttons |
| 2a | Press "Да" | Bot asks to upload CV |
| 2b | Upload CV | CV saved, bot confirms upload, fake applying animation starts |
| 2c | Press "Нет" | Flow cancelled gracefully |
| Repeat upload | Upload CV again mid-flow | Old state cleared, new CV accepted |

### 1.4 `/plans` — subscription management

| Step | Action | Expected |
|------|--------|----------|
| `/plans` | Send command | Plan menu with Silver / Gold options |
| Press plan button | Tap a plan | Invoice sent via Telegram Stars |
| Successful payment | Complete payment in Telegram | Confirmation message + subscription activated |
| Double purchase | Pay for same plan twice in same month | Second subscription stacks or is handled gracefully |

### 1.5 Other user commands

| Command | Expected |
|---------|----------|
| `/jobsearch` | Opens seeker-jobs Mini App via inline button |
| `/applications` | Opens applications Mini App via inline button |
| `/companies` | Opens companies Mini App via inline button |
| `/profile` | Opens profile Mini App via inline button |
| `/referrals` | Shows referral link and bonus info |
| `/about` | Shows bot description text |
| `/news` | Shows news channel link |

### 1.6 Admin-only commands (run as admin Telegram account)

| Command | Expected |
|---------|----------|
| `/admin` | Admin panel link |
| `/admin_companies` | Company list |
| `/admin_positions` | Position list with deep-link apply URLs |
| `/admin_notifications` | Notification panel link |
| `/stat` | 7-day stats summary in chat |
| `/stat2` | Link to stat2 Mini App |
| `/removeuser <telegramId>` | Deletes all user data; replies with counts |

---

## 2. HTTP API Endpoints

Use `curl` or any HTTP client. Replace `BASE` with your server URL (e.g. `http://localhost:3000`).

### 2.1 Health check

```bash
curl BASE/
# Expected: 200 OK
```

### 2.2 Profile

```bash
# GET profile
curl BASE/api/app/profile \
  -H "X-Dev-Telegram-Id: 12345"
# Expected: 200 { id, telegramChatId, resumeUrl, skills, monetization, settings }

# PATCH settings
curl -X PATCH BASE/api/app/profile/settings \
  -H "Content-Type: application/json" \
  -H "X-Dev-Telegram-Id: 12345" \
  -d '{"hhEnabled": true, "searchMode": "urgent", "minimumSalary": 3000}'
# Expected: 200 { ok: true, skills, settings }

# Upload resume (PDF bytes)
curl -X POST BASE/api/app/profile/resume-upload \
  -H "X-Dev-Telegram-Id: 12345" \
  -H "Content-Type: application/octet-stream" \
  -H "X-File-Name: resume.pdf" \
  -H "X-File-Type: application/pdf" \
  --data-binary @resume.pdf
# Expected: 200 { ok: true, resumeUrl: "https://..." }
```

### 2.3 Monetization & channels

```bash
# Monetization status
curl BASE/api/app/monetization/status \
  -H "X-Dev-Telegram-Id: 12345"
# Expected: 200 { ok, requiredChannelsSatisfied, requiredChannels, monetization }

# Payment deeplink
curl "BASE/api/app/monetization/pay-link?plan=silver" \
  -H "X-Dev-Telegram-Id: 12345"
# Expected: 200 { ok: true, deepLink: "https://t.me/...", planCode: "silver" }

# Verify required channel subscription
curl -X POST BASE/api/app/required-channels/verify \
  -H "X-Dev-Telegram-Id: 12345"
# Expected: 200 { ok, channels, grantedBonusOpens, monetization }
```

### 2.4 Job details opens (entitlement gate)

```bash
curl -X POST BASE/api/app/analytics/job-details-open \
  -H "Content-Type: application/json" \
  -H "X-Dev-Telegram-Id: 12345" \
  -d '{"jobId": 42}'
# Free user with opens remaining → 200 { ok: true, remainingOpens }
# No opens left → 402 { error: "payment_required", monetization }
# Not subscribed to required channel → 403 { error: "subscribe_required", channels }
```

### 2.5 Applications CRUD

```bash
# List
curl "BASE/api/app/applications?userId=1"
# Expected: 200 [ array of applications ]

# Create
curl -X POST BASE/api/app/applications \
  -H "Content-Type: application/json" \
  -d '{"userId": 1, "screenlyJobId": 99, "vacancyTitle": "Backend Dev"}'
# Expected: 201 or 200 (if duplicate)

# Update status
curl -X PATCH BASE/api/app/applications/1 \
  -H "Content-Type: application/json" \
  -d '{"status": "interview", "notes": "Call scheduled"}'
# Expected: 200 updated application object
```

### 2.6 AI tools (require Gold plan or bonus opens)

```bash
# Tailored resume upload
curl -X POST BASE/api/tailored-resume/upload \
  -H "Content-Type: application/json" \
  -H "X-Dev-Telegram-Id: 12345" \
  -d '{"seekerId": 1, "screenlyJobId": 99, "jobTitle": "Backend Dev", "jobDescription": "...", "mainResumeText": "..."}'
# Gold user → 200 { tailoredCvUrl }
# Free user → 402 { error: "gold_required", monetization }

# Cover letter
curl -X POST BASE/api/cover-letter \
  -H "Content-Type: application/json" \
  -H "X-Dev-Telegram-Id: 12345" \
  -d '{"seekerId": 1, "jobTitle": "Backend Dev", "jobDescription": "...", "mainResumeText": "..."}'
# Gold user → 200 { coverLetter: "..." }
```

### 2.7 CV score result (Mini App polling)

```bash
# After /cvscore bot flow completes, the chatId is the uid
curl "BASE/api/cvscore-result?uid=12345"
# If result exists → 200 { name, ats_score, grade, summary, strengths, critical_fixes, ... }
# If not yet processed → 404
```

### 2.8 Admin endpoints (requires admin Telegram ID)

```bash
# Stat2 dashboard data
curl "BASE/api/app/admin/stat2?period=7" \
  -H "X-Dev-Telegram-Id: <ADMIN_ID>"
# Expected: 200 { success, period, totals, series }

# User list
curl "BASE/api/app/admin/users?limit=10" \
  -H "X-Dev-Telegram-Id: <ADMIN_ID>"

# Send single notification
curl -X POST BASE/api/app/admin/notifications/send \
  -H "Content-Type: application/json" \
  -H "X-Dev-Telegram-Id: <ADMIN_ID>" \
  -d '{"mode": "single", "receiverChatId": "12345", "text": "Test message"}'
# Expected: 200 { ok: true, notification }
```

---

## 3. Mini App Pages (Browser)

Open each URL while logged in via Telegram WebApp. Verify the page loads and core actions work.

| URL | What to verify |
|-----|---------------|
| `/app/seeker-jobs` | Job list loads, filters work, "Open" button records a job details open |
| `/app/profile` | Profile data loads, settings save, CV upload works |
| `/app/applications` | Applications list loads, status edit saves |
| `/app/pricing` | Plans listed with correct prices and features |
| `/app/companies` | Company list loads |
| `/app/cvscore?uid=<chatId>` | Score report renders after `/cvscore` bot flow |
| `/app/admin` | Admin panel loads (admin only) |
| `/app/stat2` | Stats chart renders (admin only) |

---

## 4. Key Regression Scenarios After the Refactor

These are the highest-risk areas after the modularization (Steps 1–10 of the refactor plan):

| Scenario | Why it's risky |
|----------|---------------|
| `/cvscore` full flow (upload → score → enhanced CV download) | Uses `cvScoreResultByUserId` from `bot/state.js` shared with `GET /api/cvscore-result` — must be same Map instance |
| Required channel gate + bonus opens grant | `getRequiredChannelsState` now uses `runtimeBot.telegram` from `bot/state.js` instead of its own local — must be set before first request |
| Admin notifications bulk send | `processAdminNotificationRun` now reads `runtimeBot.telegram` from state at call time — must not be null when send is triggered |
| Profile resume upload | `resumeStorage` is now the module-level singleton from `resumeStorage.js` — same instance used by bot hireagent handler and profile route |
| `/api/app/admin/positions` apply links | `runtimeBot.username` must be populated (set after `bot.telegram.getMe()`) before admin fetches positions |
| Referral bonus on `/start` | `grantReferralBonusToReferrer` still in `index.js` imports — verify it wasn't accidentally removed |

### Smoke test sequence after any deploy

```
1. GET  /                                   → 200
2. GET  /api/app/bot-info                   → { botUsername: "<name>" } (not empty)
3. Bot  /start                              → greeting appears
4. Bot  /cvscore + upload PDF               → score message + download button
5. GET  /api/cvscore-result?uid=<chatId>    → 200 with score object
6. GET  /api/app/profile (dev header)       → 200 with user data
7. POST /api/app/required-channels/verify  → 200
8. GET  /app/seeker-jobs                    → HTML page loads
```

If all 8 pass, the core user journey is intact.
