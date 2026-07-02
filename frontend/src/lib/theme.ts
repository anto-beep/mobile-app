// Wayly brand theme — Feb 2026 refresh
// ------------------------------------------------------------
// Single source of truth for palette, typography, spacing, radii.
// All hex literals live HERE; components must use Colors.* tokens so a future
// palette refresh is a one-file change.
//
// Palette (Feb 2026):
//   • Primary brand     #0E4D52  teal-ink            (was #1F3A5F navy)
//   • Accent / CTA fill #A5512B  clay 500            (button bg; white text always)
//   • Focus ring        #C2683D  clay 400            (3px outline + 2px offset)
//   • App background    #FBF8F3  warm off-white      (was #FAF7F2)
//   • Body text         #1C2B2D  warm ink            (was #1F3A5F navy)
//   • Sage              #6B8F71 / body-safe #425F47
//   • Success           #1B5733  (AA on white)
//   • Warning           #B7791F  (AA on white)
//   • Error             #C0392B  (AA on white)
//
// Typography:
//   • Headings → Fraunces (serif, variable)
//   • Body / UI → Inter (sans, variable)
//   • Numbers / money / tables → IBM Plex Mono (with tabular-nums)
//   • Body text size: 17 / line-height 1.6 (never below 16)
//
// Radii:
//   • Card 16, button + input 10, pill 9999
//
// Touch targets:
//   • 48 px min, 56 px primary CTA, 60 px participant-view buttons
import { Platform } from 'react-native';

export const Colors = {
  // Core
  background: '#FBF8F3',          // warm off-white app shell
  bg: '#FBF8F3',                  // alias of `background`, keep both keys in sync
  brandPrimary: '#0E4D52',        // teal-ink, primary surfaces, headers, nav
  brandPrimaryDeep: '#073034',    // pressed/active state of teal surfaces
  brandSecondary: '#A5512B',      // clay 500, CTA fill (always white text)
  brandSecondaryDeep: '#7E3F22',  // pressed/active state of CTA
  focusRing: '#C2683D',           // clay 400, focus outline
  cream: '#FBF8F3',               // alias, used for inverse text on dark surfaces

  // Streams (consistent palette across charts + chips)
  streams: {
    Clinical: '#425F47',           // body-safe sage
    Independence: '#6B8F71',       // sage 500
    'Everyday Living': '#A5512B',  // clay 500
  } as Record<string, string>,

  // Anomaly severities (AA on white)
  severityAlert: '#C0392B',       // error red
  severityWarning: '#B7791F',     // amber warning
  severityInfo: '#6B8F71',        // sage info

  // Text — warm ink everywhere except inside dark teal surfaces
  textPrimary: '#1C2B2D',         // warm ink
  textSecondary: '#3D5557',       // dimmer warm ink for sub-copy
  textMuted: '#7A8A8C',           // subtle muted grey-teal
  textInverse: '#FFFFFF',         // text on teal-ink / clay surfaces, ALWAYS white

  // Surfaces
  cardBg: '#FFFFFF',
  cardBgWarm: '#F4EFE6',          // tonal alt card on warm bg
  inputBg: '#FFFFFF',
  border: 'rgba(14, 77, 82, 0.12)',     // teal-tinted hairline
  borderSubtle: 'rgba(14, 77, 82, 0.06)',
  surfaceTint: 'rgba(14, 77, 82, 0.05)', // hover/pressed tint on warm bg

  // Status — AA-compliant on white
  success: '#1B5733',
  warning: '#B7791F',
  danger: '#C0392B',
} as const;

// ─────────────────── DARK PALETTE (Phase 1) ───────────────────
// Warm near-black surfaces + crisp WHITE-FORWARD text. Per user request the
// dark mode leans heavily on white/near-white primaries so dark surfaces
// really contrast. Teal and clay remain accent colours.
export const DarkColors = {
  // UI-2/UI-3 parity: matches the web dark palette exactly.
  background: '#0B1416',
  bg: '#0B1416',
  brandPrimary: '#4FA8AE',          // bright teal accent (text/icons on dark)
  brandPrimaryDeep: '#0E4D52',      // banner surface (still deep teal)
  brandSecondary: '#E89A6F',        // clay, CTA accent on dark
  brandSecondaryDeep: '#A5512B',
  focusRing: '#EBC3A2',
  cream: '#FFFFFF',
  streams: {
    Clinical: '#A8C7AB',
    Independence: '#B8D3BB',
    'Everyday Living': '#E89A6F',
  } as Record<string, string>,
  severityAlert: '#F4988D',
  severityWarning: '#F0BE76',
  severityInfo: '#A8C7AB',
  textPrimary: '#FFFFFF',           // ALL headings pure white in dark
  textSecondary: '#E5E5E5',         // secondary body copy
  textMuted: '#C7C2B8',             // muted meta text (AAA on surfaces)
  textInverse: '#0B1416',
  cardBg: '#152425',                // surface
  cardBgWarm: '#1C2F31',            // surface2
  inputBg: '#060B0C',               // sunken
  border: '#2A3A3C',
  borderSubtle: 'rgba(255, 255, 255, 0.09)',
  surfaceTint: 'rgba(255, 255, 255, 0.06)',
  success: '#A8C7AB',               // bright sage replaces success-green in dark
  warning: '#F0BE76',
  danger: '#F4988D',
} as const;

export type ColorPalette = typeof Colors;

/** Resolve the active palette from a theme choice. */
export function getColors(effective: 'light' | 'dark'): ColorPalette {
  return effective === 'dark' ? (DarkColors as unknown as ColorPalette) : Colors;
}

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const Radius = {
  sm: 6,
  md: 10,         // buttons + inputs
  lg: 16,         // cards
  xl: 20,
  pill: 9999,
} as const;

