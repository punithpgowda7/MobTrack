import { requireNativeModule } from 'expo-modules-core';

const FakeShutdownModule = requireNativeModule('FakeShutdown');

/** Start the FakeShutdown foreground service + activate accessibility overlay listener. */
export async function startService(unlockSequence: string[]): Promise<void> {
  return FakeShutdownModule.startService(unlockSequence);
}

/** Stop the foreground service and deactivate the overlay listener. */
export async function stopService(): Promise<void> {
  return FakeShutdownModule.stopService();
}

/** Update the unlock sequence while the service is already running. */
export async function updateConfig(unlockSequence: string[]): Promise<void> {
  return FakeShutdownModule.updateConfig(unlockSequence);
}

/** Returns true if SYSTEM_ALERT_WINDOW permission is granted. */
export async function canDrawOverlays(): Promise<boolean> {
  return FakeShutdownModule.canDrawOverlays();
}

/** Open the "Display over other apps" settings page. */
export async function openOverlaySettings(): Promise<void> {
  return FakeShutdownModule.openOverlaySettings();
}

/** Returns true if FakeShutdownAccessibilityService is enabled in Android settings. */
export async function isAccessibilityServiceEnabled(): Promise<boolean> {
  return FakeShutdownModule.isAccessibilityServiceEnabled();
}

/** Open the Android Accessibility Settings page so the user can enable the service. */
export async function openAccessibilitySettings(): Promise<void> {
  return FakeShutdownModule.openAccessibilitySettings();
}

/** Returns true if Do Not Disturb permission is granted. */
export async function hasDndPermission(): Promise<boolean> {
  return FakeShutdownModule.hasDndPermission();
}

/** Open the Do Not Disturb settings page. */
export async function openDndSettings(): Promise<void> {
  return FakeShutdownModule.openDndSettings();
}

export async function startSimMonitor(): Promise<void> {
  return FakeShutdownModule.startSimMonitor();
}

export async function stopSimMonitor(): Promise<void> {
  return FakeShutdownModule.stopSimMonitor();
}

export async function startAlarm(): Promise<void> {
  return FakeShutdownModule.startAlarm();
}

export async function stopAlarm(): Promise<void> {
  return FakeShutdownModule.stopAlarm();
}

/**
 * Enable the Fake Factory Reset overlay trigger (Cases 4 & 5).
 * After this, holding Power + Volume Down for 3 seconds shows the fake recovery screen.
 * Mutes all audio, enables DND, maximises brightness. Phone still runs normally.
 */
export async function enableFactoryReset(): Promise<void> {
  return FakeShutdownModule.enableFactoryReset();
}

/**
 * Disable the Fake Factory Reset overlay trigger.
 * Power + Volume Down combo will no longer show the fake recovery screen.
 * If the recovery overlay is currently showing, it will be dismissed.
 */
export async function disableFactoryReset(): Promise<void> {
  return FakeShutdownModule.disableFactoryReset();
}

export async function saveLastGaspPrefs(trusteeNumber: string, deviceId: string, batteryLimit: number, imeiNumber: string): Promise<void> {
  return FakeShutdownModule.saveLastGaspPrefs(trusteeNumber, deviceId, batteryLimit, imeiNumber);
}

export async function startLastGaspService(): Promise<void> {
  return FakeShutdownModule.startLastGaspService();
}

export async function stopLastGaspService(): Promise<void> {
  return FakeShutdownModule.stopLastGaspService();
}
