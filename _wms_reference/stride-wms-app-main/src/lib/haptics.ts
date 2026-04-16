/**
 * Cross-platform haptic feedback utility
 * Uses Capacitor Haptics in native builds; falls back to navigator.vibrate on web.
 */

import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

/**
 * Check if vibration API is available
 */
function canVibrate(): boolean {
  return typeof navigator !== 'undefined' && 'vibrate' in navigator;
}

function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

function safeNativeImpact(style: ImpactStyle): void {
  try {
    void Haptics.impact({ style });
  } catch {
    // ignore
  }
}

function safeNativeNotification(type: NotificationType): void {
  try {
    void Haptics.notification({ type });
  } catch {
    // ignore
  }
}

/**
 * Light vibration for subtle feedback (mode selection, item added to batch)
 */
export function hapticLight(): void {
  if (isNative()) {
    safeNativeImpact(ImpactStyle.Light);
    return;
  }
  if (canVibrate()) {
    navigator.vibrate(10);
  }
}

/**
 * Medium impact for successful actions (scan detected, item/location found)
 */
export function hapticMedium(): void {
  if (isNative()) {
    safeNativeImpact(ImpactStyle.Medium);
    return;
  }
  if (canVibrate()) {
    navigator.vibrate(25);
  }
}

/**
 * Strong impact for confirmations (swipe complete)
 */
export function hapticHeavy(): void {
  if (isNative()) {
    safeNativeImpact(ImpactStyle.Heavy);
    return;
  }
  if (canVibrate()) {
    navigator.vibrate(50);
  }
}

/**
 * Success pattern - double tap for confirmed actions
 */
export function hapticSuccess(): void {
  if (isNative()) {
    safeNativeNotification(NotificationType.Success);
    return;
  }
  if (canVibrate()) {
    navigator.vibrate([30, 50, 30]);
  }
}

/**
 * Error pattern - longer vibration for failures
 */
export function hapticError(): void {
  if (isNative()) {
    safeNativeNotification(NotificationType.Error);
    return;
  }
  if (canVibrate()) {
    // Longer pattern so users can clearly distinguish an error scan.
    navigator.vibrate([150, 60, 150]);
  }
}

/**
 * Selection tick - very subtle feedback for selections
 */
export function hapticSelection(): void {
  if (isNative()) {
    try {
      void Haptics.selectionChanged();
    } catch {
      // ignore
    }
    return;
  }
  if (canVibrate()) {
    navigator.vibrate(5);
  }
}
