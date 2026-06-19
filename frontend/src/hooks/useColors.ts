// Theme-aware colour palette. Use in screen StyleSheets so dark mode
// actually swaps surfaces. Returns the same shape as the static `Colors`
// export so call-sites only need a one-line change.
import { useTheme } from '../context/ThemeContext';
import { getColors } from '../lib/theme';
import type { ColorPalette } from '../lib/theme';

export function useColors(): ColorPalette {
  const { effective } = useTheme();
  return getColors(effective);
}
