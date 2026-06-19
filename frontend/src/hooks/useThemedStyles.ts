// Phase-2 dark-mode helper.
//
// Mobile screens declare their styles at module scope via
// `StyleSheet.create({...})`, which means `Colors.X` is captured ONCE at import
// time and never re-evaluated when the user toggles Light/Dark/System.
//
// To get true dark-mode painting without rewriting every component, we move
// the StyleSheet.create call into a small factory `makeStyles(c)` and let
// this hook memoise the result per-palette.
//
// Usage:
//   function Screen() {
//     const c = useColors();
//     const styles = useThemedStyles(makeStyles);
//     ...
//   }
//   function makeStyles(c: ColorPalette) {
//     return StyleSheet.create({
//       safe: { backgroundColor: c.background },
//       title: { color: c.brandPrimary },
//     });
//   }
import { useMemo } from 'react';
import { useColors } from './useColors';
import type { ColorPalette } from '../lib/theme';

export function useThemedStyles<T>(factory: (c: ColorPalette) => T): T {
  const c = useColors();
  return useMemo(() => factory(c), [c]);
}
