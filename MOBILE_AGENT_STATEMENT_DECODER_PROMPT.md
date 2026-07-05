# 📱 Mobile Agent Handover — Statement Decoder (Web Parity)

**Task**: Bring the mobile Statement Decoder to full parity with the web app. Backend is shared (same endpoints, same response shape); this document is the mobile UI + PDF + payload contract. Copy behaviour verbatim — no paraphrasing of user-facing text.

**Reference web files**:
- `/app/frontend/src/components/DecoderResultView.jsx`
- `/app/frontend/src/pages/StatementDetail.jsx`
- `/app/frontend/src/pages/tools/StatementDecoderTool.jsx`
- `/app/frontend/src/lib/formatDate.js`
- `/app/frontend/src/lib/decoderExport.js`

---

## 0. What already works (no mobile change needed)

Both apps hit the same backend. As of this refactor (DEC-1 Phase 1), the API now returns:
- Rich `audit_json` and `extracted_json` on every persisted statement
- A comprehensive plain-English `summary` field (multi-paragraph, `\n\n`-separated)
- Correct dates (no more `1970-01-01` fallback), correct streams (`Care Management`, `AT-HM` no longer folded into Everyday Living)
- Server-generated PDF/CSV that render dates as `DD/MM/YYYY`

Mobile inherits all of that automatically once it renders these fields.

---

## 1. Endpoint contract (unchanged base + `/api/`)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/public/decode-statement-text` | Text-paste decode. Body: `{ "text": "…" }`. **Attach `Authorization: Bearer <token>` when signed in — the decode will be persisted to Statements.** Response: `{ job_id, status }`. |
| `POST` | `/api/public/decode-statement` | File-upload decode. `multipart/form-data` with `file`. Same auth behaviour as above. Response: `{ job_id, status }`. |
| `GET` | `/api/public/decode-job/{job_id}` | Poll every ~2 s. Response fields: `status` (`pending`/`in_progress`/`done`/`error`), `phase` (label), `result` (see §2), `error` (string when `status==error`). |
| `GET` | `/api/statements` | List. Returns array of statement summaries. |
| `GET` | `/api/statements/{id}` | Detail. Returns the full Statement document (see §2). |
| `GET` | `/api/statements/{id}/decoded.pdf` | Server-rendered PDF (dates already `DD/MM/YYYY`). Use this for mobile PDF export — see §5. |
| `GET` | `/api/statements/{id}/decoded.csv` | Server-rendered CSV. |

Rate limit: `/public/decode-statement*` enforces a monthly cap per IP for anonymous callers; signed-in callers are gated by their subscription plan.

---

## 2. Response shape mobile will render

### 2a. AI-Tools job result (`GET /api/public/decode-job/{job_id}` while `status==done`)

```json
{
  "status": "done",
  "phase": "done",
  "result": {
    "summary": "This is Margaret Chen's Support at Home statement for 1 May 2026 to 31 May 2026 from Sunshine Aged Care. …\n\nThe money was spread across …\n\nWayly flagged 3 things worth a closer look on this statement …",
    "period_label": "1 May 2026 to 31 May 2026",
    "line_items": [ /* legacy shape, safe to ignore in favour of extracted.line_items */ ],
    "anomalies": [ /* mirror of audit.anomalies */ ],
    "extracted": { /* see below */ },
    "audit": { /* see below */ },
    "partial_result": false,
    "persisted_statement_id": "040201d0-792f-49a1-b149-46afc9c24fb7"
  }
}
```

`persisted_statement_id` is only present when the caller was authenticated. On mobile, after a decode completes, prefer routing the user to the persisted statement (`GET /api/statements/{persisted_statement_id}`) rather than staying on the transient AI-Tools result.

### 2b. Statement detail (`GET /api/statements/{id}`) — real example (trimmed)

