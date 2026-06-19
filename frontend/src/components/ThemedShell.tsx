// ThemedShell — applies accessibility settings (dark mode, high contrast, text scale) to the whole app.
//
// Strategy (rewritten — June 2026):
//   • Text scale on NATIVE: monkey-patch Text.render once at module load so every
//     Text in the app multiplies its fontSize by Text.__waylyScale. We set
//     __waylyScale synchronously during ThemedShell's render so the very first
//     render after a scale change already uses the new value (no 1-cycle lag).
//     The `key=scale-${scale}` on the inner content wrapper then forces every
//     Text to re-render and pick up the patched fontSize.
//   • Text scale on WEB: react-native-web's Text doesn't expose a `render`
//     static, so the monkey-patch silently no-ops there. Instead we set
//     `documentElement.style.zoom` via useEffect — that scales the entire
//     viewport including every RN-web Text without bouncing any state or
//     remounting the tree, so navigation, form input, and active-pill state all
//     stay intact.
//   • Dark mode: overlay a translucent dark layer above content but below the
//     AccessibilityWidget pill (zIndex 9999).
//   • High contrast: CSS filter on web; subtle tint on native.
//   • Reduce motion: exposed via useAccessibility() so animated components can
//     opt out (Toast already supports this).
import React, { useEffect } from 'react';
import { View, StyleSheet, Text, Platform } from 'react-native';
import { useAccessibility } from '../context/AccessibilityContext';
import { useTheme } from '../context/ThemeContext';

// Patch Text.render once at module load — multiplies fontSize by the current
// scale. Works on iOS/Android where Text has a render static; on react-native-
// web Text.render isn't a function so we early-return (zoom on <html> handles
// web instead).
(function patchTextOnce() {
  const T: any = Text;
  if (T.__waylyRenderPatched) return;
  T.__waylyRenderPatched = true;
  T.__waylyScale = 1.0;
  const origRender = T.render;
  if (typeof origRender !== 'function') return;
  T.render = function (...args: any[]) {
    const elem = origRender.apply(this, args);
    const scale = (T.__waylyScale as number) || 1.0;
    if (!elem || scale === 1.0) return elem;
    const incoming = elem.props?.style;
    const flat = StyleSheet.flatten(incoming) || {};
    const base = (flat as any).fontSize;
    const scaledFontSize = typeof base === 'number' ? base * scale : 14 * scale;
    return React.cloneElement(elem, {
      style: [incoming, { fontSize: scaledFontSize }],
      allowFontScaling: false,
    });
  };
})();

export function ThemedShell({ children }: { children: React.ReactNode }) {
  const a11y = useAccessibility();
  const theme = useTheme();
  // Theme picker (light/dark/system) overrides the a11y darkMode toggle.
  const isDark = theme.effective === 'dark' || a11y.darkMode;

  // Web-only: apply a CSS `invert + hue-rotate` filter to the document root
  // when dark mode is on. This is the classic trick that flips light surfaces
  // to dark and dark text to light without rewriting every StyleSheet. It
  // preserves brand colours reasonably (teal → warm rust). On native we
  // fall back to a translucent dark overlay below.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    try {
      const root = (globalThis as any).document?.documentElement;
      if (!root) return;
      const existing = root.style.filter || '';
      const cleaned = existing.replace(/\s*invert\(1\)\s*hue-rotate\(180deg\)\s*/g, '').trim();
      root.style.filter = isDark ? `${cleaned} invert(1) hue-rotate(180deg)`.trim() : cleaned;
      root.style.background = isDark ? '#000' : '';
    } catch {}
  }, [isDark]);

  // Native: sync scale synchronously so any Text rendered this cycle uses it.
  if (Platform.OS !== 'web') {
    (Text as any).__waylyScale = a11y.scale;
  }

  // Web: apply CSS zoom to the document root so every RN-web Text scales
  // proportionally without a remount. Skip when scale === 1.0 so we don't
  // leave a stale `zoom` style on the element.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    try {
      const root = (globalThis as any).document?.documentElement;
      if (!root) return;
      root.style.zoom = a11y.scale === 1.0 ? '' : String(a11y.scale);
    } catch {
      // no-op on non-DOM hosts
    }
  }, [a11y.scale]);

  return (
    <View style={styles.root}>
      <View
        style={styles.content}
        // Native only: bump the key so every Text remounts and picks up the
        // patched scale. On web we skip this — the CSS zoom on <html> covers
        // scaling without remounting and (critically) without resetting
        // navigation/form state from the Settings → Appearance screen.
        key={Platform.OS === 'web' ? 'web-no-remount' : `scale-${a11y.scale}`}
      >
        {children}
      </View>

      {/* Dark mode for NATIVE: use a near-opaque dark overlay with multiply
          blending so cream surfaces actually turn dark and text reads white.
          On web we skip this — the `invert + hue-rotate` filter on the root
          element (see useEffect above) handles it cleanly there. */}
      {isDark && Platform.OS !== 'web' && (
        <View
          pointerEvents="none"
          style={[
            styles.overlay,
            { backgroundColor: 'rgba(0, 0, 0, 0.86)' },
          ]}
          testID="dark-mode-overlay"
        />
      )}

      {/* High contrast: CSS filter on web; gentle tint fallback on native. */}
      {a11y.highContrast && (
        <View
          pointerEvents="none"
          style={[
            styles.overlay,
            Platform.OS === 'web'
              ? ({ filter: 'contrast(1.2) saturate(1.1)' } as any)
              : { backgroundColor: 'rgba(0,0,0,0.03)' },
          ]}
          testID="high-contrast-overlay"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, position: 'relative' },
  content: { flex: 1 },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
  },
});
