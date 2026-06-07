// Phase 10 hardening — runtime log redaction.
// ----------------------------------------------------------------
// Production builds (`__DEV__ === false`) wrap console.{log,info,warn,error}
// and:
//   1. Disable `console.log` and `console.info` entirely (no debug info
//      should reach release builds; reduces fingerprintable behaviour and
//      avoids leaking response payloads through device logs).
//   2. Redact common sensitive patterns from `warn` / `error` payloads
//      (JWTs, Expo push tokens, emails, AU phone numbers, AU TFNs).
//   3. Keep stack traces and error messages — those are needed for crash
//      reporters (Sentry) when we wire them up.
//
// Dev mode is left untouched so iteration speed isn't slowed.
//
// Idempotent: calling installLogRedactor() multiple times is safe.

const SENSITIVE_KEY_RX =
  /\b(password|pass|secret|token|api_key|apikey|authorization|auth|jwt|bearer)\b/i;

const PATTERNS: Array<[RegExp, string]> = [
  // Bearer/JWT tokens (eyJ... three base64 segments)
  [/\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b/g, '[redacted:jwt]'],
  // Expo push tokens
  [/\bExponentPushToken\[[^\]]+\]\b/g, '[redacted:expo-push]'],
  // Email
  [/\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g, '[redacted:email]'],
  // AU mobile / landline (very rough, intentional)
  [/\b\+?61\s?\d{3}\s?\d{3}\s?\d{3}\b/g, '[redacted:phone]'],
  [/\b0[2-578]\d{2}\s?\d{3}\s?\d{3}\b/g, '[redacted:phone]'],
  // 9-digit TFN
  [/\b\d{3}\s?\d{3}\s?\d{3}\b/g, '[redacted:tfn?]'],
  // Stripe-style secret keys
  [/\bsk_(test|live)_[A-Za-z0-9]{16,}\b/g, '[redacted:stripe]'],
];

function redactString(input: string): string {
  let out = input;
  for (const [rx, sub] of PATTERNS) {
    out = out.replace(rx, sub);
  }
  return out;
}

function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return value;
  if (value == null) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj)) {
    if (SENSITIVE_KEY_RX.test(k)) {
      out[k] = '[redacted]';
    } else {
      out[k] = redactValue(obj[k], depth + 1);
    }
  }
  return out;
}

let installed = false;

export function installLogRedactor(): void {
  if (installed) return;
  installed = true;

  // In development, leave the console untouched — iteration speed matters.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((globalThis as any).__DEV__) {
    return;
  }

  const noop = () => {};
  /* eslint-disable no-console */
  console.log = noop;
  console.info = noop;
  console.debug = noop;

  const wrap = (orig: (...args: unknown[]) => void) =>
    (...args: unknown[]) => orig(...args.map((a) => redactValue(a)));

  console.warn = wrap(console.warn.bind(console));
  console.error = wrap(console.error.bind(console));
  /* eslint-enable no-console */
}

// Exported for tests + the secureStorage clear flow.
export const __test__ = { redactString, redactValue };
