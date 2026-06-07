// Sensitive-screen hook (Phase 6 hardening).
// -------------------------------------------
// While a screen is mounted, we ask the OS not to allow:
//   • Screenshots
//   • Screen recording
//   • Snapshots in the iOS App Switcher / Android Recents
//
// Apply this on any screen that displays:
//   • Account balances or dollar amounts (Today, Budget, Statement detail)
//   • Health/wellbeing notes
//   • Statement OCR results / decoder output
//   • Document Vault items
//   • Adviser pack contents
//   • Anything carrying participant PII
//
// Implementation: wraps `expo-screen-capture`. Web is a no-op (browsers don't
// expose this control). Cleanup runs on unmount so other screens stay
// shareable (e.g. the public-facing onboarding).
import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as ScreenCapture from 'expo-screen-capture';

let activeMounts = 0;

async function activate(): Promise<void> {
  if (Platform.OS === 'web') return;
  activeMounts += 1;
  if (activeMounts === 1) {
    try {
      await ScreenCapture.preventScreenCaptureAsync('wayly-sensitive');
    } catch {}
  }
}

async function release(): Promise<void> {
  if (Platform.OS === 'web') return;
  if (activeMounts > 0) activeMounts -= 1;
  if (activeMounts === 0) {
    try {
      await ScreenCapture.allowScreenCaptureAsync('wayly-sensitive');
    } catch {}
  }
}

/**
 * Mark the screen as sensitive — disables screenshots, screen recording, and
 * task-switcher snapshots while mounted. Idempotent if the user navigates
 * between two sensitive screens (the count is ref-counted).
 *
 * Usage (top of a screen component):
 *   useSensitiveScreen();
 */
export function useSensitiveScreen(enabled: boolean = true): void {
  useEffect(() => {
    if (!enabled) return;
    activate();
    return () => {
      release();
    };
  }, [enabled]);
}

/** Imperative variant for one-off flows (e.g. opening a temporary modal). */
export const SensitiveCapture = {
  prevent: activate,
  allow: release,
};
