// ThemedShell — applies accessibility settings (dark mode, high contrast, text scale) to the whole app.
// Strategy:
//   - Text scale: monkey-patch Text.render once so every Text in the app multiplies its fontSize.
//   - Dark mode: overlay a translucent dark layer above content but below the AccessibilityWidget pill (zIndex 9999).
//   - High contrast: CSS filter on web; subtle tint on native (proper per-screen theming would need useColors() wired everywhere).
//   - Reduce motion: exposed via useAccessibility() so animated components can opt out (Toast already supports this).
import React, { useEffect } from 'react';
import { View, StyleSheet, Text, Platform } from 'react-native';
import { useAccessibility } from '../context/AccessibilityContext';

// Patch Text.render once at module load — multiplies fontSize by the current scale.
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

  // Sync scale into the Text patch so every subsequent render uses it.
  // Also bump a key when scale changes so the tree re-mounts and picks up the new scale.
  useEffect(() => {
    (Text as any).__waylyScale = a11y.scale;
  }, [a11y.scale]);

  return (
    <View style={styles.root}>
      <View
        style={[
          styles.content,
          // Web: use CSS zoom to scale text + layout proportionally.
          // Native: rely on patched Text.render (best-effort).
          Platform.OS === 'web' && a11y.scale !== 1.0
            ? ({ zoom: a11y.scale } as any)
            : null,
        ]}
        key={`scale-${a11y.scale}`}
      >
        {children}
      </View>

      {/* Dark mode overlay: tints cream/light surfaces to dark navy without rewriting every StyleSheet.
          pointerEvents="none" so it never blocks taps. zIndex 100 sits above content but below the
          AccessibilityWidget pill (zIndex 9999) and any Modal (which is portaled higher). */}
      {a11y.darkMode && (
        <View
          pointerEvents="none"
          style={[
            styles.overlay,
            Platform.OS === 'web'
              ? ({ backgroundColor: 'rgba(15, 25, 36, 0.72)', mixBlendMode: 'multiply' } as any)
              : { backgroundColor: 'rgba(15, 25, 36, 0.55)' },
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
