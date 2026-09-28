import { requireNativeModule } from 'expo-modules-core';

const OfflineGpsModule = requireNativeModule('OfflineGps');

export async function startOfflineTracking(deviceId: string, supabaseUrl: string, supabaseAnonKey: string): Promise<void> {
  return OfflineGpsModule.startOfflineTracking(deviceId, supabaseUrl, supabaseAnonKey);
}

export async function stopOfflineTracking(): Promise<void> {
  return OfflineGpsModule.stopOfflineTracking();
}

export async function setLostMode(isLost: boolean): Promise<boolean> {
  return OfflineGpsModule.setLostMode(isLost);
}

export async function isHighAccuracyActive(): Promise<boolean> {
  return OfflineGpsModule.isHighAccuracyActive();
}