// Touch targets — accessibility floor for tappable elements
export const TouchTarget = {
  min: 48,         // baseline (any tappable)
  primary: 56,     // primary mobile CTAs
  participant: 60, // Participant View buttons (older users)
} as const;

// Font families.
// ---------------
// On WEB and ANDROID, font family fallback chains "just work" — RN-web maps
// them straight to CSS font-family stacks, and Android falls back to its
// internal font index. On iOS, however, React Native does NOT honour fallback
// stacks — `fontFamily: 'Fraunces, serif'` is treated as a single family name
// that won't be found. So on iOS we ALWAYS request the exact PostScript name
// of the bundled TTF; if that fails to register the system will fall back to
// the default UI font automatically (no white screen).
//
// The TTFs are registered in app/_layout.tsx via expo-font's useFonts() with
// keys exactly matching the strings below. Variable fonts work in Expo SDK 50+
// but if they fail on a particular device, the system fallback kicks in.
export const Fonts = Platform.select({
  ios: {
    heading: 'Fraunces',
    headingMed: 'Fraunces',
    body: 'Inter',
    bodyMed: 'Inter',
    bodySemi: 'Inter',
    mono: 'IBM Plex Mono',
    monoMed: 'IBM Plex Mono Medium',
    monoSemi: 'IBM Plex Mono SemiBold',
  },
  android: {
    heading: 'Fraunces',
    headingMed: 'Fraunces',
    body: 'Inter',
    bodyMed: 'Inter',
    bodySemi: 'Inter',
    mono: 'IBM Plex Mono',
    monoMed: 'IBM Plex Mono Medium',
    monoSemi: 'IBM Plex Mono SemiBold',
  },
  default: {
    // Web — CSS picks the first registered family.
    heading: 'Fraunces, Georgia, serif',
    headingMed: 'Fraunces, Georgia, serif',
    body: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    bodyMed: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    bodySemi: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    mono: '"IBM Plex Mono", Menlo, monospace',
    monoMed: '"IBM Plex Mono Medium", "IBM Plex Mono", Menlo, monospace',
    monoSemi: '"IBM Plex Mono SemiBold", "IBM Plex Mono", Menlo, monospace',
  },
}) as {
  heading: string;
  headingMed: string;
  body: string;
  bodyMed: string;
  bodySemi: string;
  mono: string;
  monoMed: string;
  monoSemi: string;
};

// Body type scale — never below 16
export const Type = {
  // headings (Fraunces)
  h1: { fontFamily: Fonts.heading, fontSize: 30, lineHeight: 36, fontWeight: '700' as const, letterSpacing: -0.4 },
  h2: { fontFamily: Fonts.heading, fontSize: 24, lineHeight: 30, fontWeight: '700' as const, letterSpacing: -0.3 },
  h3: { fontFamily: Fonts.heading, fontSize: 20, lineHeight: 26, fontWeight: '600' as const },
  h4: { fontFamily: Fonts.heading, fontSize: 18, lineHeight: 24, fontWeight: '600' as const },
  // body (Inter)
  body: { fontFamily: Fonts.body, fontSize: 17, lineHeight: 27, fontWeight: '400' as const },
  bodyMed: { fontFamily: Fonts.body, fontSize: 17, lineHeight: 27, fontWeight: '500' as const },
  bodySemi: { fontFamily: Fonts.body, fontSize: 17, lineHeight: 27, fontWeight: '600' as const },
  bodySmall: { fontFamily: Fonts.body, fontSize: 14, lineHeight: 21, fontWeight: '400' as const },
  caption: { fontFamily: Fonts.body, fontSize: 12, lineHeight: 17, fontWeight: '500' as const, letterSpacing: 0.2 },
  overline: { fontFamily: Fonts.body, fontSize: 11, lineHeight: 14, fontWeight: '600' as const, letterSpacing: 1.4, textTransform: 'uppercase' as const },
  // numbers (IBM Plex Mono with tabular-nums)
  number: {
    fontFamily: Fonts.mono,
    fontSize: 17,
    lineHeight: 24,
    fontVariant: ['tabular-nums' as const],
  },
} as const;

// Helper — money values always get tabular-nums (use via <MoneyText /> wrapper).
export const moneyStyle = {
  fontFamily: Fonts.mono,
  fontVariant: ['tabular-nums' as const],
} as const;

export const formatAUD = (n: number | null | undefined): string => {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
};

export const formatAUD2 = (n: number | null | undefined): string => {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
};

// Compact AUD for chart labels: $1.4k / $12.3k / $843.
export const formatShort = (n: number | null | undefined): string => {
  const v = Number(n || 0);
  if (v >= 1000) return `$${(Math.round(v / 100) / 10).toFixed(1)}k`;
  return `$${Math.round(v)}`;
};

// Best-effort month label from a period_label ("April 2026" → "Apr") or ISO date.
export const shortPeriod = (s: string | null | undefined): string => {
  if (!s) return '—';
  const m = String(s).match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i);
  if (m) return m[0][0].toUpperCase() + m[0].slice(1, 3).toLowerCase();
  const d = new Date(String(s));
  if (!isNaN(d.getTime())) return d.toLocaleString('en-AU', { month: 'short' });
  return String(s).slice(0, 6);
};

// Convenience export for places that need to know the platform's "system" stack
// as a fallback (e.g., RN-web before fonts load).
export const SystemFonts = Platform.select({
  ios: { serif: 'Georgia', sans: '-apple-system', mono: 'Menlo' },
  android: { serif: 'serif', sans: 'sans-serif', mono: 'monospace' },
  default: { serif: 'Georgia', sans: 'system-ui', mono: 'Menlo' },
}) as { serif: string; sans: string; mono: string };
