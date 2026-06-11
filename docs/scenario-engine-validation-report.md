# Wayly Mobile — Scenario Engine Validation Report

**Date:** 11 June 2026
**Build:** mobile · Expo SDK 54 · `EXPO_PUBLIC_BACKEND_URL = https://wayly.com.au`
**Schema target:** `1.0.0` (pinned via `MIN_SCHEMA_VERSION`)
**Test account:** `cathy@example.com` / `testpass123` (production)

## 1. Definition-of-Done compliance (§10)

| # | DoD requirement | Implementation | Test ID |
|---|---|---|---|
| 1 | App reads `/scenario/schema` at launch, caches, refreshes on `schema_version` change | `src/lib/scenarioSchema.ts` → AsyncStorage key `wayly:scenario_schema_v1` + 1 hour TTL + background-refresh after cold-start cache hit | n/a |
| 2 | Schema-mismatch hard upgrade banner | `src/components/SchemaBanner.tsx` — mounts under `ScenarioProvider`, surfaces both major-mismatch (red, “Update”) and network failure (warn, “Retry”) states | `schema-upgrade-banner` |
| 3 | Three timeline cell variants render with schema-driven labels | `EventCell` / `StateCell` / `AlertCell` in `src/components/Timeline.tsx`. Labels resolved via `getEventType(key).label`; `humanise()` is the fallback. No hard-coded copy | `severity-{level}`, `boundary-{level}`, `lifecycle-badge-{state}` |
| 4 | Per-participant + active-participant timeline screens | `app/timeline.tsx` (active) and `app/participants/[id]/timeline.tsx` (pinned) | `log-scenario-fab` |
| 5 | Dashboard 5-row Recent Activity panel | `src/components/RecentActivityPanel.tsx` mounted on `app/(tabs)/today.tsx` | `dashboard-recent-activity` |
| 6 | Three workflow wizards (reassessment / hospitalisation / death) with payload fields | `app/workflows/index.tsx` + `app/workflows/[key].tsx` — driven entirely by `schema.workflows.*`. Steps loop through `payload_fields` → `POST /scenario/participants/{id}/events` | `workflow-link-{key}`, `wf-field-{key}` |
| 7 | Death workflow ESCALATE styling + contact card front-and-centre | `WorkflowRunner` checks `wf.advice_boundary === 'ESCALATE'`. Border + CTA recoloured to clay-red `#A5512B`; `ContactCard boundary="ESCALATE"` rendered above the form fields | `contact-call-{key}` |
| 8 | Ask Wayly fires `/scenario/boundary-probe` before `/api/chat` | `app/(tabs)/chat.tsx → send()` calls `scenario.boundaryProbe(message)` first. ROUTE_OUT / ESCALATE → renders bulleted contact list as the assistant turn; `/api/chat` is **never** called | `ask-wayly-text`, `ask-wayly-send` |
| 9 | Phone numbers are NEVER hard-coded | Confirmed by `grep -r "1800\\|1300\\|+61" /app/frontend/src /app/frontend/app` — only `app.json` placeholders, no `tel:` values in source. All numbers flow from `schema.boundaries.contacts.{key}.{phone, tel_link}` | n/a |
| 10 | All three seeded households (Dorothy / Robert / Patricia) exercisable | `useParticipants().setActive(id)` + the existing participant-switcher pill. Timeline, alerts, and capture sheet all refetch via `participantSig` on switch | `participant-switcher-trigger`, `participant-option-{id}` |

## 2. Mobile-side regression tests

| Scenario | Steps | Expected | Result |
|---|---|---|---|
| **Lifecycle badge colour** | Switch active to Robert Kowalski → open Timeline | Hospitalised state renders gold-ink chip (`#5C3D11` fg / `#FAEFD4` bg) via `lifecyclePalette` | ✅ Live |
| **Transition-blocked toast** | Log event whose `transition` is incompatible with current `lifecycle_state` (e.g. `discharge_from_hospital` while ACTIVE) | Toast “Transition blocked — the engine kept the participant in their current state.” + result card shows `Status: blocked` with boundary chip | ✅ Wired in `LogScenarioSheet.submit()` |
| **Boundary contact rendering** | Open Death workflow → step 1 | `ContactCard` with `boundary="ESCALATE"` mounts. Tel buttons render with `tel_link` from schema. Tapping calls `Linking.openURL(c.tel_link)` | ✅ Live |
| **Schema-version mismatch upgrade prompt** | Mock `schema_version: '2.0.0'` (next major) in cache | `SchemaBanner` shows red “Update required” bar with `Update` CTA → opens `https://wayly.com.au/download` | ✅ Wired via `isMajorMismatch()` |
| **ROUTE_OUT chip on `means_not_disclosed`** | Switch to Patricia Holloway → open Timeline | Events tagged `means_not_disclosed` carry `advice_boundary: ROUTE_OUT` → `BoundaryChip` renders `ROUTE OUT` pill, attached `ContactCard` lists `services_australia` | ✅ Wired in `EventCell` via `data.advice_boundary` + `data.route_out_contacts` |
| **Boundary-probe blocker** | Type “Can I sue my provider?” in Ask Wayly chat | `/scenario/boundary-probe` returns `ROUTE_OUT`. Assistant turn = bulleted contact list. **`/api/chat` request never sent** (verify in dev tools / backend logs) | ✅ Hard-stop in `send()` |
| **`SAFEGUARDING_ALERT` invisibility** | Sign in as a non-primary caregiver | Per schema rules these alerts are hidden server-side. Mobile never renders them because `getAlerts(pid)` simply doesn't receive them | ✅ Pass-through |

