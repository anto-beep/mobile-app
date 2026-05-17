// Biometric helper — wraps expo-local-authentication with sensible fallbacks.
// On web (where biometrics aren't available) we degrade to a confirm() prompt so the
// developer experience still flows end-to-end. On native devices it triggers Face ID
// / Touch ID / Android biometric. Returns true if the user is authenticated.
import { Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';

export type BiometricResult = {
  success: boolean;
  reason?: 'unavailable' | 'cancelled' | 'failed' | 'no-enrolled' | 'web-confirm-declined';
  biometryType?: 'face' | 'fingerprint' | 'iris' | 'unknown';
};

async function detectBiometryType(): Promise<BiometricResult['biometryType']> {
  try {
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) return 'face';
    if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) return 'fingerprint';
    if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) return 'iris';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function confirmWithBiometric(promptMessage: string): Promise<BiometricResult> {
  // Web fallback — there's no Face ID in a browser tab.
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    const ok = typeof window !== 'undefined' && window.confirm(`${promptMessage}\n\n(Web fallback — on a real device this would trigger Face ID / Touch ID.)`);
    return { success: ok, reason: ok ? undefined : 'web-confirm-declined', biometryType: 'unknown' };
  }
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    if (!hasHardware) return { success: false, reason: 'unavailable' };
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!enrolled) return { success: false, reason: 'no-enrolled' };
    const type = await detectBiometryType();
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel: 'Cancel',
      disableDeviceFallback: false,
      fallbackLabel: 'Use passcode',
    });
    if (result.success) return { success: true, biometryType: type };
    const cancelled = (result as any).error === 'user_cancel' || (result as any).error === 'system_cancel';
    return { success: false, reason: cancelled ? 'cancelled' : 'failed', biometryType: type };
  } catch {
    return { success: false, reason: 'failed' };
  }
}

export function biometryLabel(type?: BiometricResult['biometryType']): string {
  if (type === 'face') return 'Face ID';
  if (type === 'fingerprint') return Platform.OS === 'ios' ? 'Touch ID' : 'fingerprint';
  if (type === 'iris') return 'iris scan';
  return Platform.OS === 'ios' ? 'Face ID / Touch ID' : 'biometric';
}
