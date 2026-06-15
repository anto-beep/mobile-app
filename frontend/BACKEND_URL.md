# BACKEND URL — PROTECTED CONFIGURATION

⚠️ **CRITICAL: `frontend/.env` MUST have `EXPO_PUBLIC_BACKEND_URL=https://wayly.com.au`**

This file has now reverted three times in this app's history. Symptoms when it
goes wrong:
1. Login as `cathy@example.com / testpass123` fails — that account doesn't exist
   on the preview backend, only on production.
2. `/api/scenario/schema`, `/api/budget/eligible-pathways` return 404 — those
   endpoints only exist on production (`https://wayly.com.au`).
3. The Aged Care Q&A chat returns the literal string "Not Found" as a
   message bubble because `/api/public/aged-care-chat` 404s on preview.
4. Budget Calculator's three-card layout renders blank dashes — the preview
   pod's `/api/public/budget-calc` returns an older schema without
   `quarterly_gross / care_management_quarterly / quarterly_usable`.

**The mobile app's WHOLE purpose is to be the renderer for the production
Wayly API. Never repoint it elsewhere.**

If you see this revert again, the fix is one line:
```
sed -i 's|EXPO_PUBLIC_BACKEND_URL=.*|EXPO_PUBLIC_BACKEND_URL=https://wayly.com.au|' /app/frontend/.env
rm -rf /app/frontend/.metro-cache/*
sudo supervisorctl restart expo
```
