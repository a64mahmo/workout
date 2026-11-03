import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

/** Taptic feedback inside the native iOS app; a silent no-op on the web. */
const native = () => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

export const haptic = {
  /** Tab switches, toggles. */
  selection: () => native() && void Haptics.selectionChanged().catch(() => {}),
  /** Completing a set, primary buttons. */
  light: () => native() && void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {}),
  /** Finishing a workout, PRs. */
  success: () => native() && void Haptics.notification({ type: NotificationType.Success }).catch(() => {}),
};
