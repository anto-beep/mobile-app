# BACKEND URL — Now permanently bound to PRODUCTION

✅ **As of this iteration, the backend URL is hardened.** The mobile app
  always talks to `https://wayly.com.au` regardless of what
  `EXPO_PUBLIC_BACKEND_URL` says, because:

## Root cause of the recurring `.env` revert

`/entrypoint.sh` lines 51-54 (baked into the container image, cannot be
permanently changed from within the pod) re-writes `frontend/.env` on
every container boot:

```bash
sed -i "s|^EXPO_PUBLIC_BACKEND_URL=.*|EXPO_PUBLIC_BACKEND_URL=${preview_endpoint}|" "/app/frontend/.env"
```

`${preview_endpoint}` is injected by the platform and always points at the
pod's preview URL (`*.preview.emergentagent.com`). That preview pod is the
dev sandbox — it does NOT carry the production Wayly schema, data, or
iter 39-48 endpoints.

## The code-level fix

`/app/frontend/src/lib/api.ts` now resolves the backend URL with this priority:

```
1. EXPO_PUBLIC_API_BASE_OVERRIDE   ← explicit escape hatch
2. EXPO_PUBLIC_BACKEND_URL          ← only if it's NOT a preview-pod URL
3. https://wayly.com.au             ← hard-coded production fallback
```

A regex (`/\.preview\.emergentagent\.com/i`) detects the entrypoint's
auto-substituted URL and falls through to step 3. In `__DEV__` mode a
warning is logged so engineers know the override happened.

## How to point at a different backend

For staging / local / a different prod URL, add this to `frontend/.env`:

```
EXPO_PUBLIC_API_BASE_OVERRIDE=https://your-backend.example.com
```

The override takes priority over everything, including the entrypoint's
rewrite.

## Symptoms when something is wrong (now mostly impossible)

If you ever see these again, the override is being bypassed somehow:
- Login as `cathy@example.com / testpass123` fails (account only on prod)
- `/api/scenario/schema`, `/api/budget/eligible-pathways` return 404
- Aged Care Q&A returns the literal string "Not Found" as a bubble
- Budget Calculator's three-card layout renders blank dashes

Fix sequence (only if the code-level override is somehow disabled):
```
sed -i 's|EXPO_PUBLIC_BACKEND_URL=.*|EXPO_PUBLIC_BACKEND_URL=https://wayly.com.au|' /app/frontend/.env
rm -rf /app/frontend/.metro-cache/*
sudo supervisorctl restart expo
```
