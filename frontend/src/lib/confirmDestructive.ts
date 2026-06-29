// Cross-platform "destructive" confirm dialog.
//
// Background: `Alert.alert(...)` on react-native-web is a no-op — the modal
// never renders, and the callback never fires. That silently breaks "Are you
// sure?" flows when running the mobile bundle in the web preview. Our QA
// pipeline (`testing_agent` + the Emergent web preview) all use the web
// platform, so this helper is non-negotiable for any destructive action.
//
// Usage:
//   confirmDestructive({
//     title: 'Remove this contact?',
//     message: 'You can add them back later.',
//     confirmLabel: 'Remove',
//     onConfirm: () => doDelete(),
//   });
//
// On native (iOS / Android) we still get the polished `Alert.alert` UX.
import { Alert, Platform } from 'react-native';

export type ConfirmOpts = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel?: () => void;
  destructive?: boolean;
};

export function confirmDestructive(opts: ConfirmOpts) {
  const {
    title,
    message = '',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    onConfirm,
    onCancel,
    destructive = true,
  } = opts;

  if (Platform.OS === 'web') {
    // Build a single-string prompt for window.confirm — it's not pretty but
    // it's reliable across every browser and headless test environment.
    const prompt = message ? `${title}\n\n${message}` : title;
    try {
      // eslint-disable-next-line no-undef
      const ok = typeof window !== 'undefined' && window.confirm(prompt);
      if (ok) onConfirm();
      else onCancel?.();
    } catch {
      // If something blocks window.confirm (e.g. tests stubbing it out), play
      // it safe and DON'T silently delete — surface to onCancel instead.
      onCancel?.();
    }
    return;
  }

  Alert.alert(title, message || undefined, [
    { text: cancelLabel, style: 'cancel', onPress: onCancel },
    { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: onConfirm },
  ]);
}