```json
{
  "id": "040201d0-792f-49a1-b149-46afc9c24fb7",
  "filename": "AI Tools decode · 1 May 2026 to 31 May 2026",
  "period_label": "1 May 2026 to 31 May 2026",
  "input_method": "text_paste",
  "origin_route": "ai_tools_decoder",
  "parsing_warnings": [],
  "summary": "This is Margaret Chen's Support at Home statement for 1 May 2026 to 31 May 2026 from Sunshine Aged Care. …\n\nThe money was spread across $320.00 on Clinical care (2 services), $340.00 on Independence supports (2 services), and $187.50 on Everyday Living (1 service).\n\nThe quarterly budget has been fully used for this quarter.\n\nWayly flagged 3 things worth a closer look on this statement (2 high-priority, 1 medium-priority). …\n\nWhen you have a moment, work through the flagged items above with Sunshine Aged Care. …",
  "audit_json": {
    "statement_summary": {
      "participant_name": "Margaret Chen",
      "period": "1 May 2026 to 31 May 2026",
      "provider": "Sunshine Aged Care",
      "classification": "6",
      "total_line_items": 5,
      "total_gross": 847.50,
      "total_participant_contribution": 71.50,
      "total_government_paid": 776.00,
      "care_management_fee": 0.00,
      "budget_remaining": 0.00,
      "adjusted_budget_remaining": 0.00,
      "rollover_applied": 0.00,
      "lifetime_contributions_to_date": 0.00,
      "lifetime_cap_remaining": 0.00
    },
    "stream_breakdown": [
      { "stream": "Clinical", "line_item_count": 2, "gross_total": 320.00, "participant_contribution": 0.00, "government_paid": 320.00 },
      { "stream": "Independence", "line_item_count": 2, "gross_total": 340.00, "participant_contribution": 34.00, "government_paid": 306.00 }
    ],
    "anomaly_count": { "high": 2, "medium": 1, "low": 0 },
    "anomalies": [
      {
        "severity": "high",
        "rule": "RULE_2_WEEKEND_AFTER_HOURS_RATE",
        "headline": "Nursing visit charged at $180/hour with no service code recorded.",
        "detail": "The nursing visit on 03/05/2026 does not have a service_code field populated. …",
        "dollar_impact": 180.00,
        "evidence": [
          "Line item date 03/05/2026: service_code is empty string, service_description is 'Nursing visit', unit_rate $180.00, gross $180.00"
        ],
        "suggested_action": "Request the provider supply the service code for the nursing visit line item so the charged rate can be validated against the published rate schedule."
      }
    ]
  },
  "extracted_json": { /* same shape as job result's `extracted` */ },
  "line_items": [
    {
      "id": "79a3e4ac-651f-4d99-8c06-c4f4e7b6ed5d",
      "date": "2026-05-03",
      "service_code": null,
      "service_name": "Nursing visit",
      "stream": "Clinical",
      "units": 1.0,
      "unit_price": 180.00,
      "total": 180.00,
      "contribution_paid": 0.00,
      "government_paid": 180.00,
      "confidence": 0.9
    }
  ]
}
```

**Notes:**
- Dates in `line_items[].date` and inside `evidence` strings are stored ISO (`YYYY-MM-DD`). Mobile must format them as `DD/MM/YYYY` for display.
- `stream` values now include `"Care Management"` and `"AT-HM"` — do NOT fold these into Everyday Living.
- `anomalies[].severity` is one of `"high"` / `"medium"` / `"low"`. Do NOT translate to `alert`/`warning`/`info`.
- `parsing_warnings` is an array of user-facing strings (e.g. "Could not parse date on 2 line item(s): 32/13/2026, …"). Show them as a small warning strip below the "In plain English" card.

---

## 3. Mobile screen structure (order matters)

Render exactly these sections in this order on the statement detail / decoder-result screen:

### Section A — "In plain English" card (**always shown when `summary` is present**)
- Icon: `Info` (rounded circle, primary-k fill)
- Overline: **`IN PLAIN ENGLISH`** (uppercase, tracking-wide)
- Body: split `summary` on `\n\n`, render each chunk as its own `<Text>` paragraph with 12px between paragraphs, `#0E4D52` text on `#F4F1EA` surface
- Footer disclaimer (verbatim, muted): *"AI-generated summary. Always verify important figures with your provider or My Aged Care before acting."*
- testID: `decoder-plain-english-summary`

