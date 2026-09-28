import { requireNativeModule, EventEmitter, EventSubscription } from 'expo-modules-core';
import { Platform } from 'react-native';

let ApkUpdaterModule: any = null;
try {
  if (Platform.OS === 'android') {
    ApkUpdaterModule = requireNativeModule('ApkUpdater');
  }
} catch (e) {
  console.warn('ApkUpdater native module not available in this build:', e);
}

let emitter: any = null;
try {
  if (ApkUpdaterModule) {
    emitter = new EventEmitter(ApkUpdaterModule);
  }
} catch (e) {
  console.warn('ApkUpdater EventEmitter not available:', e);
}

export interface AppVersionInfo {
  versionCode: number;
  versionName: string;
  packageName: string;
}

export interface DownloadProgressEvent {
  progress: number;
  percent: number;
  receivedBytes: number;
  totalBytes: number;
}

export async function getAppVersion(): Promise<AppVersionInfo> {
  if (ApkUpdaterModule && typeof ApkUpdaterModule.getAppVersion === 'function') {
    try {
      const res = await ApkUpdaterModule.getAppVersion();
      if (res && res.versionCode != null) {
        return {
          versionCode: Number(res.versionCode),
          versionName: String(res.versionName || '1.0.0'),
          packageName: String(res.packageName || 'com.punithpgowda.mobtrackappclean'),
        };
      }
    } catch (err) {
      console.warn('ApkUpdaterModule.getAppVersion error:', err);
    }
  }
  return { versionCode: 1, versionName: '1.0.0', packageName: 'com.punithpgowda.mobtrackappclean' };
}

export function getDeviceId(): string {
  if (ApkUpdaterModule && typeof ApkUpdaterModule.getDeviceId === 'function') {
    try {
      return String(ApkUpdaterModule.getDeviceId() || '');
    } catch (_) {}
  }
  return '';
}

export function canRequestPackageInstalls(): boolean {
  if (ApkUpdaterModule && typeof ApkUpdaterModule.canRequestPackageInstalls === 'function') {
    try {
      return Boolean(ApkUpdaterModule.canRequestPackageInstalls());
    } catch (_) {}
  }
  return false;
}

export function openInstallPermissionSettings(): boolean {
  if (ApkUpdaterModule && typeof ApkUpdaterModule.openInstallPermissionSettings === 'function') {
    try {
      return Boolean(ApkUpdaterModule.openInstallPermissionSettings());
    } catch (_) {}
  }
  return false;
}

export async function downloadApk(apkUrl: string): Promise<string> {
  if (ApkUpdaterModule && typeof ApkUpdaterModule.downloadApk === 'function') {
    return ApkUpdaterModule.downloadApk(apkUrl);
  }
  throw new Error('ApkUpdater native module is not compiled into this APK. Please install the latest build once.');
}

export async function installApk(filePath?: string): Promise<boolean> {
  if (ApkUpdaterModule && typeof ApkUpdaterModule.installApk === 'function') {
    return ApkUpdaterModule.installApk(filePath || null);
  }
  throw new Error('ApkUpdater native module is not compiled into this APK. Please install the latest build once.');
}

export function addDownloadProgressListener(
  listener: (event: DownloadProgressEvent) => void
): EventSubscription | null {
  if (!emitter || typeof emitter.addListener !== 'function') return null;
  try {
    return emitter.addListener('onDownloadProgress', listener);
  } catch (err) {
    console.warn('Failed to add download progress listener:', err);
    return null;
  }
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (ApkUpdaterModule && typeof ApkUpdaterModule.verifyPassword === 'function') {
    try {
      return Boolean(await ApkUpdaterModule.verifyPassword(password, storedHash));
    } catch (err) {
      console.warn('ApkUpdaterModule.verifyPassword error:', err);
    }
  }
  return false;
}

