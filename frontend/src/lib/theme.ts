// Wayly brand theme — single source of truth for colors, typography, spacing
export const Colors = {
  background: '#FAF7F2',
  brandPrimary: '#1F3A5F',
  brandSecondary: '#D4A24E',
  cream: '#FAF7F2',

  // Stream colors (from web app)
  streams: {
    Clinical: '#3A5A40',
    Independence: '#8B9B82',
    'Everyday Living': '#A05545',
  } as Record<string, string>,

  // Anomaly severities
  severityAlert: '#A05545',     // terracotta
  severityWarning: '#D4A24E',   // gold
  severityInfo: '#8B9B82',      // sage

  // Text
  textPrimary: '#1F3A5F',
  textSecondary: '#546A87',
  textMuted: '#8B9B82',
  textInverse: '#FAF7F2',

  // Surfaces
  cardBg: '#FFFFFF',
  inputBg: '#FFFFFF',
  border: 'rgba(31, 58, 95, 0.1)',
  borderSubtle: 'rgba(31, 58, 95, 0.05)',

  // Status
  success: '#3A5A40',
  danger: '#A05545',
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 100,
} as const;

export const Fonts = {
  heading: 'Outfit_700Bold',
  headingMed: 'Outfit_600SemiBold',
  body: 'Figtree_400Regular',
  bodyMed: 'Figtree_500Medium',
  bodySemi: 'Figtree_600SemiBold',
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
