import { requireNativeModule, EventEmitter } from 'expo-modules-core';

const BackgroundCameraModule = requireNativeModule('BackgroundCamera');
const emitter = new EventEmitter(BackgroundCameraModule);

/**
 * Start the Android foreground service with CameraX.
 * Shows a persistent notification and initializes the camera hardware.
 */
export async function startService(activateCamera = false): Promise<void> {
  return BackgroundCameraModule.startService(activateCamera);
}

/** Open the camera inside the already-running visible foreground service. */
export async function activateCamera(): Promise<void> {
  return BackgroundCameraModule.activateCamera();
}

/** Release the camera hardware while keeping the visible session service alive. */
export async function deactivateCamera(): Promise<void> {
  return BackgroundCameraModule.deactivateCamera();
}

/**
 * Stop the foreground service and release the camera.
 */
export async function stopService(): Promise<void> {
  return BackgroundCameraModule.stopService();
}

/**
 * Capture a photo using CameraX (works even when app is in background).
 * Returns the photo as a base64-encoded JPEG string.
 */
export async function capturePhoto(): Promise<string> {
  return BackgroundCameraModule.capturePhoto();
}

/**
 * Start live video streaming.
 * Activates the camera and begins emitting onVideoFrame events at ~10fps.
 * Listen with addVideoFrameListener().
 */
export async function startVideoStream(): Promise<void> {
  return BackgroundCameraModule.startVideoStream();
}

/**
 * Stop live video streaming. Camera hardware stays on for photo capture.
 */
export async function stopVideoStream(): Promise<void> {
  return BackgroundCameraModule.stopVideoStream();
}

/**
 * Subscribe to live video frame events.
 * @param listener Called with a base64-encoded JPEG string for each frame.
 * @returns A subscription object with a remove() method to unsubscribe.
 */
export function addVideoFrameListener(listener: (base64Frame: string) => void) {
  // @ts-ignore - expo-modules-core EventEmitter types don't infer dynamic event names properly
  return emitter.addListener('onVideoFrame', (event: { data: string }) => {
    listener(event.data);
  });
}

// ── Case 8: Intruder Selfie & Device Admin APIs ──────────────────────────────

export type IntruderPhoto = {
  filePath: string;
  timestamp: number;
  status: 'SAVED_LOCAL' | 'UPLOADED';
  publicUrl?: string | null;
};

export type IntruderConfig = {
  isAdminActive: boolean;
  enabled: boolean;
  threshold: number;
  failedAttempts: number;
};

/**
 * Check if the app is currently activated as an Android Device Administrator.
 */
export async function isDeviceAdminActive(): Promise<boolean> {
  return BackgroundCameraModule.isDeviceAdminActive();
}

/**
 * Launch Android system prompt to request Device Administrator privileges.
 */
export async function requestDeviceAdmin(): Promise<boolean> {
  return BackgroundCameraModule.requestDeviceAdmin();
}

/**
 * Sync the logged-in deviceId to native SharedPreferences for background uploads.
 */
export async function syncDeviceId(deviceId: string): Promise<boolean> {
  return BackgroundCameraModule.syncDeviceId(deviceId);
}

/**
 * Fetch current intruder selfie configuration and failed attempt stats.
 */
export async function getIntruderConfig(): Promise<IntruderConfig> {
  return BackgroundCameraModule.getIntruderConfig();
}

/**
 * Update intruder selfie enabled state and failed PIN threshold.
 */
export async function setIntruderConfig(enabled: boolean, threshold = 3): Promise<boolean> {
  return BackgroundCameraModule.setIntruderConfig(enabled, threshold);
}

/**
 * Fetch the list of captured intruder selfies from local storage and sync history.
 */
export async function getIntruderPhotos(): Promise<IntruderPhoto[]> {
  return BackgroundCameraModule.getIntruderPhotos();
}

/**
 * Trigger an immediate silent intruder selfie capture for testing/verification.
 */
export async function triggerIntruderTestCapture(): Promise<boolean> {
  return BackgroundCameraModule.triggerIntruderTestCapture();
}

/**
 * Check if the app has been granted "Display over other apps" (SYSTEM_ALERT_WINDOW) permission.
 */
export async function canDrawOverlays(): Promise<boolean> {
  return BackgroundCameraModule.canDrawOverlays();
}

/**
 * Open system settings page for "Display over other apps".
 */
export async function openOverlaySettings(): Promise<boolean> {
  return BackgroundCameraModule.openOverlaySettings();
}

/**
 * Open the app's system details page (App Info), where user can allow restricted settings on Android 13+.
 */
export async function openAppSettings(): Promise<boolean> {
  return BackgroundCameraModule.openAppSettings();
}