### Section B — Summary banner (teal-ink)
- Background: `#0E4D52` (`primary-k`)
- **All text on this surface MUST be white (`#FFFFFF`).** No gold, no muted colours. This is the AAA-contrast rule from DEC-1 §12.
- Header row (tiny, tracking-wide, uppercase): `period · participant_name · Class N · provider` — white
- 4 metric tiles (each: label overline + value in mono/tabular-nums):
  - `GROSS BILLED` → `total_gross`
  - `YOUR CONTRIBUTION` → `total_participant_contribution`
  - `GOVERNMENT PAID` → `total_government_paid`
  - `BUDGET REMAINING` → `adjusted_budget_remaining ?? budget_remaining`
- Input-method chip (top-right corner): `From pasted text` / `From uploaded file` / `From dashboard upload` — based on `input_method`
- testID: `decoder-summary-banner`

### Section C — Anomaly panel (only when `anomalies.length > 0`)
- Aggregate headline (chip row): `{n} HIGH`, `{n} MEDIUM`, `{n} LOW`. Colours: red-800, amber-700, sage-600 respectively.
- One card per anomaly, sorted by severity:
  - Severity chip (uppercase, `HIGH` / `MEDIUM` / `LOW`)
  - Bold headline text (`headline` or `title`)
  - Body: `detail`
  - Evidence bullet list (each `evidence[]` entry)
  - "Suggested action" callout at the bottom (muted background, `suggested_action` text)
  - Dollar impact chip (right side): `$XX.XX at risk` when `dollar_impact > 0`
- testID (per card): `decoder-anomaly-{index}`
- testID (panel): `decoder-anomaly-panel`

### Section D — Stream breakdown
- Section heading: **Stream breakdown**
- Table with columns: Stream · Items · Gross · You paid · Govt paid
- Streams may be any of: `Clinical`, `Independence`, `Everyday Living`, `Care Management`, `AT-HM`. Each gets its own row — do NOT merge.
- Optional expandable per row: tapping expands the line items for that stream (each shows `formatDate(date) · service_description`)
- testID: `decoder-stream-breakdown`

### Section E — Full line-item table (collapsed by default)
- Toggle button: **"Show full line-item table"** / **"Hide full line-item table"**
- Columns: Date · Service · Stream · Units · Rate · Gross · You paid · Govt paid
- **All dates rendered as DD/MM/YYYY.**
- Numeric columns tabular-nums, right-aligned.
- testID (table): `decoder-line-items-table`
- testID (row per item): `decoder-line-item-{id}`

### Section F — Actions
- Two buttons at the bottom of the result card:
  - **Download PDF** → see §5 (opens native share sheet with the server PDF)
  - **Download CSV** → same pattern, share the server CSV
- testIDs: `decoder-download-pdf-btn`, `decoder-download-csv-btn`

---

## 4. Date formatting helper (mobile)

The API stores ISO. Mobile must display DD/MM/YYYY everywhere in the decoder UI.

```javascript
// src/lib/formatDate.js — Australian display format.
export function formatDate(v) {
    if (v == null || v === "") return "";
    if (typeof v === "string") {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
        if (m) return `${m[3]}/${m[2]}/${m[1]}`;   // no TZ shift
    }
    const d = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}
```

Apply in three places: (a) full line-item table date column, (b) expanded stream detail rows, (c) any anomaly evidence line that begins with `Line item date …`.

---

## 5. PDF/CSV parity — download the server file, don't reproduce it

Rationale: web has TWO PDF paths (client jsPDF for the rich view, server reportlab for legacy). Consolidation is in progress. On mobile, the **guaranteed-identical** approach is to bypass any client PDF library entirely and just download the server PDF, then present it via the native share sheet.

