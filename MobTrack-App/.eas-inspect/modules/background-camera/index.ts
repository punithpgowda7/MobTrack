import { requireNativeModule } from 'expo-modules-core';

const BackgroundCameraModule = requireNativeModule('BackgroundCamera');

/**
 * Start the Android foreground service with CameraX.
 * Shows a persistent notification and initializes the camera hardware.
 */
export async function startService(): Promise<void> {
  return BackgroundCameraModule.startService();
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
