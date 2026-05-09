# Auth Testing Playbook (Emergent-managed Google Auth)

## TEST AGENT PROMPT

When validating Wayly mobile auth flows, use the following:

### Flow under test
1. User taps "Continue with Google" on Login screen
2. App opens `https://auth.emergentagent.com/?redirect=<deep-link>` via `WebBrowser.openAuthSessionAsync`
3. After Google grants access, redirect URL contains `#session_id=<id>`
4. Mobile parses `session_id` from `result.url`, calls `POST /api/auth/google-session` on the production backend
5. Backend exchanges `session_id` with `https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data` and returns `{token, user}`
6. Mobile stores JWT in AsyncStorage and routes to `/(tabs)/today`

### Critical rules
- Mobile MUST use `Linking.createURL('/')` for redirect (deep link), NOT a HTTP URL.
- `result.url` from `openAuthSessionAsync` is the source of truth for the redirect URL.
- `Linking.getInitialURL()` is a cold-start fallback only.
- Parse `session_id` from BOTH `#session_id=...` (hash) and `?session_id=...` (query).
- After successful auth, navigate to main app, NOT back to login.

### Manual test
For human testing only — automated agents should not attempt to complete the OAuth window.
Open the app → tap "Continue with Google" → complete flow with a real Google account → confirm landing on Today screen with correct name.

### Email/password fallback
The seeded demo account `demo@wayly.com.au / Wayly123!` (in /app/memory/test_credentials.md) bypasses Google entirely and is the recommended path for automated test agents.