```javascript
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { resolveApiUrl } from "@/lib/whoami";

export async function shareStatementPdf(statementId, token) {
    const base = resolveApiUrl();
    const url = `${base}/api/statements/${statementId}/decoded.pdf`;
    const target = `${FileSystem.cacheDirectory}statement-${statementId}.pdf`;
    const { uri } = await FileSystem.downloadAsync(url, target, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: "Save or share your statement PDF" });
    }
}
```

Same pattern for CSV, swap the path and mime type. This guarantees byte-identical output to whatever the web app downloads via the server route, so mobile and web PDFs are visually identical.

---

## 6. Persisting AI-Tools decodes on mobile

When the user is signed in and runs a decode via the AI-Tools tab, always attach the bearer token. The backend will opportunistically persist the decode to `db.statements` and return `persisted_statement_id` in the job result. Once mobile sees that ID, the recommended UX is:

- Toast: **"Saved to your Statements"**
- Primary CTA on the result screen: **"Open in Statements"** → navigates to `Statement Detail` for that ID
- Secondary CTA: **"Decode another"** → back to the decoder form

Do not create a separate "save to statements" endpoint. It's automatic on the backend when auth is present.

---

## 7. Acceptance checklist

- [ ] `summary` renders as a multi-paragraph card at the very top when present
- [ ] The teal-ink summary banner has 100% white text (no gold, no muted-teal-on-teal)
- [ ] All dates in the UI render as `DD/MM/YYYY`
- [ ] Streams include `Care Management` and `AT-HM` as first-class rows in the stream breakdown, never folded
- [ ] Anomaly severity chips render `HIGH`/`MEDIUM`/`LOW` (not `alert`/`warning`/`info`)
- [ ] Signed-in AI-Tools decodes return `persisted_statement_id` and the app offers "Open in Statements"
- [ ] Tapping Download PDF/CSV downloads the server file and opens the native share sheet
- [ ] `parsing_warnings`, when non-empty, surface as a small warning strip
- [ ] Line-item table renders one row per line item (no cell wrapping across rows)
- [ ] Statement Detail screen and AI-Tools result screen render the **same** component tree from Sections A–F — no divergence

---

## 8. Test credentials

- **Family plan caregiver**: `cathy@example.com` / `testpass123`
  - Has multiple decoded statements to browse. Latest: `AI Tools decode · 1 May 2026 to 31 May 2026`.
- **Solo trial user**: `trial30909@example.com` / `TrialPass1!` (currently expired — good for verifying read-only lockdown on the decoder form; see `MOBILE_AGENT_READONLY_MODE.md`)

Sample text for pasted-decode QA (5 lines, all four streams represented, 3 anomalies expected):

```
Sunshine Aged Care · Support at Home Statement
Participant: Margaret Chen · Classification: 6
Period: 1 May 2026 to 31 May 2026
03/05/2026  Nursing visit           Clinical         1.0  $180.00  $180.00  $0.00   $180.00
10/05/2026  Physiotherapy           Clinical         1.0  $140.00  $140.00  $0.00   $140.00
17/05/2026  Personal care           Independence     2.0   $85.00  $170.00  $17.00  $153.00
24/05/2026  Personal care           Independence     2.0   $85.00  $170.00  $17.00  $153.00
31/05/2026  Domestic assistance     Everyday Living  2.5   $75.00  $187.50  $37.50  $150.00
Total $847.50 · You paid $71.50 · Govt paid $776.00
```

---

## 9. Do NOT reimplement

- Do NOT reproduce the plain-English summary on the client. The backend generates it deterministically from the audit; just display `stmt.summary`.
- Do NOT translate severity names or stream names — display them as returned.
- Do NOT paginate anomalies. They're small (≤ 15 typically) and should all render.
- Do NOT introduce a client PDF library — use the server endpoint + share sheet.
- Do NOT ask for read/write access to any file the user has attached to a statement beyond what `/api/statements/{id}/download` returns.