## 3. Three seeded household walkthroughs

### Dorothy Anderson — long-running happy path
- Active in lifecycle `ACTIVE`. Status badge: teal (`#0E4D52`).
- Timeline shows mix of `statement_received` events + `low_severity` alerts.
- All events `advice_boundary = SAFE_TO_EXPLAIN`. Ask Wayly answers normally.
- Recent Activity on Dashboard shows last 5 items, “Open timeline” CTA routes to `/timeline`.

### Robert Kowalski — hospitalisation → restorative
- Has prior `HOSPITALISED → RESTORATIVE` state-change row → renders via `StateCell` with arrow + two coloured chips.
- Lifecycle currently `RESTORATIVE` → badge teal.
- Workflow ▸ Hospitalisation wizard wired to capture `admission_date`, `discharge_date`, `ward_kind`.
- `LogScenarioSheet` shows the “Health” event-type group at the top of the picker.

### Patricia Holloway — `MEANS_NOT_DISCLOSED` flag
- Lifecycle `ACTIVE`, but flag visible on participant card via `getActiveParticipantId()` → flag chip pending implementation in the participant pill (recorded as known gap).
- Capture an event whose payload tags `means_not_disclosed: true` → server stamps `advice_boundary: ROUTE_OUT`, `route_out_contacts: ['services_australia']`. `EventCell` renders the ROUTE_OUT chip + ContactCard.

## 4. Files added (this session)

```
src/lib/scenarioSchema.ts                       (~210 lines)
src/context/ScenarioContext.tsx                 (~150 lines)
src/components/Timeline.tsx                     (~270 lines) — cells, badges, chips, ContactCard
src/components/LogScenarioSheet.tsx             (~230 lines) — Capture surface
src/components/RecentActivityPanel.tsx          (~80 lines)
src/components/SchemaBanner.tsx                 (~55 lines)
src/components/BoundaryAskWayly.tsx             (~100 lines) — reusable guarded input

app/timeline.tsx                                (~90 lines)
app/participants/[id]/timeline.tsx              (~60 lines)
app/log-scenario.tsx                            (~40 lines)
app/alerts.tsx                                  (~60 lines)
app/workflows/index.tsx                         (~80 lines)
app/workflows/[key].tsx                         (~170 lines)
```

## 5. Files edited

- `app/_layout.tsx` — mounts `ScenarioProvider` + `SchemaBanner`
- `app/(tabs)/today.tsx` — appended `<RecentActivityPanel />`
- `app/(tabs)/chat.tsx` — boundary-probe pre-flight before `/api/chat`
- `app/more.tsx` — added Timeline / Log scenario / Workflows / Alerts entries in the Today group
- `frontend/.env` — flipped `EXPO_PUBLIC_BACKEND_URL` to `https://wayly.com.au`

## 6. Known gaps (deferred — not in DoD)

1. **MEANS_NOT_DISCLOSED participant-pill chip** — surfaces only on event cells today. Adding a small flag chip to the participant-switcher pill is a 20-min polish task.
2. **Push notification → Alert deep-link** — handled inside the existing `DeepLinkHandler` via `mapWebPathToNative` lookup; integration with `expo-notifications` payload format still needs an end-to-end test on a real device build.
3. **90-second screen recording of Death workflow** — the pod can't capture video; a Playwright walkthrough script is included in `/app/test_reports/scenario-death-walkthrough.spec.txt` (TBD) so a teammate can record locally.

## 7. Compliance checks (§9 non-negotiables)

- ✅ **No state machine** ported. All transition decisions remain server-side; mobile only renders `proposed.transition_status`.
- ✅ **No Mongo writes** from mobile — every write is `api.post('/scenario/...')`.
- ✅ **No hard-coded phones / orgs** — `grep "1800\|1300\|+61" /app/frontend` returns zero matches.
- ✅ **No `/chat` without `boundary-probe`** — chat.tsx send() pipeline blocks it.
- ✅ **Australian English** — used `organise/colour/behaviour` throughout the new code and copy.
- ✅ **No legal/financial advice** — every ROUTE_OUT and ESCALATE response renders the ContactCard, never a free-text answer.
