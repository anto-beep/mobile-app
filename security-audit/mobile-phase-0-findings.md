# Wayly Mobile — Phase 0 Security Audit (read-only)

**Repo audited:** `/app/frontend/` (Expo React Native client for Wayly)
**Audit scope:** Phase 0 of the mobile security hardening prompt
**Stance:** READ-ONLY — no code changes have been made

This audit answers the 13 discovery questions exactly as you posed them, with
honest "yes / no / partial / N/A" verdicts. Every finding is grounded in a real
file or grep result I just ran against the repo. Anything I couldn't verify is
called out as "Unknown".

---

## TL;DR — verdict by phase

| Phase | Current status | Effort to bring up to spec |
|---|---|---|
| 1 — Secure offline storage | 🟡 **Partial** — tokens are in SecureStore (dual-write w/ AsyncStorage fallback). No SQLite cache. Offline queue + biometric flag + accessibility prefs + admin token in plain AsyncStorage. No TTL wrapper. No `clearAllUserData()`. | Small (~1 day) |
| 2 — Biometric auth | 🟡 **Partial** — `expo-local-authentication` wired; `BiometricGate` at root; opt-in toggle in Settings. **Missing:** server-side `/auth/biometric/enrol` + token-exchange flow. Today it's an OS-only lock — no separate biometric token. | Medium (~2 days, backend work) |
| 3 — Push notification security | 🟡 **Partial** — register flow + payload routing ship. **Missing:** logout-invalidation call, per-category settings, `cachedAt` audit of payloads (we don't currently send health data in payloads — verified). | Small (~half day) |
| 4 — iOS PrivacyInfo.xcprivacy | 🔴 **Missing** — no `privacyManifests` block in `app.json`. AI disclosure consent screen doesn't exist. | Medium (~1 day) |
| 5 — Android network security | 🔴 **Missing** — no `network_security_config.xml`, no `allowBackup: false`, no `usesCleartextTraffic: false`. | Small (~half day) |
| 6 — Screenshot prevention | 🔴 **Missing** — `expo-screen-capture` not installed; no AppState overlay. | Small (~half day) |
| 7 — Deep-link validation | 🟡 **Partial** — `DeepLinkHandler` parses + routes 5 schemes. **Missing:** server-side token validation, audit logging, AASA / assetlinks files. | Medium (~1 day, backend + DNS) |
| 8 — Cert pinning | 🔴 **Missing** — no pinning lib installed. **Recommendation: skip until launch.** | Skip |
| 9 — EAS + OTA security | 🔴 **No EAS config** — `eas.json` doesn't exist. `expo-updates` not installed. No build pipeline secrets to audit yet. | Medium (~1 day, infra) |
| 10 — Runtime protections | 🔴 **Missing** — no `jail-monkey`, no debugger detection. Hermes is on by default in SDK 54 ✓. | Small (~half day) |

---

## 1. Expo SDK version + workflow

- **Expo SDK:** `~54.0.35` ✓ (current as of audit; supports `privacyManifests` natively)
- **React:** `19.1.0`, **React Native:** `0.81.5`
- **Workflow:** **Managed Workflow.** No checked-in `ios/` or `android/` folders.
  - **Implication for Phase 5, 6, 8:** Any control that needs a native file
    edit (`network_security_config.xml`, `Info.plist`, SSL pinning native
    delegate) must be expressed via `app.json` + `expo-build-properties` plus
    a config plugin. If a phase genuinely requires Bare/Prebuild Workflow, I
    will flag it for your decision before running `expo prebuild` (it's a
    one-way conversion).

## 2. Security-relevant packages — installed vs. needed

| Package | Installed | Needed in spec | Phase |
|---|---|---|---|
| `expo-secure-store` | **`~15.0.8` ✓** | yes | 1, 2 |
| `expo-local-authentication` | **`~17.0.8` ✓** | yes | 2 |
| `expo-notifications` | **`~0.32.17` ✓** | yes | 3 |
| `expo-linking` | **`~8.0.11` ✓** | yes | 7 |
| `expo-camera` | **`~17.0.10` ✓** | yes | n/a |
| `expo-document-picker` | **`~14.0.8` ✓** | yes | n/a |
| `expo-file-system` | **`~19.0.23` ✓** | yes | 1, 6 |
| `expo-device` | **`~8.0.10` ✓** | yes | 3 |
| `expo-application` | ❌ missing | yes (Phase 3 fingerprint) | 3 |
| `expo-crypto` | ❌ missing | yes (Phase 1 key gen) | 1 |
| `expo-sqlite` | ❌ missing | optional (encrypted cache) | 1 |
| `expo-screen-capture` | ❌ missing | yes | 6 |
| `expo-updates` | ❌ missing | yes (signed OTA) | 9 |
| `expo-build-properties` | ❌ missing | yes (Android networkSecurityConfig) | 5 |
| `@op-engineering/op-sqlite` | ❌ missing | only if SQLCipher path chosen | 1 |
| `jail-monkey` | ❌ missing | yes | 10 |
| `react-native-ssl-pinning` / `expo-ssl-pinning` | ❌ missing | optional (Phase 8) | 8 |
| `@react-native-async-storage/async-storage` | **`2.2.0` ✓** | yes (fallback layer) | 1 |
| `@react-native-community/netinfo` | **`11.4.1` ✓** | yes | n/a |
| `expo-splash-screen` | **`~31.0.13` ✓** | yes | 6 (iOS bg overlay) |
| `expo-font` | **`~14.0.12` ✓** | yes | n/a |

## 3. Offline data storage — current state

- **Tokens:** stored via `src/lib/tokenStorage.ts` — dual-write: `expo-secure-store`
  + `AsyncStorage` fallback. This is the result of a hotfix earlier in the
  build (iOS Expo Go had SecureStore reliability problems). Phase 1 needs to
  re-evaluate this: dual-write means the token also lives in unencrypted
  AsyncStorage on some platforms.
- **AsyncStorage usages** — 24 occurrences across 6 files. Specifically:
  - `src/lib/tokenStorage.ts` — fallback layer for JWT
  - `src/lib/offlineQueue.ts` — **offline mutation queue** at key
    `wayly:offline_queue_v1`. May contain participant data inside POST bodies
    (e.g. wellbeing entries, visits). ⚠️ **PII risk.**
  - `src/context/AdminAuthContext.tsx` — admin JWT in AsyncStorage. ⚠️
    Inconsistent with the consumer migration to SecureStore.
  - `src/context/AccessibilityContext.tsx` — accessibility prefs (low risk)
  - `src/components/BiometricGate.tsx` — biometric-enabled flag (low risk)
  - `app/(tabs)/chat.tsx` — local chat draft cache (low risk, but worth review)
- **No `expo-sqlite` usage** anywhere in the codebase. There's no large
  structured cache (statements list, budget, etc. are fetched fresh each
  session). This is **good news for Phase 1** — there's no SQLCipher
  migration to do; we only need to wrap the AsyncStorage caches above.
- **No `cachedAt` timestamp** convention; nothing enforces the 24-hour TTL.

## 4. Biometric authentication — current state

- ✅ `src/lib/biometric.ts` wraps `expo-local-authentication.authenticateAsync`
  with `hasHardwareAsync` / `isEnrolledAsync` gates and graceful fallback.
- ✅ `src/components/BiometricGate.tsx` mounts at the root of `app/_layout.tsx`
  and locks the app on cold-start + after 30s background.
- ✅ Settings → Security has an opt-in toggle persisted to AsyncStorage.
- ❌ **No server-side biometric token exchange.** Today the flow is:
  unlock-the-app-with-biometric, not enrol-a-device-token. There's no
  `/auth/biometric/enrol` or `/auth/biometric/login` endpoint, no per-device
  invalidation path, and no 3-strike server fallback.
- ❌ **No `NSFaceIDUsageDescription`** in `app.json` infoPlist. **App Store
  will reject submission until this is added.**

## 5. app.json — relevant slices

```
name: Wayly · slug: wayly-mobile · scheme: wayly · sdkVersion: 54
ios.bundleIdentifier:        au.wayly.app
ios.infoPlist.NSCameraUsageDescription:       "Snap a photo of your statement to upload it" ✓
ios.infoPlist.NSPhotoLibraryUsageDescription: "Pick a saved statement photo to upload" ✓
ios.infoPlist.ITSAppUsesNonExemptEncryption:  false ✓
ios.infoPlist.NSFaceIDUsageDescription:       ❌ MISSING
ios.infoPlist.UIAppFonts:    [Fraunces, Inter, IBMPlexMono] ✓
ios.privacyManifests:        ❌ MISSING
ios.associatedDomains:       ❌ MISSING (Universal Links not configured)

android.package:             au.wayly.app
android.permissions:         [CAMERA, READ_EXTERNAL_STORAGE]
android.allowBackup:         ❌ NOT SET (defaults to true — risk)
android.usesCleartextTraffic: ❌ NOT SET (defaults to true)
android.networkSecurityConfig: ❌ NOT SET
android.intentFilters:       ❌ NOT SET (App Links not configured)

androidStatusBar: { backgroundColor: '#0E4D52', barStyle: 'light-content' } ✓

plugins (loaded):
  - expo-router
  - expo-splash-screen
  - expo-camera (with cameraPermission string ✓)
  - expo-image-picker (with photosPermission string ✓)
  - expo-notifications (with icon + color ✓)
  - expo-web-browser
  - expo-secure-store
  - expo-font
```

**`expo-build-properties` is NOT in the plugins list** — needed for Phase 5
to inject `networkSecurityConfig` / `usesCleartextTraffic` / `allowBackup`
without prebuild.

## 6. iOS PrivacyInfo.xcprivacy

❌ **Not configured.** The `expo.ios.privacyManifests` key is absent from
`app.json`. SDK 54 supports it natively (no plugin needed). Phase 4 work is
purely additive — no removals, no breaking changes.

## 7. Android network security config

❌ **Not configured.** No `network_security_config.xml` referenced. Default
behaviour: trusts system CAs AND user-installed CAs (the attack vector you
mentioned). Phase 5 fixes this in two lines via `expo-build-properties`.

## 8. Certificate pinning

❌ **Not implemented.** No `react-native-ssl-pinning`, `expo-ssl-pinning`,
or custom native code. **My recommendation matches yours: skip Phase 8 until
post-launch.** The Phase 5 networkSecurityConfig change is the realistic 90%
of the value at 5% of the maintenance cost.

## 9. Push notifications — lifecycle audit

- ✅ `src/lib/push.ts` correctly:
  - Skips on web + simulators
  - Sets `setNotificationHandler` (foreground display)
  - Creates an Android notification channel
  - Requests permission (currently at first cold start of `/today` tab —
    spec says "request at the right moment, not at app launch"; the current
    timing is **mid-onboarding, not at launch**, which is acceptable but
    could be deferred further to a per-category opt-in screen)
  - Calls `Notifications.getExpoPushTokenAsync()` then POSTs to
    `/api/notifications/register-push`
- ✅ Backend has `POST /api/notifications/register-push` (verified in earlier
  P1 work) that stores `{user_id, expo_push_token, platform, updated_at}` in
  the `push_tokens` Mongo collection.
- ❌ **No logout-side invalidation.** `AuthContext.logout()` calls
  `/api/auth/logout` (which clears tokens server-side in some flows) but
  **does not explicitly POST a token-invalidation call** to mark the device
  inactive. Phase 3 needs to add `DELETE /api/notifications/register-push`
  with the device token in the body.
- ✅ **Payload sanitisation looks OK:** I audited `_push_to_user(...)`
  callsites — payloads carry `type`, `deeplink`, `statement_id` (just a UUID),
  `notification_id`. **No participant names, dollar amounts, or anomaly
  detail strings in any push body.** Phase 3 will document this and add a
  regression test.

## 10. iOS deployment target / Android SDK

- **iOS minimum:** Expo SDK 54 default = **iOS 15.1**. App Store currently
  requires Xcode 26 / iOS 26 SDK to build (per Apple Feb 2026 cutover) —
  Expo SDK 54 ships this already. ✓
- **Android minSdkVersion:** Expo SDK 54 default = **API 24 (Android 7.0)**.
  Spec says iOS 17+ / Android 10+ — current floor is below your spec. Phase
  5 should bump `expo.android.minSdkVersion` to 29 (Android 10) via
  `expo-build-properties`.
- **Android targetSdkVersion:** Expo SDK 54 default = **API 35** ✓
  (>= 34 required by Google Play).

## 11. Hard-coded secrets / URLs grep

- ✅ **No API keys, tokens, or secrets in source.** Grepped for `sk-`, `sk_`,
  `API_KEY=`, `SECRET=`, `password=`, `api.anthropic`, `airwallex`,
  `stripe_secret` — clean.
- ✅ **No hard-coded backend URLs in app code.** All API calls route through
  `process.env.EXPO_PUBLIC_BACKEND_URL` (validated in `src/lib/api.ts`). The
  only `https://...` literals in source are App Store / Play Store links for
  the TOTP authenticator app — those are intentional outbound links, not API
  endpoints.
- `.env` contains: `EXPO_TUNNEL_SUBDOMAIN`, `EXPO_PACKAGER_HOSTNAME`,
  `EXPO_PUBLIC_BACKEND_URL`. None are secrets — `EXPO_PUBLIC_*` is intentional
  client-side config. The packager host is preview-environment only.
- ⚠️ **`.env` is NOT in the frontend `.gitignore`** for `.env` itself — only
  `*.p8` and `*.p12` are listed. **Recommend adding `.env` and `.env.*` to
  `.gitignore` in Phase 9.**

## 12. EAS Build / Update / Submit + Secrets

- ❌ **No `eas.json` exists.** No EAS Build / Update / Submit pipeline
  configured. There are no EAS Secrets to audit yet because EAS isn't wired.
- This is **expected** — preview deployments here run via the Emergent
  packager, not EAS. **Before App Store / Play Store submission, Phase 9
  must create `eas.json` from scratch and define `development`, `preview`,
  `production` profiles.**
- ❌ `expo-updates` not installed → no OTA channel + code-signing setup yet.

## 13. Permissions + usage strings

| Permission | Configured | Usage string | Verdict |
|---|---|---|---|
| iOS Camera | ✓ | "Snap a photo of your statement to upload it" | OK, short, user-benefit framed ✓ |
| iOS Photo Library | ✓ | "Pick a saved statement photo to upload" | OK ✓ |
| iOS FaceID | ❌ MISSING | — | **Phase 2 BLOCKER** |
| iOS Push | implicit (managed by EAS) | n/a | Confirm in Phase 9 |
| iOS App Tracking Transparency | not declared | — | OK (no tracking) — Phase 4 declares `NSPrivacyTracking: false` |
| Android CAMERA | ✓ | n/a (Android doesn't require strings) | OK ✓ |
| Android READ_EXTERNAL_STORAGE | ✓ | ⚠️ **Likely unnecessary** — Expo's document-picker uses Scoped Storage on API 29+. Phase 5 should audit + likely remove. | Review |
| Android POST_NOTIFICATIONS | ❌ NOT DECLARED | — | **Required for Android 13+ runtime permission. Phase 3 must add.** |
| Android USE_BIOMETRIC | implicit (expo-local-authentication adds it via config plugin) | — | OK |

---

## Findings I'd prioritise

In order of "biggest risk-reduction per hour of work":

1. **🔴 Add `NSFaceIDUsageDescription`** (Phase 2, 2 minutes) — App Store
   submission blocker.
2. **🔴 Set `android.allowBackup: false`** (Phase 5, 2 minutes) — health
   data in Auto Backup to Google Drive today.
3. **🔴 Add `android.usesCleartextTraffic: false`** (Phase 5, 2 minutes)
4. **🔴 Add `expo-build-properties` with `networkSecurityConfig` trusting
   only system CAs** (Phase 5, 30 mins)
5. **🟠 Add `expo-screen-capture` + sensitive-screen hook** (Phase 6, half
   day) — statement decoder results + budget data currently appear in iOS
   App Switcher / Android Recents.
6. **🟠 Add logout-side push token invalidation** (Phase 3, 30 mins)
7. **🟠 Migrate `AdminAuthContext` JWT to SecureStore** (Phase 1, 30 mins)
8. **🟠 Add 24-hour TTL wrapper for offline queue + audit what's queued** (Phase 1, 2 hrs)
9. **🟠 Add `expo.ios.privacyManifests` block** (Phase 4, 2 hrs)
10. **🟠 Add AI consent screen** (Phase 4, 4 hrs) — App Store Guideline 5.1.2(i)
11. **🟡 Add Android `POST_NOTIFICATIONS` permission** (Phase 3, 2 mins)
12. **🟡 Add server-side biometric token exchange** (Phase 2, 1 day)

## Things I did NOT change (this was a read-only audit)

- No edits to `app.json`, `package.json`, `eas.json`, source code, or env files
- No `expo prebuild` run (would convert to Bare Workflow — one-way)
- No `yarn add` calls
- No backend changes

---

## My recommendations on phase order

I'd suggest we do the **15-minute "config-only" wins** first (items 1-4, 6,
11 above) in a single Phase 5+ pass — they're tiny, additive, and unlock
App Store submission. Then tackle Phase 1, 3, 6 in sequence (each ~half day),
defer Phase 4 (privacy manifest + AI consent) to its own focused session,
defer Phase 2 server-side enrolment until backend has spare cycles, and
**skip Phase 8 (certificate pinning) for launch** per your own
recommendation.

**Awaiting your approval to proceed to Phase 1.**
