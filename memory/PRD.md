# Wayly Mobile — Phase 1 PRD

## Goal
Build a React Native (Expo SDK 54) mobile companion app for the existing Wayly web product (Australian aged-care Support at Home programme). The mobile app is the second client of an existing FastAPI backend; both share the same data via JWT auth.

## User
**Cathy** — adult-child caregiver helping their parent (the participant) navigate Support at Home statements, budgets, and anomalies. The mobile app prioritises moments-of-need: "I just opened a paper statement and want to upload it" or "I need to know in 30 seconds if anything's wrong this quarter."

## Phase 1 Scope (this build)
1. **Auth** — email/password JWT (`/api/auth/signup`, `/api/auth/login`, `/api/auth/me`). Google sign-in deferred to Phase 2.
2. **Today screen** — the marquee 30-second-glance dashboard. Greeting with participant name, quarter remaining (hero number), spent + alert count + lifetime cap %, stream breakdown, latest statement card.
3. **Camera upload** — primary FAB on Today + Statements. Action sheet → Camera / Library / PDF. Uploads to `/api/statements/upload`, polls `/api/statements/upload-job/{id}` for OCR + parse completion.
4. **Statement detail** — plain-English summary, anomaly cards (severity-tinted), line-item list with stream chips.
5. **Push notifications** — Expo push token registered to `/api/notifications/register-push`. Backend fires push on every HIGH/MEDIUM (alert/warning) anomaly detected during upload parse.

## Brand & Persona
- Colors (literal): navy `#1F3A5F`, gold `#D4A24E`, cream `#FAF7F2`. Stream accents: Clinical `#3A5A40`, Independence `#8B9B82`, Everyday Living `#A05545`.
- Fonts: Outfit (headings), Figtree (body) via `@expo-google-fonts`.
- Tone: calm, plain-English, warm, never alarmist. "Things to know" not "Errors". "Worth a quick check" not "URGENT".

## Architecture
- **Backend** (`/app/backend`): FastAPI + Motor + Mongo. Auth via PyJWT + bcrypt. Statement OCR via Claude Sonnet 4.5 vision through `emergentintegrations` (EMERGENT_LLM_KEY). Background async parse job. Expo push via `exponent_server_sdk`.
- **Frontend** (`/app/frontend`): Expo Router file-based routes. AsyncStorage-persisted JWT. Axios client with interceptor. Tab navigation: Today / Statements / Alerts / Profile.

## Endpoints
- `POST /api/auth/signup`, `POST /api/auth/login`, `GET /api/auth/me`
- `POST /api/household`, `GET /api/household`
- `POST /api/statements/upload` → returns `{job_id}`
- `GET /api/statements/upload-job/{job_id}` → polled for `{status, statement_id}`
- `GET /api/statements`, `GET /api/statements/{id}`
- `GET /api/budget/current` → Today screen data
- `GET /api/notifications`, `POST /api/notifications/read`, `POST /api/notifications/register-push`

## Demo data
On first startup, seed user `demo@wayly.com.au / Wayly123!` with household "Margaret" (Level 4), one sample statement covering current month, 1 warning anomaly + 1 info anomaly, 1 unread notification.

## Out of Phase 1 (deferred)
- Google sign-in
- Help chatbot
- Family thread
- Wellbeing check-in / participant view
- Settings (plan/billing) — point to web

## Notes
- The mobile app's `EXPO_PUBLIC_BACKEND_URL` can be repointed at any time to the real Wayly backend; the contract is identical.
- Statement OCR uses Claude vision and so requires `EMERGENT_LLM_KEY` (set in `/app/backend/.env`).
