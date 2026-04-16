/**
 * Platform Detection Utilities
 * Detect runtime platform and scanner capabilities
 */

import { Capacitor } from '@capacitor/core';
import type { Platform, ScannerCapabilities } from './types';

/**
 * Get the current platform
 */
export function getPlatform(): Platform {
  if (Capacitor.isNativePlatform()) {
    const platform = Capacitor.getPlatform();
    if (platform === 'ios') return 'ios';
    if (platform === 'android') return 'android';
  }
  return 'web';
}

/**
 * Check if running in native context
 */
export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Check if running on iOS
 */
export function isIOS(): boolean {
  return getPlatform() === 'ios';
}

/**
 * Check if running on Android
 */
export function isAndroid(): boolean {
  return getPlatform() === 'android';
}

/**
 * Check if running in web browser
 */
export function isWeb(): boolean {
  return getPlatform() === 'web';
}

/**
 * Get scanner capabilities for current platform
 */
export function getScannerCapabilities(): ScannerCapabilities {
  const platform = getPlatform();
  
  switch (platform) {
    case 'ios':
      return {
        platform: 'ios',
        hasNativeScanner: true,
        hasOcr: true, // Apple Vision
        hasCameraAccess: true,
        maxPageLimit: 20,
      };
    case 'android':
      return {
        platform: 'android',
        hasNativeScanner: true,
        hasOcr: true, // ML Kit
        hasCameraAccess: true,
        maxPageLimit: 20,
      };
    case 'web':
    default:
      return {
        platform: 'web',
        hasNativeScanner: false,
        hasOcr: false, // Web OCR not implemented in v1
        hasCameraAccess: 'mediaDevices' in navigator,
        maxPageLimit: 20,
      };
  }
}

/**
 * Check if camera is available
 */
export async function hasCameraAccess(): Promise<boolean> {
  if (!('mediaDevices' in navigator)) {
    return false;
  }
  
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some(device => device.kind === 'videoinput');
  } catch {
    return false;
  }
}

/**
 * Request camera permission
 */
export async function requestCameraPermission(): Promise<boolean> {
  if (!('mediaDevices' in navigator)) {
    return false;
  }
  
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    // Stop the stream immediately after getting permission
    stream.getTracks().forEach(track => track.stop());
    return true;
  } catch {
    return false;
  }
}
