import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, PermissionsAndroid, Platform, ScrollView, StyleSheet, Text, TextInput, View, Switch, Modal, TouchableOpacity, Image, ActivityIndicator, PanResponder } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { decode } from 'base64-arraybuffer';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { supabase, supabaseUrl, supabaseAnonKey } from './supabase';
import { hashPassword, verifyPassword, hashBackupCodes, verifyBackupCode } from './lib/auth-crypto';
import * as BackgroundCamera from './modules/background-camera';
import * as BackgroundAudio from './modules/background-audio';
import * as FakeShutdown from './modules/fake-shutdown';
import * as ApkUpdater from './modules/apk-updater';
import * as OfflineGps from './modules/offline-gps';
import * as SmsGateway from './modules/sms-gateway';
import type { EventSubscription } from 'expo-modules-core';

type ButtonToken = 'volUp' | 'volDown' | 'power';

const BUTTON_LABELS: Record<ButtonToken, string> = {
  volUp:   '🔊 VOL UP',
  volDown: '🔉 VOL DOWN',
  power:   '⏻ POWER',
};

const imeiBoxImg = require('./assets/images/imei_box.jpg');
const imeiDialerImg = require('./assets/images/imei_dialer.jpg');
const imeiSettingsImg = require('./assets/images/imei_settings.jpg');

const validatePassword = (pwd: string): string | null => {
  if (pwd.length < 8) return 'Password must be at least 8 characters long.';
  if (!/[A-Z]/.test(pwd)) return 'Password must contain at least 1 uppercase letter.';
  if (!/[a-z]/.test(pwd)) return 'Password must contain at least 1 lowercase letter.';
  if (!/[0-9]/.test(pwd)) return 'Password must contain at least 1 number.';
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(pwd)) return 'Password must contain at least 1 special character.';
  return null;
};

// ── Interactive Battery Threshold Slider (1% - 100%) ───────────────────────────
const BatterySlider: React.FC<{
  value: number;
  onValueChange: (val: number) => void;
  min?: number;
  max?: number;
}> = ({ value, onValueChange, min = 1, max = 100 }) => {
  const trackRef = useRef<View>(null);
  const trackXRef = useRef(0);
  const trackWidthRef = useRef(0);

  const clampedVal = Math.min(Math.max(value || min, min), max);
  const range = max - min;
  const percentage = range > 0 ? (clampedVal - min) / range : 0;

  const measureTrack = () => {
    trackRef.current?.measure((x, y, width, height, pageX) => {
      if (width > 0) {
        trackXRef.current = pageX;
        trackWidthRef.current = width;
      }
    });
  };

  const handleTouch = (pageX: number) => {
    const width = trackWidthRef.current;
    const startX = trackXRef.current;
    if (width > 0) {
      const offsetX = pageX - startX;
      const ratio = Math.max(0, Math.min(1, offsetX / width));
      const calculated = Math.round(min + ratio * range);
      onValueChange(calculated);
    }
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt) => {
        measureTrack();
        handleTouch(evt.nativeEvent.pageX);
      },
      onPanResponderMove: (evt) => {
        handleTouch(evt.nativeEvent.pageX);
      },
      onPanResponderRelease: (evt) => {
        handleTouch(evt.nativeEvent.pageX);
      },
    })
  ).current;

  return (
    <View style={sliderStyles.container}>
      <View style={sliderStyles.headerRow}>
        <Text style={sliderStyles.headerLabel}>Emergency Battery Level</Text>
        <View style={sliderStyles.badge}>
          <Text style={sliderStyles.badgeText}>⚡ {clampedVal}%</Text>
        </View>
      </View>

      <View style={sliderStyles.controlsRow}>
        <TouchableOpacity
          style={sliderStyles.stepBtn}
          onPress={() => onValueChange(Math.max(min, clampedVal - 1))}
          activeOpacity={0.6}
        >
          <Text style={sliderStyles.stepBtnText}>−</Text>
        </TouchableOpacity>

        <View
          ref={trackRef}
          collapsable={false}
          onLayout={measureTrack}
          style={sliderStyles.trackContainer}
          {...panResponder.panHandlers}
        >
          <View style={sliderStyles.trackBackground} />
          <View style={[sliderStyles.trackActive, { width: `${percentage * 100}%` }]} />
          <View
            style={[
              sliderStyles.thumbKnob,
              { left: `${percentage * 100}%` },
            ]}
          >
            <View style={sliderStyles.thumbInnerDot} />
          </View>
        </View>

        <TouchableOpacity
          style={sliderStyles.stepBtn}
          onPress={() => onValueChange(Math.min(max, clampedVal + 1))}
          activeOpacity={0.6}
        >
          <Text style={sliderStyles.stepBtnText}>+</Text>
        </TouchableOpacity>
      </View>

      <View style={sliderStyles.scaleRow}>
        <Text style={sliderStyles.scaleLabel}>{min}% (Min)</Text>
        <Text style={sliderStyles.scaleLabel}>{Math.round((min + max) / 2)}%</Text>
        <Text style={sliderStyles.scaleLabel}>{max}% (Max)</Text>
      </View>
    </View>
  );
};

const sliderStyles = StyleSheet.create({
  container: {
    backgroundColor: '#161616',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#2e2e2e',
    marginVertical: 8,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerLabel: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '600',
  },
  badge: {
    backgroundColor: '#dc2626',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#262626',
    borderWidth: 1,
    borderColor: '#444',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepBtnText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
    lineHeight: 22,
  },
  trackContainer: {
    flex: 1,
    height: 36,
    justifyContent: 'center',
    position: 'relative',
  },
  trackBackground: {
    width: '100%',
    height: 8,
    backgroundColor: '#2b2b2b',
    borderRadius: 4,
  },
  trackActive: {
    position: 'absolute',
    left: 0,
    height: 8,
    backgroundColor: '#ef4444',
    borderRadius: 4,
  },
  thumbKnob: {
    position: 'absolute',
    top: 6,
    marginLeft: -12,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#ef4444',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
  },
  thumbInnerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ef4444',
  },
  scaleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingHorizontal: 12,
  },
  scaleLabel: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '500',
  },
});

const LOCATION_TASK_NAME = 'mobtrack-location-updates';

type LocationTaskData = {
  locations?: Location.LocationObject[];
};

// This task is registered at module scope as required by Expo. It runs while
// Android keeps the user-authorized location foreground service alive.
TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error || !data) return;
  const location = (data as LocationTaskData).locations?.[0];
  if (!location) return;

  const deviceId = await AsyncStorage.getItem('mobtrack_device_id');
  if (!deviceId) return;

  await supabase.from('devices').update({
    last_known_location: {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      accuracy: location.coords.accuracy,
      heading: location.coords.heading,
      speed: location.coords.speed,
      timestamp: location.timestamp,
    },
    location_active: true,
    location_last_error: null,
    last_seen_at: new Date().toISOString(),
  }).eq('id', deviceId);
});

export default function App() {
  const [linkedNumber, setLinkedNumber] = useState('');
  const [password, setPassword] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);

  // ── Auth Navigation & Screen States ───────────────────────────────────────
  const [authView, setAuthView] = useState<'login' | 'forgot' | 'register'>('login');

  // Forgot Password state
  const [forgotMobile, setForgotMobile] = useState('');
  const [forgotMode, setForgotMode] = useState<'backup' | 'trustee'>('backup');
  const [forgotBackupCode, setForgotBackupCode] = useState('');
  const [forgotTrusteeNumber, setForgotTrusteeNumber] = useState('');
  const [forgotOtpSent, setForgotOtpSent] = useState(false);
  const [forgotOtpInput, setForgotOtpInput] = useState('');
  const [forgotOtpLoading, setForgotOtpLoading] = useState(false);
  const [isForgotVerified, setIsForgotVerified] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [resetPassLoading, setResetPassLoading] = useState(false);

  // Create Account state
  const [regFullName, setRegFullName] = useState('');
  const [regMobileNumber, setRegMobileNumber] = useState('');
  const [regIsMobileVerified, setRegIsMobileVerified] = useState(false);
  const [regMobileVerifying, setRegMobileVerifying] = useState(false);
  const [regMobileOtp, setRegMobileOtp] = useState('');
  const [regMobileOtpLoading, setRegMobileOtpLoading] = useState(false);
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [regImei1, setRegImei1] = useState('');
  const [regImei2, setRegImei2] = useState('');
  const [regTrustees, setRegTrustees] = useState([
    { number: '', verified: false },
    { number: '', verified: false },
    { number: '', verified: false },
    { number: '', verified: false },
    { number: '', verified: false },
  ]);
  const [regTrusteeVerifyingIndex, setRegTrusteeVerifyingIndex] = useState<number | null>(null);
  const [regTrusteeOtp, setRegTrusteeOtp] = useState('');
  const [regTrusteeOtpLoading, setRegTrusteeOtpLoading] = useState(false);
  const [regFakeShutdownEnabled, setRegFakeShutdownEnabled] = useState(false);
  const [regSequence, setRegSequence] = useState<ButtonToken[]>([]);
  const [regLastGaspLimit, setRegLastGaspLimit] = useState(5);
  const [regLoading, setRegLoading] = useState(false);
  const [regGeneratedCodes, setRegGeneratedCodes] = useState<string[]>([]);
  
  const [statusMsg, setStatusMsg] = useState('');
  const [permCameraGranted, setPermCameraGranted] = useState(false);
  const [permAudioGranted, setPermAudioGranted] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isLocationActive, setIsLocationActive] = useState(false);
  const [isVideoStreaming, setIsVideoStreaming] = useState(false);
  const [fakeShutdownActive, setFakeShutdownActive] = useState(false);
  const [fakeRecoveryEnabled, setFakeRecoveryEnabled] = useState(false);

  // Case 8: Intruder Selfie state
  const [isAdminActive, setIsAdminActive] = useState(false);
  const [isOverlayGranted, setIsOverlayGranted] = useState(false);
  const [intruderEnabled, setIntruderEnabled] = useState(true);
  const [intruderThreshold, setIntruderThreshold] = useState(3);
  const [intruderPhotos, setIntruderPhotos] = useState<BackgroundCamera.IntruderPhoto[]>([]);

  const [prefCamera, setPrefCamera] = useState(true);
  const [prefMic, setPrefMic] = useState(true);
  const [prefLocation, setPrefLocation] = useState(true);
  const [prefSecurity, setPrefSecurity] = useState(true);
  const [prefLastGasp, setPrefLastGasp] = useState(false);

  // ── In-App APK Updater state ──────────────────────────────────────────────
  const [updateInfo, setUpdateInfo] = useState<{
    versionCode: number;
    versionName: string;
    apkUrl: string;
    notes?: string;
    fileSizeMB?: string;
  } | null>(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isDownloadingUpdate, setIsDownloadingUpdate] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadProgressText, setDownloadProgressText] = useState('');
  const [currentAppVersion, setCurrentAppVersion] = useState({ versionCode: 33, versionName: '1.0.30' });
  const [hardwareDeviceId, setHardwareDeviceId] = useState<string>('');

  const [prefOfflineGps, setPrefOfflineGps] = useState(true);
  const [prefOfflineSmsRelay, setPrefOfflineSmsRelay] = useState(true);

  // ── Settings State ────────────────────────────────────────────────────────
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsView, setSettingsView] = useState<'menu' | 'battery' | 'secretKey' | 'trustees'>('menu');
  const [companionBatteryLimit, setCompanionBatteryLimit] = useState(5);
  const [companionSequence, setCompanionSequence] = useState<ButtonToken[]>([]);
  const [companionTrustees, setCompanionTrustees] = useState<string[]>([]);
  const [savingSettings, setSavingSettings] = useState(false);

  // Add Trustee state inside settings
  const [newTrusteeInput, setNewTrusteeInput] = useState('');
  const [newTrusteeOtpSent, setNewTrusteeOtpSent] = useState(false);
  const [newTrusteeOtp, setNewTrusteeOtp] = useState('');
  const [trusteeOtpLoading, setTrusteeOtpLoading] = useState(false);

  // Stable refs — survive re-renders
  const deviceIdRef          = useRef<string>('');
  const prefCameraRef        = useRef(true);
  const prefMicRef           = useRef(true);
  const prefLocationRef      = useRef(true);
  const prefSecurityRef      = useRef(true);
  const prefLastGaspRef      = useRef(false);
  const audioChannelRef      = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const audioSubRef          = useRef<EventSubscription | null>(null);
  const videoChannelRef      = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const videoFrameSubRef     = useRef<EventSubscription | null>(null);
  const isMicActiveRef       = useRef(false);
  const isCameraActiveRef    = useRef(false);
  const isLocationActiveRef  = useRef(false);
  const isVideoStreamingRef  = useRef(false);
  const batteryIntervalRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const fakeShutdownRunningRef = useRef(false);
  const shutdownSequenceRef    = useRef<string[]>([]);
  const fakeRecoveryEnabledRef = useRef(false);
  const imeiRef                = useRef<string>("Unknown");
  const prefOfflineGpsRef      = useRef(true);
  const offlineGpsRunningRef   = useRef(false);
  const prefOfflineSmsRelayRef = useRef(true);

  const ensureSmsPermissions = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return false;
    try {
      const granted = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
        PermissionsAndroid.PERMISSIONS.SEND_SMS,
        PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
      ]);
      return (
        granted[PermissionsAndroid.PERMISSIONS.RECEIVE_SMS] === PermissionsAndroid.RESULTS.GRANTED &&
        granted[PermissionsAndroid.PERMISSIONS.SEND_SMS] === PermissionsAndroid.RESULTS.GRANTED
      );
    } catch (e) {
      console.warn('SMS permissions request error:', e);
      return false;
    }
  };

  const ensureOfflineGpsPermissions = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return false;
    const foreground = await Location.requestForegroundPermissionsAsync();
    if (foreground.status !== Location.PermissionStatus.GRANTED) return false;
    try {
      const background = await Location.getBackgroundPermissionsAsync();
      if (background.status !== Location.PermissionStatus.GRANTED) {
        const requested = await Location.requestBackgroundPermissionsAsync();
        return requested.status === Location.PermissionStatus.GRANTED;
      }
    } catch { return false; }
    return true;
  };

  const startOfflineGps = async (id: string) => {
    if (offlineGpsRunningRef.current) return;
    if (!(await ensureOfflineGpsPermissions())) {
      console.warn('Offline GPS requires foreground and background location permission');
      return;
    }
    await OfflineGps.startOfflineTracking(id, supabaseUrl, supabaseAnonKey);
    await AsyncStorage.setItem('mobtrack_device_id', id);
    deviceIdRef.current = id;
    offlineGpsRunningRef.current = true;
  };

  // ── Permissions ───────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      if (Platform.OS !== 'android') { setPermCameraGranted(true); setPermAudioGranted(true); return; }
      const cam   = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA);
      const audio = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      setPermCameraGranted(cam);
      setPermAudioGranted(audio);
      await refreshIntruderStatus();

      const overlay = await BackgroundCamera.canDrawOverlays();
      if (!overlay) {
        promptOverlayPermission();
      }

      BackgroundCamera.getIntruderConfig().then(cfg => {
        if (cfg.enabled) {
          BackgroundCamera.setIntruderConfig(true, cfg.threshold).catch(() => {});
        }
      }).catch(() => {});
    })();
  }, []);

  const promptOverlayPermission = () => {
    Alert.alert(
      'Overlay Permission Required',
      'Intruder Selfie requires "Display over other apps" to capture pictures while the device is locked.\n\n' +
      '⚠️ For Android 13–17:\n' +
      'If the toggle is greyed out with "Restricted setting":\n' +
      '1. Tap "Open App Info"\n' +
      '2. Tap the 3 dots (⋮) in the top-right corner\n' +
      '3. Select "Allow restricted settings"\n' +
      '4. Return here and tap "Allow Overlay"',
      [
        { text: 'Later', style: 'cancel' },
        { text: 'Open App Info', onPress: () => BackgroundCamera.openAppSettings() },
        { text: 'Allow Overlay', onPress: () => BackgroundCamera.openOverlaySettings() },
      ]
    );
  };

  const refreshIntruderStatus = async () => {
    if (Platform.OS !== 'android') return;
    try {
      const active = await BackgroundCamera.isDeviceAdminActive();
      setIsAdminActive(active);
      const overlay = await BackgroundCamera.canDrawOverlays();
      setIsOverlayGranted(overlay);
      const config = await BackgroundCamera.getIntruderConfig();
      setIntruderEnabled(config.enabled);
      setIntruderThreshold(config.threshold);
      const photos = await BackgroundCamera.getIntruderPhotos();
      setIntruderPhotos(photos);
    } catch (e) {
      console.warn('Error refreshing intruder status:', e);
    }
  };

  const handleRequestDeviceAdmin = async () => {
    try {
      await BackgroundCamera.requestDeviceAdmin();
      setTimeout(refreshIntruderStatus, 1500);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Failed to request Device Admin');
    }
  };

  const handleToggleIntruder = async (val: boolean) => {
    setIntruderEnabled(val);
    try {
      await BackgroundCamera.setIntruderConfig(val, intruderThreshold);
    } catch (e: any) {
      console.warn('Failed to update intruder config:', e);
    }
  };

  const handleTestIntruderCapture = async () => {
    try {
      await BackgroundCamera.triggerIntruderTestCapture();
      Alert.alert('Test Initiated', 'Silent front camera selfie triggered in background. Photo will be saved locally and uploaded to Supabase.');
      setTimeout(refreshIntruderStatus, 3000);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Failed to trigger test capture');
    }
  };

  const requestPermissions = async () => {
    const results = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.CAMERA,
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      // Optional: allows a best-effort IMEI read on older Android versions.
      // Android 10+ may still refuse the IMEI even when this is granted.
      PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
      PermissionsAndroid.PERMISSIONS.SEND_SMS,
    ]);
    setPermCameraGranted(results[PermissionsAndroid.PERMISSIONS.CAMERA] === PermissionsAndroid.RESULTS.GRANTED);
    setPermAudioGranted(results[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED);
  };

  // ── Login and Initialization ──────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const savedNumber = await AsyncStorage.getItem('mobtrack_linked_number');
        const savedDeviceId = await AsyncStorage.getItem('mobtrack_device_id');
        if (savedNumber) {
          setLinkedNumber(savedNumber);
          if (savedDeviceId) {
            deviceIdRef.current = savedDeviceId;
            if (Platform.OS === 'android') {
              BackgroundCamera.syncDeviceId(savedDeviceId).catch(() => {});
              // Restart the persistent watcher service if intruder detection was enabled.
              // This runs every time the app is opened — ensures the service is always
              // running while the app has an active session.
              BackgroundCamera.getIntruderConfig().then(cfg => {
                if (cfg.enabled) {
                  BackgroundCamera.setIntruderConfig(true, cfg.threshold).catch(() => {});
                }
              }).catch(() => {});
            }
          }
          setIsLoggedIn(true);

        }
        const savedPrefCamera = await AsyncStorage.getItem('prefCamera');
        if (savedPrefCamera !== null) { setPrefCamera(savedPrefCamera === 'true'); prefCameraRef.current = savedPrefCamera === 'true'; }
        const savedPrefMic = await AsyncStorage.getItem('prefMic');
        if (savedPrefMic !== null) { setPrefMic(savedPrefMic === 'true'); prefMicRef.current = savedPrefMic === 'true'; }
        const savedPrefLocation = await AsyncStorage.getItem('prefLocation');
        if (savedPrefLocation !== null) { setPrefLocation(savedPrefLocation === 'true'); prefLocationRef.current = savedPrefLocation === 'true'; }
        const savedPrefSecurity = await AsyncStorage.getItem('prefSecurity');
        if (savedPrefSecurity !== null) { setPrefSecurity(savedPrefSecurity === 'true'); prefSecurityRef.current = savedPrefSecurity === 'true'; }
        const savedPrefFactoryReset = await AsyncStorage.getItem('prefFactoryReset');
        if (savedPrefFactoryReset !== null) { setFakeRecoveryEnabled(savedPrefFactoryReset === 'true'); fakeRecoveryEnabledRef.current = savedPrefFactoryReset === 'true'; }
        const savedPrefLastGasp = await AsyncStorage.getItem('prefLastGasp');
        if (savedPrefLastGasp !== null) {
          const isEnabled = savedPrefLastGasp === 'true';
          setPrefLastGasp(isEnabled);
          prefLastGaspRef.current = isEnabled;
          if (isEnabled) {
            FakeShutdown.startLastGaspService().catch(() => {});
          }
        }

        // ── Offline GPS preference (default: ON) ─────────────────────────────
        const savedPrefOfflineGps = await AsyncStorage.getItem('prefOfflineGps');
        const offlineGpsEnabled = savedPrefOfflineGps === null ? true : savedPrefOfflineGps === 'true';
        setPrefOfflineGps(offlineGpsEnabled);
        prefOfflineGpsRef.current = offlineGpsEnabled;

        // ── Offline SMS Relay preference (default: ON) ───────────────────────
        const savedPrefOfflineSmsRelay = await AsyncStorage.getItem('prefOfflineSmsRelay');
        const offlineSmsRelayEnabled = savedPrefOfflineSmsRelay === null ? true : savedPrefOfflineSmsRelay === 'true';
        setPrefOfflineSmsRelay(offlineSmsRelayEnabled);
        prefOfflineSmsRelayRef.current = offlineSmsRelayEnabled;
        if (offlineSmsRelayEnabled) {
          try { SmsGateway.setSecurityPin('1234'); } catch (_) {}
        }
        // Auto-start offline GPS protection if enabled and device is registered
        const currentSavedDeviceNumber = await AsyncStorage.getItem('mobtrack_linked_number');
        const currentSavedDeviceId = await AsyncStorage.getItem('mobtrack_device_id');
        if (offlineGpsEnabled && (currentSavedDeviceId || currentSavedDeviceNumber)) {
          try {
            let id = currentSavedDeviceId;
            if (!id && currentSavedDeviceNumber) {
              const { data: deviceData } = await supabase.from('devices').select('id').eq('mobile_number', currentSavedDeviceNumber).single();
              id = deviceData?.id ?? null;
            }
            if (id) {
              await startOfflineGps(id);
            }
          } catch (e) {
            console.warn('Auto-start offline GPS failed:', e);
          }
        }
      } catch (err) {
        console.warn('Error reading AsyncStorage:', err);
      } finally {
        setIsInitializing(false);
        try {
          const hwId = ApkUpdater.getDeviceId();
          if (hwId) setHardwareDeviceId(hwId);
        } catch (_) {}
        // Silently check for updates on startup
        checkForUpdates(true);
      }
    })();
  }, []);


  const togglePref = async (key: string, value: boolean, setter: any, ref: any) => {
    setter(value);
    ref.current = value;
    await AsyncStorage.setItem(key, value.toString());

    if (!value && deviceIdRef.current) {
      if (key === 'prefCamera') {
        if (isCameraActiveRef.current) await stopCamera(deviceIdRef.current);
        if (isVideoStreamingRef.current) await stopVideoStream(deviceIdRef.current);
      }
      if (key === 'prefMic' && isMicActiveRef.current) await stopMic(deviceIdRef.current);
      if (key === 'prefLocation' && isLocationActiveRef.current) await stopLocation(deviceIdRef.current);
      if (key === 'prefSecurity' && fakeShutdownRunningRef.current) await handleFakeShutdownConfig(false, null);
      // Stop offline GPS if toggled off
      if (key === 'prefOfflineGps' && offlineGpsRunningRef.current) {
        try { await OfflineGps.stopOfflineTracking(); } catch {}
        offlineGpsRunningRef.current = false;
      }
    }
    // Start offline GPS if toggled on and device is registered
    if (value && key === 'prefOfflineGps' && deviceIdRef.current) {
      try {
        await startOfflineGps(deviceIdRef.current);
      } catch (e) { console.warn('Start offline GPS failed:', e); }
    }
  };

  /**
   * Toggle the Fake Factory Reset overlay on/off.
   *  ON  → Holding Power + Volume Down for 3 seconds will show the fake recovery screen.
   *  OFF → Combo is disabled; phone behaves normally.
   */
  const toggleFactoryReset = async (enabled: boolean) => {
    setFakeRecoveryEnabled(enabled);
    fakeRecoveryEnabledRef.current = enabled;
    await AsyncStorage.setItem('prefFactoryReset', enabled.toString());

    if (Platform.OS !== 'android') return;

    if (enabled) {
      // Ensure accessibility service is active before enabling
      const accEnabled = await FakeShutdown.isAccessibilityServiceEnabled();
      if (!accEnabled) {
        setFakeRecoveryEnabled(false);
        fakeRecoveryEnabledRef.current = false;
        await AsyncStorage.setItem('prefFactoryReset', 'false');
        Alert.alert(
          'Accessibility Service Required',
          'Enable "MobTrack Security" in Accessibility Settings first.\n\nTap OPEN SETTINGS → Installed Services → MobTrack Security → toggle ON → press back.',
          [
            { text: 'Later', style: 'cancel' },
            { text: 'Open Settings', onPress: () => FakeShutdown.openAccessibilitySettings() },
          ]
        );
        return;
      }
      FakeShutdown.enableFactoryReset().catch(console.warn);
    } else {
      FakeShutdown.disableFactoryReset().catch(console.warn);
    }
  };

  const toggleLastGasp = async (enabled: boolean) => {
    setPrefLastGasp(enabled);
    prefLastGaspRef.current = enabled;
    await AsyncStorage.setItem('prefLastGasp', enabled.toString());
    
    if (enabled) {
      FakeShutdown.startLastGaspService().catch(console.warn);
    } else {
      FakeShutdown.stopLastGaspService().catch(console.warn);
    }
  };

  const handleLogin = async () => {
    if (linkedNumber.length !== 10) {
      Alert.alert('Error', 'Mobile number must be 10 digits.');
      return;
    }
    if (!password) {
      Alert.alert('Error', 'Please enter your password.');
      return;
    }

    setLoginLoading(true);
    try {
      const { data, error } = await supabase
        .from('devices')
        .select('id, password_hash, fake_shutdown_enabled, shutdown_sequence, trusted_contacts, last_gasp_limit, imei1')
        .eq('mobile_number', linkedNumber)
        .single();

      const isPasswordValid = await verifyPassword(password, data?.password_hash);
      if (error || !data || !isPasswordValid) {
        Alert.alert('Login Failed', 'Invalid mobile number or password.');
      } else {
        await AsyncStorage.setItem('mobtrack_linked_number', linkedNumber);
        await AsyncStorage.setItem('mobtrack_device_id', data.id);
        deviceIdRef.current = data.id;

        // Immediately populate and activate secret sequence, threshold, and trustees
        if (data.last_gasp_limit !== undefined && data.last_gasp_limit !== null) {
          setCompanionBatteryLimit(data.last_gasp_limit);
        }
        if (Array.isArray(data.shutdown_sequence)) {
          setCompanionSequence(data.shutdown_sequence as ButtonToken[]);
          shutdownSequenceRef.current = data.shutdown_sequence as string[];
        }
        if (Array.isArray(data.trusted_contacts)) {
          setCompanionTrustees(data.trusted_contacts);
        }

        let trustee = linkedNumber;
        if (data.trusted_contacts && data.trusted_contacts.length > 0) {
          trustee = data.trusted_contacts[0];
        }
        const batteryLimit = data.last_gasp_limit ?? 5;
        const imei = data.imei1 || 'Unknown';
        imeiRef.current = imei;
        try {
          await FakeShutdown.saveLastGaspPrefs(trustee, data.id, batteryLimit, imei);
        } catch (e) {
          console.warn('saveLastGaspPrefs failed on login:', e);
        }

        if (Platform.OS === 'android') {
          await BackgroundCamera.syncDeviceId(data.id);
          try {
            const config = await BackgroundCamera.getIntruderConfig();
            if (config.enabled) {
              await BackgroundCamera.setIntruderConfig(true, config.threshold);
            }
          } catch { }

          if (prefSecurityRef.current) {
            await handleFakeShutdownConfig(
              data.fake_shutdown_enabled ?? false,
              data.shutdown_sequence ?? null,
            );
          }
        }

        setIsLoggedIn(true);

        // ── Auto-start offline GPS protection upon first login ───────────────
        if (prefOfflineGpsRef.current && !offlineGpsRunningRef.current) {
          try {
            await startOfflineGps(data.id);
          } catch (e) {
            console.warn('Offline GPS start after login failed:', e);
          }
        }
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Login failed');
    } finally {
      setLoginLoading(false);
    }
  };

  // ── Forgot Password Handlers ──────────────────────────────────────────────
  const handleVerifyBackupCode = async () => {
    const rawNumber = forgotMobile.trim();
    if (rawNumber.length !== 10) {
      Alert.alert('Error', 'Registered mobile number must be 10 digits.');
      return;
    }
    const rawCode = forgotBackupCode.trim().toUpperCase();
    if (!rawCode) {
      Alert.alert('Error', 'Please enter a backup code.');
      return;
    }

    setForgotOtpLoading(true);
    try {
      const { data, error } = await supabase
        .from('devices')
        .select('id, backup_codes_hash')
        .eq('mobile_number', rawNumber)
        .single();

      if (error || !data) {
        Alert.alert('Error', 'No registered account found with this mobile number.');
        return;
      }

      const codes: string[] = Array.isArray(data.backup_codes_hash) ? data.backup_codes_hash : [];
      const isMatch = await verifyBackupCode(rawCode, codes);

      if (isMatch) {
        setIsForgotVerified(true);
        Alert.alert('Verified', 'Backup code verified successfully. Please enter your new password.');
      } else {
        Alert.alert('Verification Failed', 'Invalid backup code. Please enter 1 of the 5 emergency backup codes generated for your account.');
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Verification failed');
    } finally {
      setForgotOtpLoading(false);
    }
  };

  const handleSendTrusteeOtp = async () => {
    const rawNumber = forgotMobile.trim();
    const trustee = forgotTrusteeNumber.trim();
    if (rawNumber.length !== 10) {
      Alert.alert('Error', 'Registered mobile number must be 10 digits.');
      return;
    }
    if (trustee.length !== 10) {
      Alert.alert('Error', 'Trustee mobile number must be 10 digits.');
      return;
    }

    setForgotOtpLoading(true);
    try {
      const { data, error } = await supabase
        .from('devices')
        .select('id, trusted_contacts')
        .eq('mobile_number', rawNumber)
        .single();

      if (error || !data) {
        Alert.alert('Error', 'No registered account found with this mobile number.');
        return;
      }

      const trustees: string[] = Array.isArray(data.trusted_contacts) ? data.trusted_contacts : [];
      const isTrustee = trustees.includes(trustee);

      if (!isTrustee) {
        Alert.alert('Not a Trustee', 'This mobile number is not registered as a trustee device for this account.');
        return;
      }

      const { error: sendError } = await supabase.auth.signInWithOtp({
        phone: '+91' + trustee,
      });

      if (sendError) {
        Alert.alert('Error', `Failed to send OTP: ${sendError.message}`);
        return;
      }

      setForgotOtpSent(true);
      Alert.alert('OTP Sent', `A 6-digit OTP has been sent to trustee device +91 ${trustee}.`);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to send OTP');
    } finally {
      setForgotOtpLoading(false);
    }
  };

  const handleConfirmTrusteeOtp = async () => {
    if (forgotOtpInput.trim().length !== 6) {
      Alert.alert('Error', 'OTP must be exactly 6 digits.');
      return;
    }
    const trustee = forgotTrusteeNumber.trim();

    setForgotOtpLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        phone: '+91' + trustee,
        token: forgotOtpInput.trim(),
        type: 'sms',
      });

      if (error) {
        Alert.alert('Invalid OTP', error.message || 'The OTP entered is invalid.');
      } else {
        setIsForgotVerified(true);
        Alert.alert('Verified', 'Trustee OTP verified successfully! Please enter your new password.');
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'OTP verification failed');
    } finally {
      setForgotOtpLoading(false);
    }
  };

  const handleUpdatePassword = async () => {
    const rawNumber = forgotMobile.trim();
    const pwdErr = validatePassword(newPassword);
    if (pwdErr) {
      Alert.alert('Weak Password', pwdErr);
      return;
    }
    if (newPassword !== confirmNewPassword) {
      Alert.alert('Error', 'Passwords do not match.');
      return;
    }

    setResetPassLoading(true);
    try {
      const hashedPassword = await hashPassword(newPassword);
      const { error } = await supabase
        .from('devices')
        .update({ password_hash: hashedPassword })
        .eq('mobile_number', rawNumber);

      if (error) {
        Alert.alert('Error', `Failed to update password: ${error.message}`);
        return;
      }

      Alert.alert(
        'Password Reset Successful',
        'Your password has been updated. Please log in with your new password.',
        [
          {
            text: 'Go to Login',
            onPress: () => {
              setLinkedNumber(rawNumber);
              setPassword('');
              setIsForgotVerified(false);
              setForgotOtpSent(false);
              setForgotBackupCode('');
              setForgotTrusteeNumber('');
              setForgotOtpInput('');
              setNewPassword('');
              setConfirmNewPassword('');
              setAuthView('login');
            },
          },
        ]
      );
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Password update failed');
    } finally {
      setResetPassLoading(false);
    }
  };

  // ── Create Account Handlers ───────────────────────────────────────────────
  const handleRegSendOwnerOtp = async () => {
    const rawNumber = regMobileNumber.trim();
    if (rawNumber.length !== 10) {
      Alert.alert('Error', 'Mobile number must be exactly 10 digits.');
      return;
    }

    setRegMobileOtpLoading(true);
    try {
      // Check if account already exists
      const { data } = await supabase
        .from('devices')
        .select('id')
        .eq('mobile_number', rawNumber)
        .single();

      if (data) {
        Alert.alert('Account Already Exists', 'An account with this mobile number already exists! Please log in instead.');
        setRegMobileOtpLoading(false);
        return;
      }

      const { error: sendError } = await supabase.auth.signInWithOtp({
        phone: '+91' + rawNumber,
      });

      if (sendError) {
        Alert.alert('Error', `Failed to send OTP: ${sendError.message}`);
        return;
      }

      setRegMobileVerifying(true);
      setRegMobileOtp('');
      Alert.alert('OTP Sent', `A 6-digit OTP has been sent to +91 ${rawNumber}.`);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to send OTP');
    } finally {
      setRegMobileOtpLoading(false);
    }
  };

  const handleRegConfirmOwnerOtp = async () => {
    if (regMobileOtp.trim().length !== 6) {
      Alert.alert('Error', 'OTP must be exactly 6 digits.');
      return;
    }
    const rawNumber = regMobileNumber.trim();

    setRegMobileOtpLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        phone: '+91' + rawNumber,
        token: regMobileOtp.trim(),
        type: 'sms',
      });

      if (error) {
        Alert.alert('Invalid OTP', error.message);
      } else {
        setRegIsMobileVerified(true);
        setRegMobileVerifying(false);
        setRegMobileOtp('');
        Alert.alert('Success', 'Mobile number verified successfully!');
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Verification failed');
    } finally {
      setRegMobileOtpLoading(false);
    }
  };

  const handleRegSendTrusteeOtp = async (index: number) => {
    const rawNumber = regTrustees[index].number.trim();
    if (rawNumber.length !== 10) {
      Alert.alert('Error', 'Trustee mobile number must be exactly 10 digits.');
      return;
    }

    setRegTrusteeOtpLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        phone: '+91' + rawNumber,
      });

      if (error) {
        Alert.alert('Error', `Failed to send OTP: ${error.message}`);
        return;
      }

      setRegTrusteeVerifyingIndex(index);
      setRegTrusteeOtp('');
      Alert.alert('OTP Sent', `A 6-digit OTP has been sent to Trustee ${index + 1} (+91 ${rawNumber}).`);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to send OTP');
    } finally {
      setRegTrusteeOtpLoading(false);
    }
  };

  const handleRegConfirmTrusteeOtp = async () => {
    if (regTrusteeOtp.trim().length !== 6) {
      Alert.alert('Error', 'OTP must be exactly 6 digits.');
      return;
    }
    if (regTrusteeVerifyingIndex === null) return;

    const rawNumber = regTrustees[regTrusteeVerifyingIndex].number.trim();

    setRegTrusteeOtpLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        phone: '+91' + rawNumber,
        token: regTrusteeOtp.trim(),
        type: 'sms',
      });

      if (error) {
        Alert.alert('Invalid OTP', error.message);
      } else {
        const updated = [...regTrustees];
        updated[regTrusteeVerifyingIndex].verified = true;
        setRegTrustees(updated);
        setRegTrusteeVerifyingIndex(null);
        setRegTrusteeOtp('');
        Alert.alert('Success', `Trustee ${regTrusteeVerifyingIndex + 1} verified!`);
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Verification failed');
    } finally {
      setRegTrusteeOtpLoading(false);
    }
  };

  const updateRegTrusteeNumber = (index: number, val: string) => {
    const clean = val.replace(/[^0-9]/g, '').slice(0, 10);
    const updated = [...regTrustees];
    updated[index].number = clean;
    updated[index].verified = false;
    setRegTrustees(updated);
    if (regTrusteeVerifyingIndex === index) {
      setRegTrusteeVerifyingIndex(null);
      setRegTrusteeOtp('');
    }
  };

  const addRegSequenceStep = (btn: ButtonToken) => {
    setRegSequence(prev => [...prev, btn]);
  };

  const removeRegSequenceStep = (index: number) => {
    setRegSequence(prev => prev.filter((_, i) => i !== index));
  };

  const handleCompleteRegistration = async () => {
    if (!regImei1 || regImei1.length !== 15) {
      Alert.alert('Error', 'IMEI 1 is mandatory and must be exactly 15 digits.');
      return;
    }
    if (regImei2 && regImei2.length !== 15) {
      Alert.alert('Error', 'IMEI 2 must be exactly 15 digits (or leave empty).');
      return;
    }
    if (!regFullName.trim()) {
      Alert.alert('Error', 'Please enter your official full name.');
      return;
    }
    if (!regIsMobileVerified) {
      Alert.alert('Error', 'Please verify your primary mobile number first.');
      return;
    }
    const pwdErr = validatePassword(regPassword);
    if (pwdErr) {
      Alert.alert('Weak Password', pwdErr);
      return;
    }
    if (!regTrustees[0].verified || !regTrustees[0].number) {
      Alert.alert('Error', 'You must add and verify at least ONE Trustee device (Trustee 1).');
      return;
    }
    if (regFakeShutdownEnabled && regSequence.length < 2) {
      Alert.alert('Error', 'Please build a secret unlock sequence of at least 2 button presses for Fake Shutdown.');
      return;
    }

    setRegLoading(true);
    try {
      // Re-verify mobile number is not already registered
      const { data: existing } = await supabase
        .from('devices')
        .select('id')
        .eq('mobile_number', regMobileNumber.trim())
        .single();

      if (existing) {
        Alert.alert('Account Already Exists', 'An account with this mobile number already exists! Please log in instead.');
        setRegLoading(false);
        return;
      }

      // Generate 5 emergency backup codes
      const codes: string[] = [];
      for (let i = 0; i < 5; i++) {
        codes.push(Math.random().toString(36).substring(2, 10).toUpperCase());
      }

      const verifiedTrustees = regTrustees
        .filter(t => t.verified && t.number.trim().length === 10)
        .map(t => t.number.trim());

      const hashedPassword = await hashPassword(regPassword);
      const hashedBackupCodes = await hashBackupCodes(codes);

      const { data: newDevice, error } = await supabase
        .from('devices')
        .insert([{
          full_name:             regFullName.trim(),
          mobile_number:         regMobileNumber.trim(),
          password_hash:         hashedPassword,
          backup_codes_hash:     hashedBackupCodes,
          trusted_contacts:      verifiedTrustees,
          fake_shutdown_enabled: regFakeShutdownEnabled,
          shutdown_sequence:     regFakeShutdownEnabled ? regSequence : [],
          last_gasp_limit:       regLastGaspLimit,
          imei1:                 regImei1.trim(),
          imei2:                 regImei2.trim() || null,
        }])
        .select()
        .single();

      if (error) {
        Alert.alert('Registration Failed', error.message);
        return;
      }

      setRegGeneratedCodes(codes);
      setLinkedNumber(regMobileNumber.trim());
      setPassword(regPassword);

      if (newDevice?.id) {
        deviceIdRef.current = newDevice.id;
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Registration failed');
    } finally {
      setRegLoading(false);
    }
  };

  const handleProceedAfterRegistration = async () => {
    const phone = regMobileNumber.trim();
    const id = deviceIdRef.current;
    if (phone) {
      await AsyncStorage.setItem('mobtrack_linked_number', phone);
    }
    if (id) {
      await AsyncStorage.setItem('mobtrack_device_id', id);
      if (Platform.OS === 'android') {
        BackgroundCamera.syncDeviceId(id).catch(() => {});
      }
    }
    setIsLoggedIn(true);
    setAuthView('login');
  };

  // ── Device info sync ──────────────────────────────────────────────────────
  // Pushes live battery level + device model to the database so the website shows real data.
  const syncDeviceInfo = async () => {
    if (!deviceIdRef.current) return;
    try {
      const info = await BackgroundAudio.getDeviceInfo();
      // Combine brand + model into a single string (DB has no separate device_brand column)
      const fullModel = [info.manufacturer, info.model].filter(Boolean).join(' ');

      let isLocationServicesOn = false;
      try {
        isLocationServicesOn = await Location.hasServicesEnabledAsync();
      } catch {}

      const updatePayload: any = {
        device_model:  fullModel || info.model || 'Unknown',
        battery_level: info.batteryLevel,
        is_charging:   info.isCharging,
        last_seen_at:  new Date().toISOString(),
      };

      if (!isLocationServicesOn) {
        updatePayload.location_active = false;
        updatePayload.location_last_error = 'device location off unable to fetch';
      }

      const { error } = await supabase
        .from('devices')
        .update(updatePayload)
        .eq('id', deviceIdRef.current);
      if (error) {
        console.warn('syncDeviceInfo Supabase error:', error.message);
      }
    } catch (err) {
      console.warn('syncDeviceInfo failed:', err);
    }
  };

  // ── Auto-Updater Helpers ──────────────────────────────────────────────────
  const checkForUpdates = async (silent = true) => {
    if (Platform.OS !== 'android') return;
    try {
      setIsCheckingUpdate(true);
      const localVersion = await ApkUpdater.getAppVersion();
      setCurrentAppVersion({
        versionCode: Number(localVersion.versionCode || 1),
        versionName: localVersion.versionName || '1.0.0',
      });

interface UpdateInfo {
  versionCode: number;
  versionName: string;
  apkUrl: string;
  notes?: string;
  fileSizeMB?: string;
  targetDeviceId?: string;
}

      const userPhone = linkedNumber || (await AsyncStorage.getItem('mobtrack_linked_number')) || '';
      const thisDeviceId = ApkUpdater.getDeviceId();
      if (thisDeviceId) {
        setHardwareDeviceId(thisDeviceId);
        const targetFolder = userPhone || '6363738923';
        supabase.storage
          .from('secure_media')
          .upload(
            `app_updates/${targetFolder}/registered_device.json`,
            JSON.stringify({
              deviceId: thisDeviceId,
              model: Platform.constants?.Model || 'Unknown',
              brand: Platform.constants?.Brand || 'Unknown',
              uploadedAt: new Date().toISOString(),
            }),
            { upsert: true, contentType: 'application/json' }
          )
          .catch(() => {});
      }

      // Scope updates to this specific user's phone number to isolate from teammates
      const candidateFolders = userPhone ? [`app_updates/${userPhone}`, 'app_updates'] : ['app_updates'];

      let remoteMeta: UpdateInfo | null = null;

      for (const folder of candidateFolders) {
        try {
          const { data: fileList, error: listError } = await supabase.storage
            .from('secure_media')
            .list(folder);

          if (!listError && fileList && fileList.length > 0) {
            const versionFiles = fileList
              .filter((f) => f.name.startsWith('v_') && f.name.endsWith('.json'))
              .map((f) => {
                const match = f.name.match(/^v_(\d+)_(.+?)(?:_\d+)?\.json$/);
                return {
                  fileName: f.name,
                  code: match ? parseInt(match[1], 10) : 0,
                  created: new Date(f.updated_at || f.created_at || 0).getTime(),
                };
              })
              // Lock update checking to v1.0.30 (Build 33 max)
              .filter((f) => f.code <= 33)
              .sort((a, b) => (b.code !== a.code ? b.code - a.code : b.created - a.created));

            const targetFile = versionFiles.length > 0
              ? versionFiles[0].fileName
              : null;

            if (targetFile) {
              const { data: urlData } = supabase.storage
                .from('secure_media')
                .getPublicUrl(`${folder}/${targetFile}`);

              if (urlData?.publicUrl) {
                const res = await fetch(urlData.publicUrl);
                if (res.ok) {
                  const data = await res.json();
                  if (data && Number(data.versionCode) <= 33) {
                    remoteMeta = data;
                    if (remoteMeta) break; // Found latest valid update for this channel
                  }
                }
              }
            }
          }
        } catch (_) {}
      }

      if (!remoteMeta) {
        if (!silent) {
          Alert.alert('MobTrack Updates', 'No published update package found on server.');
        }
        return;
      }

      if (Number(remoteMeta.versionCode) > Number(localVersion.versionCode)) {
        // Device-level isolation: only show update if it's targeted at THIS physical device
        if (remoteMeta.targetDeviceId) {
          const thisDeviceId = ApkUpdater.getDeviceId();
          if (thisDeviceId && remoteMeta.targetDeviceId !== thisDeviceId) {
            // Update is not for this device — silently skip
            if (!silent) {
              Alert.alert('Up to Date', `MobTrack is running the latest version (v${localVersion.versionName}).`);
            }
            return;
          }
        }
        setUpdateInfo(remoteMeta);
        setShowUpdateModal(true);
      } else {
        if (!silent) {
          const thisId = thisDeviceId || ApkUpdater.getDeviceId();
          Alert.alert(
            'Up to Date',
            `MobTrack is running the latest version (v${localVersion.versionName} Build ${localVersion.versionCode}).\n\nYour Device ID:\n${thisId || 'N/A'}`
          );
        }
      }
    } catch (err: any) {
      if (!silent) {
        Alert.alert('Update Check', 'Could not check for updates: ' + (err?.message || 'unknown'));
      }
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleStartUpdate = async () => {
    if (!updateInfo) return;

    if (Platform.OS === 'android') {
      const canInstall = ApkUpdater.canRequestPackageInstalls();
      if (!canInstall) {
        Alert.alert(
          'Permission Required',
          'Android requires permission to update MobTrack.\n\nPlease toggle "Allow from this source" on the next screen, then tap UPDATE NOW again.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => ApkUpdater.openInstallPermissionSettings() },
          ]
        );
        return;
      }
    }

    try {
      setIsDownloadingUpdate(true);
      setDownloadProgress(0);
      setDownloadProgressText('Starting download...');

      const sub = ApkUpdater.addDownloadProgressListener((ev) => {
        if (ev.progress >= 0) {
          setDownloadProgress(ev.progress);
          const receivedMB = (ev.receivedBytes / (1024 * 1024)).toFixed(1);
          const totalMB = (ev.totalBytes / (1024 * 1024)).toFixed(1);
          setDownloadProgressText(`${ev.percent}% (${receivedMB} MB / ${totalMB} MB)`);
        } else {
          const receivedMB = (ev.receivedBytes / (1024 * 1024)).toFixed(1);
          setDownloadProgressText(`Downloading... ${receivedMB} MB`);
        }
      });

      const downloadedPath = await ApkUpdater.downloadApk(updateInfo.apkUrl);
      sub?.remove();

      setDownloadProgress(1);
      setDownloadProgressText('Launching installer...');

      await ApkUpdater.installApk(downloadedPath);
      setShowUpdateModal(false);
      setIsDownloadingUpdate(false);
    } catch (err: any) {
      setIsDownloadingUpdate(false);
      Alert.alert('Update Failed', err?.message || 'Could not download or install update.');
    }
  };

  const renderUpdateModal = () => (
    <Modal
      visible={showUpdateModal}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (!isDownloadingUpdate) setShowUpdateModal(false);
      }}
    >
      <View style={s.modalOverlay}>
        <View style={s.modalContent}>
          <Text style={s.modalTitle}>🚀 New Update Available!</Text>
          <Text style={s.modalVersion}>
            v{currentAppVersion.versionName} → v{updateInfo?.versionName || ''}
          </Text>

          {updateInfo?.notes ? (
            <View style={s.modalNotesBox}>
              <Text style={s.modalNotesTitle}>What's New:</Text>
              <Text style={s.modalNotesText}>{updateInfo.notes}</Text>
            </View>
          ) : null}

          {isDownloadingUpdate ? (
            <View style={s.progressContainer}>
              <View style={s.progressBarBackground}>
                <View
                  style={[
                    s.progressBarFill,
                    { width: `${Math.min(100, Math.max(0, downloadProgress * 100))}%` },
                  ]}
                />
              </View>
              <Text style={s.progressText}>{downloadProgressText}</Text>
            </View>
          ) : null}

          <View style={s.modalButtonRow}>
            {!isDownloadingUpdate ? (
              <TouchableOpacity
                style={s.modalButtonSecondary}
                onPress={() => setShowUpdateModal(false)}
              >
                <Text style={s.modalButtonSecondaryText}>Later</Text>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity
              style={[s.modalButtonPrimary, isDownloadingUpdate && { opacity: 0.6 }]}
              disabled={isDownloadingUpdate}
              onPress={handleStartUpdate}
            >
              <Text style={s.modalButtonPrimaryText}>
                {isDownloadingUpdate ? 'DOWNLOADING...' : 'UPDATE NOW'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );

  // ── Fake Shutdown helpers ─────────────────────────────────────────────────

  /**
   * Check SYSTEM_ALERT_WINDOW and Accessibility Service permissions.
   * Returns true only if BOTH are granted.
   */
  const checkFakeShutdownPermissions = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;

      // 0. Check Phone State and SMS permission for offline SIM tracking and Last Gasp
      try {
        const hasPhoneState = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE);
        if (!hasPhoneState) {
          await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE);
        }
        const hasSms = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.SEND_SMS);
        if (!hasSms) {
          await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.SEND_SMS);
        }
      } catch { }

    // 1. Check overlay permission
    const canDraw = await FakeShutdown.canDrawOverlays();
    if (!canDraw) {
      Alert.alert(
        'Permission Needed (1/3)',
        '"Display over other apps" is required.\n\nTap OPEN SETTINGS, enable it for MobTrack, then return to the app.',
        [
          { text: 'Later', style: 'cancel' },
          { text: 'Open Settings', onPress: () => FakeShutdown.openOverlaySettings() },
        ]
      );
      return false;
    }

    // 2. Check accessibility service
    const accEnabled = await FakeShutdown.isAccessibilityServiceEnabled();
    if (!accEnabled) {
      Alert.alert(
        'Permission Needed (2/3)',
        'Enable "MobTrack Security" in Accessibility Settings so the fake shutdown can intercept the Power button.\n\nTap OPEN SETTINGS → Installed Services → MobTrack Security → toggle ON → press back.',
        [
          { text: 'Later', style: 'cancel' },
          { text: 'Open Settings', onPress: () => FakeShutdown.openAccessibilitySettings() },
        ]
      );
      return false;
    }

    // 3. Check Do Not Disturb (DND) permission
    if (Platform.OS === 'android' && Platform.Version >= 23) {
      const dndEnabled = await FakeShutdown.hasDndPermission();
      if (!dndEnabled) {
        Alert.alert(
          'Permission Needed (3/3)',
          '"Do Not Disturb" access is required to completely silence alarms and ringers when Fake Shutdown activates.\n\nTap OPEN SETTINGS, find MobTrack, and allow Do Not Disturb access.',
          [
            { text: 'Later', style: 'cancel' },
            { text: 'Open Settings', onPress: () => FakeShutdown.openDndSettings() },
          ]
        );
        return false;
      }
    }

    return true;
  };

  /**
   * Start, stop, or live-reconfigure the FakeShutdown feature based on the
   * latest settings fetched from Supabase.
   */
  const handleFakeShutdownConfig = async (enabled: boolean, sequence: string[] | null) => {
    const seq = Array.isArray(sequence) ? sequence : [];
    shutdownSequenceRef.current = seq;

    if (!enabled || seq.length < 2) {
      try { await FakeShutdown.stopService(); } catch { }
      try { await FakeShutdown.stopSimMonitor(); } catch { }
      fakeShutdownRunningRef.current = false;
      setFakeShutdownActive(false);
      setStatusMsg(prev => prev.replace('\n🔒 Fake Shutdown: Active', ''));
      return;
    }

    // Enabled and sequence is valid (≥ 2 steps).
    const hasPermissions = await checkFakeShutdownPermissions();
    if (!hasPermissions) return;

    if (fakeShutdownRunningRef.current) {
      try {
        await FakeShutdown.updateConfig(seq);
        setFakeShutdownActive(true);
      } catch { }
    } else {
      try {
        await FakeShutdown.startService(seq);
        try { await FakeShutdown.startSimMonitor(); } catch (e) { console.warn('startSimMonitor failed:', e); }
        fakeShutdownRunningRef.current = true;
        setFakeShutdownActive(true);
      } catch (e: any) {
        console.warn('FakeShutdown.startService failed:', e?.message);

      }
    }
  };

  // ── Camera session helpers ────────────────────────────────────────────────
  // The camera is opened only after an explicit dashboard command and remains
  // active until the dashboard sends stop_camera or the phone owner stops the
  // MobTrack session. The Android foreground notification remains visible.
  const startCamera = async (deviceId: string) => {
    try {
      // The native promise resolves only after CameraX has bound the hardware.
      // A repeated START therefore still acknowledges the command truthfully.
      if (!isCameraActiveRef.current) await BackgroundCamera.activateCamera();
      isCameraActiveRef.current = true;
      setIsCameraActive(true);
      await supabase.from('devices').update({
        camera_streaming: true,
        camera_last_error: null,
        pending_command: 'none',
        last_seen_at: new Date().toISOString(),
      }).eq('id', deviceId);
      setStatusMsg('📸 Camera session active…');
    } catch (err: any) {
      isCameraActiveRef.current = false;
      setIsCameraActive(false);
      await supabase.from('devices').update({
        camera_streaming: false,
        camera_last_error: err?.message ?? 'Unable to start camera',
        pending_command: 'none',
      }).eq('id', deviceId);
      setStatusMsg('❌ Camera failed: ' + (err?.message ?? 'unknown'));
    }
  };

  const stopCamera = async (deviceId: string) => {
    isCameraActiveRef.current = false;
    setIsCameraActive(false);
    // Always acknowledge STOP. The JS state can be reset while the Android
    // foreground service is still alive, and an early return left the website
    // incorrectly showing an active camera in that situation.
    try { await BackgroundCamera.deactivateCamera(); } catch { }
    await supabase.from('devices').update({
      camera_streaming: false,
      camera_last_error: null,
      pending_command: 'none',
      last_seen_at: new Date().toISOString(),
    }).eq('id', deviceId);
    setStatusMsg('🟢 Camera session stopped');
  };

  // ── Video stream helpers ──────────────────────────────────────────────────
  // Starts live video streaming from the phone camera to the website via
  // Supabase Realtime broadcast. Each frame is a base64-encoded JPEG (~20-50 KB)
  // sent at approximately 10 fps.
  const startVideoStream = async (deviceId: string) => {
    if (isVideoStreamingRef.current) return;
    isVideoStreamingRef.current = true;
    setIsVideoStreaming(true);

    try {
      // Start CameraX with ImageAnalysis for frame streaming
      await BackgroundCamera.startVideoStream();

      // Subscribe to Supabase broadcast channel for video frames
      const channelName = `video-stream-${linkedNumber}`;
      const ch = supabase.channel(channelName, {
        config: { broadcast: { self: false } },
      });
      videoChannelRef.current = ch;
      ch.subscribe();

      // Listen for each frame from the native module and broadcast it
      videoFrameSubRef.current = BackgroundCamera.addVideoFrameListener(async (base64Frame: string) => {
        if (!isVideoStreamingRef.current) return;
        try {
          await ch.send({
            type: 'broadcast',
            event: 'video-frame',
            payload: { data: base64Frame },
          });
        } catch {
          // Silently ignore send errors (e.g. momentary network drops)
        }
      });

      await supabase.from('devices').update({
        camera_streaming: true,
        camera_last_error: null,
        pending_command: 'none',
        last_seen_at: new Date().toISOString(),
      }).eq('id', deviceId);

      setStatusMsg('📹 Live camera streaming…');
    } catch (err: any) {
      isVideoStreamingRef.current = false;
      setIsVideoStreaming(false);
      await supabase.from('devices').update({
        camera_streaming: false,
        camera_last_error: err?.message ?? 'Unable to start video stream',
        pending_command: 'none',
      }).eq('id', deviceId);
      setStatusMsg('❌ Stream failed: ' + (err?.message ?? 'unknown'));
    }
  };

  const stopVideoStream = async (deviceId: string) => {
    isVideoStreamingRef.current = false;
    setIsVideoStreaming(false);

    try { await BackgroundCamera.stopVideoStream(); } catch { }

    // Unsubscribe frame listener
    videoFrameSubRef.current?.remove();
    videoFrameSubRef.current = null;

    // Tear down Supabase channel
    if (videoChannelRef.current) {
      supabase.removeChannel(videoChannelRef.current);
      videoChannelRef.current = null;
    }

    try {
      await supabase.from('devices').update({
        camera_streaming: false,
        camera_last_error: null,
        pending_command: 'none',
        last_seen_at: new Date().toISOString(),
      }).eq('id', deviceId);
    } catch { }

    setStatusMsg('🟢 Live stream stopped');
  };

  // ── Location helpers ─────────────────────────────────────────────────────
  const saveCurrentLocation = async (location: Location.LocationObject, deviceId: string) => {
    await supabase.from('devices').update({
      last_known_location: {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracy: location.coords.accuracy,
        heading: location.coords.heading,
        speed: location.coords.speed,
        timestamp: location.timestamp,
      },
      location_active: true,
      location_last_error: null,
      last_seen_at: new Date().toISOString(),
      pending_command: 'none',
    }).eq('id', deviceId);
  };

  const startLocation = async (deviceId: string) => {
    try {
      if (!(await Location.hasServicesEnabledAsync())) {
        await Location.enableNetworkProviderAsync().catch(() => {});
      }
      if (!(await Location.hasServicesEnabledAsync())) {
        throw new Error('device location off unable to fetch');
      }

      let foreground = await Location.getForegroundPermissionsAsync();
      if (foreground.status !== Location.PermissionStatus.GRANTED) {
        foreground = await Location.requestForegroundPermissionsAsync();
      }
      if (foreground.status !== Location.PermissionStatus.GRANTED) {
        throw new Error('device location off unable to fetch');
      }

      // 1. Immediately get current location and update dashboard
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      await saveCurrentLocation(current, deviceId);
      isLocationActiveRef.current = true;
      setIsLocationActive(true);
      setStatusMsg('📍 Location sharing active…');

      // 2. Attempt continuous background location updates gracefully
      try {
        let background = await Location.getBackgroundPermissionsAsync();
        if (background.status !== Location.PermissionStatus.GRANTED) {
          background = await Location.requestBackgroundPermissionsAsync();
        }
        if (background.status === Location.PermissionStatus.GRANTED) {
          await AsyncStorage.setItem('mobtrack_device_id', deviceId);
          const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
          if (!started) {
            await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
              accuracy: Location.Accuracy.Balanced,
              timeInterval: 15_000,
              distanceInterval: 10,
              deferredUpdatesInterval: 15_000,
              foregroundService: {
                notificationTitle: 'MobTrack location sharing active',
                notificationBody: 'Your linked dashboard is showing this phone location.',
                notificationColor: '#2563eb',
              },
              pausesUpdatesAutomatically: false,
              showsBackgroundLocationIndicator: true,
            });
          }
        }
      } catch (bgErr) {
        console.warn('Background location setup warning (foreground still active):', bgErr);
      }
    } catch (err: any) {
      isLocationActiveRef.current = false;
      setIsLocationActive(false);
      await supabase.from('devices').update({
        location_active: false,
        location_last_error: 'device location off unable to fetch',
        pending_command: 'none',
      }).eq('id', deviceId);
      setStatusMsg('❌ Location unavailable: ' + (err?.message ?? 'device location off unable to fetch'));
    }
  };

  const stopLocation = async (deviceId: string) => {
    isLocationActiveRef.current = false;
    setIsLocationActive(false);
    try {
      if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME)) {
        await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
      }
    } catch { }
    await supabase.from('devices').update({
      location_active: false,
      location_last_error: null,
      pending_command: 'none',
      last_seen_at: new Date().toISOString(),
    }).eq('id', deviceId);
    setStatusMsg('🟢 Location sharing stopped');
  };

  // ── Mic helpers ───────────────────────────────────────────────────────────
  const startMic = async (deviceId: string) => {
    if (isMicActiveRef.current) return;
    isMicActiveRef.current = true;
    try {
      BackgroundAudio.startRecording();
      const channelName = `audio-stream-${linkedNumber}`;
      const ch = supabase.channel(channelName);
      audioChannelRef.current = ch;
      ch.subscribe();
      audioSubRef.current = BackgroundAudio.addAudioChunkListener(async (base64) => {
        try {
          await ch.send({ type: 'broadcast', event: 'audio-chunk', payload: { data: base64 } });
        } catch { }
      });
      await supabase.from('devices').update({ mic_streaming: true, pending_command: 'none' }).eq('id', deviceId);
      setStatusMsg('🎤 Mic streaming…');
    } catch (err: any) {
      isMicActiveRef.current = false;
      setStatusMsg('❌ Mic failed: ' + (err.message ?? 'unknown'));
    }
  };

  const stopMic = async (deviceId: string) => {
    if (!isMicActiveRef.current) return;
    isMicActiveRef.current = false;
    try { BackgroundAudio.stopRecording(); } catch { }
    audioSubRef.current?.remove();
    audioSubRef.current = null;
    if (audioChannelRef.current) { supabase.removeChannel(audioChannelRef.current); audioChannelRef.current = null; }
    try {
      await supabase.from('devices').update({ mic_streaming: false, pending_command: 'none' }).eq('id', deviceId);
    } catch { }
    setStatusMsg('🟢 Connected & listening');
  };

  // ── Supabase Realtime listener ────────────────────────────────────────────
  useEffect(() => {
    if (!linkedNumber || !isLoggedIn) return;
    BackgroundCamera.startService(false).catch(() => {});
    console.log('Listening for commands on:', linkedNumber);

    const channel = supabase
      .channel('mobile-agent-channel')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'devices',
        filter: `mobile_number=eq.${linkedNumber}`,
      }, async (payload) => {
        const cmd      = payload.new.pending_command as string;
        const deviceId = payload.new.id as string;
        deviceIdRef.current = deviceId;

        // ── Live fake-shutdown config update ─────────────────────────────────
        // When the owner toggles Fake Shutdown or changes the sequence on the
        // web dashboard, the Realtime UPDATE arrives here. We compare against
        // the cached sequence so we only call the native module when something
        // actually changed.
        const newEnabled  = payload.new.fake_shutdown_enabled as boolean ?? false;
        const newSequence = payload.new.shutdown_sequence as string[] | null ?? null;
        
        // Live Last Gasp update
        const newLimit = payload.new.last_gasp_limit as number ?? 5;
        const imei = payload.new.imei1 as string ?? imeiRef.current;
        imeiRef.current = imei;
        let trustee = linkedNumber;
        if (payload.new.trusted_contacts && payload.new.trusted_contacts.length > 0) {
            trustee = payload.new.trusted_contacts[0];
            setCompanionTrustees(payload.new.trusted_contacts);
        }
        if (payload.new.last_gasp_limit !== undefined && payload.new.last_gasp_limit !== null) {
          setCompanionBatteryLimit(payload.new.last_gasp_limit);
        }
        if (Array.isArray(payload.new.shutdown_sequence)) {
          setCompanionSequence(payload.new.shutdown_sequence as ButtonToken[]);
        }
        try { await FakeShutdown.saveLastGaspPrefs(trustee, deviceId, newLimit, imei); } catch(e) { console.warn(e); }

        const seqChanged  = JSON.stringify(newSequence) !== JSON.stringify(shutdownSequenceRef.current);
        const enabledChanged = newEnabled !== fakeShutdownRunningRef.current;
        if (seqChanged || enabledChanged) {
          if (!prefSecurityRef.current) {
            // Local override: if security features are disabled locally, forcefully stop it
            if (fakeShutdownRunningRef.current) await handleFakeShutdownConfig(false, null);
          } else {
            await handleFakeShutdownConfig(newEnabled, newSequence);
          }
        }

        if (cmd === 'take_photo') {
          if (!prefCameraRef.current) {
            await supabase.from('devices').update({ pending_command: 'none', camera_last_error: 'Camera feature disabled on phone' }).eq('id', deviceId);
          } else {
            setStatusMsg('📸 Capturing…');
            try {
              if (!isCameraActiveRef.current && !isVideoStreamingRef.current) {
                throw new Error('Camera session is off. Start the camera from the dashboard first.');
              }
              const base64 = await BackgroundCamera.capturePhoto();
              const now = new Date();
              const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
              const fileName = `on_demand_${ts}.jpg`;
              const filePath = `${deviceId}/${fileName}`;
              const capturedAt = now.toISOString();

              const { error: uploadErr } = await supabase.storage
                .from('device_media').upload(filePath, decode(base64), { contentType: 'image/jpeg' });
              if (uploadErr) throw uploadErr;

              // Insert into photo_captures table
              await supabase.from('photo_captures').insert({
                device_id: deviceId,
                file_path: filePath,
                type: 'on_demand',
                captured_at: capturedAt,
              });

              // Keep devices.latest_photo_url updated for backward compat (store path now)
              await supabase.from('devices').update({ latest_photo_url: filePath, pending_command: 'none' }).eq('id', deviceId);
              setStatusMsg('✅ Photo sent!');

            } catch (err: any) {
              setStatusMsg('❌ ' + (err.message ?? 'Capture failed'));
              try {
                await supabase.from('devices').update({
                  pending_command: 'none',
                  camera_last_error: err?.message ?? 'Capture failed',
                }).eq('id', deviceId);
              } catch { }
            }
          }
        } else if (cmd === 'start_camera') {
          if (!prefCameraRef.current) {
            await supabase.from('devices').update({ pending_command: 'none', camera_last_error: 'Camera feature disabled on phone' }).eq('id', deviceId);
          } else {
            await startCamera(deviceId);
          }
        } else if (cmd === 'stop_camera') {
          await stopCamera(deviceId);
        } else if (cmd === 'start_video_stream') {
          if (!prefCameraRef.current) {
            await supabase.from('devices').update({ pending_command: 'none', camera_last_error: 'Camera feature disabled on phone' }).eq('id', deviceId);
          } else {
            await startVideoStream(deviceId);
          }
        } else if (cmd === 'stop_video_stream') {
          await stopVideoStream(deviceId);
        } else if (cmd === 'start_mic') {
          if (!prefMicRef.current) {
            await supabase.from('devices').update({ pending_command: 'none', mic_streaming: false }).eq('id', deviceId);
          } else {
            await startMic(deviceId);
          }
        } else if (cmd === 'stop_mic') {
          await stopMic(deviceId);
        } else if (cmd === 'start_location') {
          OfflineGps.setLostMode(true).catch(() => {});
          const hasServices = await Location.hasServicesEnabledAsync().catch(() => false);
          if (!prefLocationRef.current || !hasServices) {
            await supabase.from('devices').update({
              pending_command: 'none',
              location_active: false,
              location_last_error: 'device location off unable to fetch',
            }).eq('id', deviceId);
          } else {
            await startLocation(deviceId);
          }
        } else if (cmd === 'stop_location') {
          OfflineGps.setLostMode(false).catch(() => {});
          await stopLocation(deviceId);
        }
      })
      .subscribe(async (status) => {
        console.log('Realtime:', status);
        if (status === 'SUBSCRIBED') {
          setStatusMsg('🟢 Connected & listening');
          // Fetch device ID + fake shutdown settings in one query
            const { data } = await supabase
              .from('devices')
              .select('id, fake_shutdown_enabled, shutdown_sequence, trusted_contacts, last_gasp_limit, imei1')
              .eq('mobile_number', linkedNumber)
              .single();
            if (data) {
              deviceIdRef.current = data.id;
              try { await BackgroundCamera.syncDeviceId(data.id); } catch { }
              
              if (data.last_gasp_limit !== undefined && data.last_gasp_limit !== null) {
                setCompanionBatteryLimit(data.last_gasp_limit);
              }
              if (Array.isArray(data.shutdown_sequence)) {
                setCompanionSequence(data.shutdown_sequence as ButtonToken[]);
              }
              if (Array.isArray(data.trusted_contacts)) {
                setCompanionTrustees(data.trusted_contacts);
              }

              // Save Last Gasp Preferences
              let trustee = linkedNumber;
              if (data.trusted_contacts && data.trusted_contacts.length > 0) {
                 trustee = data.trusted_contacts[0];
              }
              const batteryLimit = data.last_gasp_limit ?? 5;
              const imei = data.imei1 || "Unknown";
              imeiRef.current = imei;
              try { await FakeShutdown.saveLastGaspPrefs(trustee, data.id, batteryLimit, imei); } catch(e) { console.warn(e); }

              // Push initial device info (best-effort IMEI + battery)
            await syncDeviceInfo();
            // Refresh battery every 2 minutes while listener is active
            batteryIntervalRef.current = setInterval(syncDeviceInfo, 120_000);
            // Apply fake shutdown config immediately (system-wide, works from home screen)
            if (prefSecurityRef.current) {
              await handleFakeShutdownConfig(
                data.fake_shutdown_enabled ?? false,
                data.shutdown_sequence ?? null,
              );
            }
          }
        }
      });

    return () => {
      supabase.removeChannel(channel);
      if (batteryIntervalRef.current) { clearInterval(batteryIntervalRef.current); batteryIntervalRef.current = null; }
      if (isMicActiveRef.current) {
        try { BackgroundAudio.stopRecording(); } catch { }
        audioSubRef.current?.remove();
        if (audioChannelRef.current) supabase.removeChannel(audioChannelRef.current);
        isMicActiveRef.current = false;
        audioSubRef.current = null;
        audioChannelRef.current = null;
      }
      if (isVideoStreamingRef.current) {
        isVideoStreamingRef.current = false;
        try { BackgroundCamera.stopVideoStream(); } catch { }
        videoFrameSubRef.current?.remove();
        videoFrameSubRef.current = null;
        if (videoChannelRef.current) { supabase.removeChannel(videoChannelRef.current); videoChannelRef.current = null; }
      }
      if (isCameraActiveRef.current) {
        try { BackgroundCamera.stopService(); } catch { }
        isCameraActiveRef.current = false;
        setIsCameraActive(false);
      }
    };
  }, [linkedNumber, isLoggedIn]);

  // ── Start / Stop ──────────────────────────────────────────────────────────
  
  
  // ── Permission screen ─────────────────────────────────────────────────────
  if (!permCameraGranted || !permAudioGranted) {
    return (
      <View style={s.container}>
        <Text style={s.title}>Permissions Required</Text>
        <Text style={s.text}>MobTrack needs Camera and Microphone access.</Text>
        <View style={{ marginTop: 16 }}>
          <Button title="Grant Permissions" onPress={requestPermissions} />
        </View>
        {renderUpdateModal()}
      </View>
    );
  }

  if (isInitializing) {
    return (
      <View style={s.container}>
        <Text style={s.title}>Loading...</Text>
        {renderUpdateModal()}
      </View>
    );
  }

  if (!isLoggedIn) {
    if (authView === 'login') {
      return (
        <View style={s.picContainer}>
          <View style={s.picBox}>
            <TextInput
              style={s.picInput}
              placeholder="ENTER MOBILE NUMBER"
              placeholderTextColor="#888"
              value={linkedNumber}
              onChangeText={setLinkedNumber}
              keyboardType="phone-pad"
              maxLength={10}
            />
            <TextInput
              style={s.picInput}
              placeholder="ENTER PASSWORD"
              placeholderTextColor="#888"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />

            <TouchableOpacity
              style={s.picLoginBtn}
              onPress={handleLogin}
              disabled={loginLoading}
              activeOpacity={0.8}
            >
              {loginLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={s.picLoginBtnText}>Login</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={{ marginTop: 32, marginBottom: 14 }}
              onPress={() => {
                setForgotMobile(linkedNumber);
                setIsForgotVerified(false);
                setForgotOtpSent(false);
                setForgotBackupCode('');
                setForgotTrusteeNumber('');
                setForgotOtpInput('');
                setNewPassword('');
                setConfirmNewPassword('');
                setAuthView('forgot');
              }}
              activeOpacity={0.7}
            >
              <Text style={s.picLinkText}>Forgot Password?</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setRegGeneratedCodes([]);
                setAuthView('register');
              }}
              activeOpacity={0.7}
            >
              <Text style={s.picLinkText}>
                No <Text style={{ textDecorationLine: 'underline', color: '#fff' }}>Account?Create</Text> One.
              </Text>
            </TouchableOpacity>

            <View style={[s.versionRow, { marginTop: 45, width: '100%', borderTopColor: '#222' }]}>
              <Text style={s.versionText}>MobTrack v{currentAppVersion.versionName}</Text>
              <TouchableOpacity
                style={s.checkUpdateButton}
                onPress={() => checkForUpdates(false)}
                disabled={isCheckingUpdate}
              >
                <Text style={s.checkUpdateButtonText}>
                  {isCheckingUpdate ? 'Checking...' : 'Check for Updates'}
                </Text>
              </TouchableOpacity>
            </View>
            <Text
              style={{ color: '#555', fontSize: 10, textAlign: 'center', marginTop: 4 }}
              selectable={true}
            >
              Device: {ApkUpdater.getDeviceId() || 'N/A'}
            </Text>
          </View>
          {renderUpdateModal()}
        </View>
      );
    }

    if (authView === 'forgot') {
      return (
        <ScrollView contentContainerStyle={s.regScroll} style={{ backgroundColor: '#000' }}>
          <View style={s.authHeader}>
            <TouchableOpacity onPress={() => setAuthView('login')} style={s.backBtn}>
              <Text style={s.backBtnText}>← Back to Login</Text>
            </TouchableOpacity>
            <Text style={s.title}>RESET PASSWORD</Text>
          </View>

          {!isForgotVerified ? (
            <View style={s.regCard}>
              <Text style={s.regSectionTitle}>Step 1: Verify Identity</Text>
              <Text style={s.textMuted}>Enter your registered mobile number and choose a recovery method:</Text>

              <TextInput
                style={s.formInput}
                placeholder="10-digit Registered Mobile Number"
                placeholderTextColor="#666"
                value={forgotMobile}
                onChangeText={setForgotMobile}
                keyboardType="phone-pad"
                maxLength={10}
              />

              <View style={s.tabRow}>
                <TouchableOpacity
                  style={[s.tabBtn, forgotMode === 'backup' && s.tabBtnActive]}
                  onPress={() => setForgotMode('backup')}
                >
                  <Text style={[s.tabBtnText, forgotMode === 'backup' && s.tabBtnTextActive]}>Backup Code</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.tabBtn, forgotMode === 'trustee' && s.tabBtnActive]}
                  onPress={() => setForgotMode('trustee')}
                >
                  <Text style={[s.tabBtnText, forgotMode === 'trustee' && s.tabBtnTextActive]}>Trustee Phone OTP</Text>
                </TouchableOpacity>
              </View>

              {forgotMode === 'backup' ? (
                <View style={{ marginTop: 14 }}>
                  <Text style={s.textMuted}>Enter any 1 of your 5 Emergency Backup Codes:</Text>
                  <TextInput
                    style={[s.formInput, { textAlign: 'center', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', letterSpacing: 2 }]}
                    placeholder="e.g. 8A3B9X1Y"
                    placeholderTextColor="#666"
                    value={forgotBackupCode}
                    onChangeText={setForgotBackupCode}
                    autoCapitalize="characters"
                    maxLength={12}
                  />
                  <TouchableOpacity
                    style={[s.primaryBtn, { marginTop: 8 }]}
                    onPress={handleVerifyBackupCode}
                    disabled={forgotOtpLoading}
                  >
                    {forgotOtpLoading ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={s.primaryBtnText}>VERIFY BACKUP CODE</Text>
                    )}
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={{ marginTop: 14 }}>
                  <Text style={s.textMuted}>Enter your registered Trustee Mobile Number:</Text>
                  <TextInput
                    style={s.formInput}
                    placeholder="10-digit Trustee Mobile Number"
                    placeholderTextColor="#666"
                    value={forgotTrusteeNumber}
                    onChangeText={setForgotTrusteeNumber}
                    keyboardType="phone-pad"
                    maxLength={10}
                  />
                  {!forgotOtpSent ? (
                    <TouchableOpacity
                      style={[s.primaryBtn, { marginTop: 8 }]}
                      onPress={handleSendTrusteeOtp}
                      disabled={forgotOtpLoading}
                    >
                      {forgotOtpLoading ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <Text style={s.primaryBtnText}>SEND OTP TO TRUSTEE</Text>
                      )}
                    </TouchableOpacity>
                  ) : (
                    <View style={{ marginTop: 12 }}>
                      <Text style={s.textMuted}>Enter 6-digit OTP received by Trustee:</Text>
                      <TextInput
                        style={[s.formInput, { textAlign: 'center', letterSpacing: 4, fontWeight: 'bold' }]}
                        placeholder="6-digit OTP"
                        placeholderTextColor="#666"
                        value={forgotOtpInput}
                        onChangeText={setForgotOtpInput}
                        keyboardType="numeric"
                        maxLength={6}
                      />
                      <TouchableOpacity
                        style={[s.primaryBtn, { marginTop: 8 }]}
                        onPress={handleConfirmTrusteeOtp}
                        disabled={forgotOtpLoading}
                      >
                        {forgotOtpLoading ? (
                          <ActivityIndicator color="#fff" />
                        ) : (
                          <Text style={s.primaryBtnText}>CONFIRM OTP</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              )}
            </View>
          ) : (
            <View style={s.regCard}>
              <Text style={s.regSectionTitle}>Step 2: Create New Password</Text>
              <Text style={[s.textMuted, { color: '#fbbf24', marginBottom: 12 }]}>
                Rule: Must be at least 8 characters long, containing 1 uppercase, 1 lowercase, 1 number, and 1 special character.
              </Text>

              <TextInput
                style={s.formInput}
                placeholder="New Password"
                placeholderTextColor="#666"
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
              />
              <TextInput
                style={s.formInput}
                placeholder="Confirm New Password"
                placeholderTextColor="#666"
                value={confirmNewPassword}
                onChangeText={setConfirmNewPassword}
                secureTextEntry
              />

              <TouchableOpacity
                style={[s.primaryBtn, { marginTop: 12, backgroundColor: '#16a34a' }]}
                onPress={handleUpdatePassword}
                disabled={resetPassLoading}
              >
                {resetPassLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={s.primaryBtnText}>SET NEW PASSWORD</Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {renderUpdateModal()}
        </ScrollView>
      );
    }

    if (authView === 'register') {
      return (
        <ScrollView contentContainerStyle={s.regScroll} style={{ backgroundColor: '#000' }}>
          <View style={s.authHeader}>
            <TouchableOpacity onPress={() => setAuthView('login')} style={s.backBtn}>
              <Text style={s.backBtnText}>← Back to Login</Text>
            </TouchableOpacity>
            <Text style={s.title}>CREATE ACCOUNT</Text>
          </View>

          {regGeneratedCodes.length === 0 ? (
            <View>
              {/* Step 1: Device IMEI */}
              <View style={s.regCard}>
                <Text style={s.regSectionTitle}>1. Device IMEI (Mandatory)</Text>
                
                {/* 3 Ways Guide */}
                <View style={s.imeiGuideCard}>
                  <Text style={s.imeiGuideHeader}>3 Ways to Find Your IMEI Number</Text>
                  <View style={s.imeiRow}>
                    <View style={s.imeiGuideItem}>
                      <Image source={imeiBoxImg} style={s.imeiImage} resizeMode="cover" />
                      <Text style={s.imeiGuideText}>1. On the Box{"\n"}Check sticker</Text>
                    </View>
                    <View style={s.imeiGuideItem}>
                      <Image source={imeiDialerImg} style={s.imeiImage} resizeMode="cover" />
                      <Text style={s.imeiGuideText}>2. Dial *#06#{"\n"}View on screen</Text>
                    </View>
                    <View style={s.imeiGuideItem}>
                      <Image source={imeiSettingsImg} style={s.imeiImage} resizeMode="cover" />
                      <Text style={s.imeiGuideText}>3. Settings{"\n"}About Phone</Text>
                    </View>
                  </View>
                </View>

                <TextInput
                  style={s.formInput}
                  placeholder="15-digit IMEI 1 (Compulsory)"
                  placeholderTextColor="#666"
                  value={regImei1}
                  onChangeText={(t) => setRegImei1(t.replace(/[^0-9]/g, '').slice(0, 15))}
                  keyboardType="numeric"
                  maxLength={15}
                />
                <TextInput
                  style={s.formInput}
                  placeholder="15-digit IMEI 2 (Optional)"
                  placeholderTextColor="#666"
                  value={regImei2}
                  onChangeText={(t) => setRegImei2(t.replace(/[^0-9]/g, '').slice(0, 15))}
                  keyboardType="numeric"
                  maxLength={15}
                />
              </View>

              {/* Step 2: Owner Details */}
              <View style={s.regCard}>
                <Text style={s.regSectionTitle}>2. Owner Details</Text>
                <TextInput
                  style={s.formInput}
                  placeholder="Official Full Name"
                  placeholderTextColor="#666"
                  value={regFullName}
                  onChangeText={setRegFullName}
                />

                <View style={s.verifyInputRow}>
                  <TextInput
                    style={[s.formInput, { flex: 1, marginBottom: 0 }]}
                    placeholder="10-digit Mobile Number"
                    placeholderTextColor="#666"
                    value={regMobileNumber}
                    onChangeText={(t) => {
                      setRegMobileNumber(t.replace(/[^0-9]/g, '').slice(0, 10));
                      setRegIsMobileVerified(false);
                      setRegMobileVerifying(false);
                    }}
                    keyboardType="phone-pad"
                    maxLength={10}
                    editable={!regIsMobileVerified && !regMobileVerifying}
                  />
                  {!regIsMobileVerified ? (
                    !regMobileVerifying ? (
                      <TouchableOpacity
                        style={s.verifyActionBtn}
                        onPress={handleRegSendOwnerOtp}
                        disabled={regMobileOtpLoading}
                      >
                        {regMobileOtpLoading ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <Text style={s.verifyActionBtnText}>VERIFY</Text>
                        )}
                      </TouchableOpacity>
                    ) : null
                  ) : (
                    <View style={s.verifiedBadge}>
                      <Text style={s.verifiedBadgeText}>VERIFIED</Text>
                    </View>
                  )}
                </View>

                {regMobileVerifying && !regIsMobileVerified && (
                  <View style={s.inlineOtpRow}>
                    <TextInput
                      style={[s.formInput, { width: 110, textAlign: 'center', marginBottom: 0, fontWeight: 'bold' }]}
                      placeholder="6-digit OTP"
                      placeholderTextColor="#666"
                      value={regMobileOtp}
                      onChangeText={setRegMobileOtp}
                      keyboardType="numeric"
                      maxLength={6}
                    />
                    <TouchableOpacity
                      style={[s.verifyActionBtn, { backgroundColor: '#2563eb' }]}
                      onPress={handleRegConfirmOwnerOtp}
                      disabled={regMobileOtpLoading}
                    >
                      {regMobileOtpLoading ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={s.verifyActionBtnText}>CONFIRM</Text>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[s.verifyActionBtn, { backgroundColor: '#dc2626', minWidth: 40 }]}
                      onPress={() => setRegMobileVerifying(false)}
                    >
                      <Text style={s.verifyActionBtnText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                )}

                <Text style={[s.textMuted, { marginTop: 12, marginBottom: 4, color: '#fbbf24' }]}>
                  Password: 8+ chars (1 uppercase, 1 lowercase, 1 number, 1 special character)
                </Text>
                <TextInput
                  style={s.formInput}
                  placeholder="Security Password"
                  placeholderTextColor="#666"
                  value={regPassword}
                  onChangeText={setRegPassword}
                  secureTextEntry
                />
              </View>

              {/* Step 3: Trustee Devices */}
              <View style={s.regCard}>
                <Text style={s.regSectionTitle}>3. Trustee Devices (Max 5)</Text>
                <Text style={s.textMuted}>Trustee 1 is mandatory. Must verify via OTP.</Text>

                {regTrustees.map((item, idx) => (
                  <View key={idx} style={{ marginBottom: 10 }}>
                    <View style={s.verifyInputRow}>
                      <Text style={s.trusteeIndex}>{idx + 1}.</Text>
                      <TextInput
                        style={[s.formInput, { flex: 1, marginBottom: 0 }]}
                        placeholder={idx === 0 ? "Trustee 1 (Compulsory)" : `Trustee ${idx + 1} (Optional)`}
                        placeholderTextColor="#666"
                        value={item.number}
                        onChangeText={(t) => updateRegTrusteeNumber(idx, t)}
                        keyboardType="phone-pad"
                        maxLength={10}
                        editable={!item.verified && regTrusteeVerifyingIndex !== idx}
                      />
                      {item.number.length === 10 && !item.verified && regTrusteeVerifyingIndex !== idx && (
                        <TouchableOpacity
                          style={s.verifyActionBtn}
                          onPress={() => handleRegSendTrusteeOtp(idx)}
                          disabled={regTrusteeOtpLoading}
                        >
                          {regTrusteeOtpLoading && regTrusteeVerifyingIndex === idx ? (
                            <ActivityIndicator size="small" color="#fff" />
                          ) : (
                            <Text style={s.verifyActionBtnText}>VERIFY</Text>
                          )}
                        </TouchableOpacity>
                      )}
                      {item.verified && (
                        <View style={s.verifiedBadge}>
                          <Text style={s.verifiedBadgeText}>VERIFIED</Text>
                        </View>
                      )}
                    </View>

                    {regTrusteeVerifyingIndex === idx && !item.verified && (
                      <View style={[s.inlineOtpRow, { marginLeft: 24 }]}>
                        <TextInput
                          style={[s.formInput, { width: 110, textAlign: 'center', marginBottom: 0, fontWeight: 'bold' }]}
                          placeholder="6-digit OTP"
                          placeholderTextColor="#666"
                          value={regTrusteeOtp}
                          onChangeText={setRegTrusteeOtp}
                          keyboardType="numeric"
                          maxLength={6}
                        />
                        <TouchableOpacity
                          style={[s.verifyActionBtn, { backgroundColor: '#2563eb' }]}
                          onPress={handleRegConfirmTrusteeOtp}
                          disabled={regTrusteeOtpLoading}
                        >
                          {regTrusteeOtpLoading ? (
                            <ActivityIndicator size="small" color="#fff" />
                          ) : (
                            <Text style={s.verifyActionBtnText}>OK</Text>
                          )}
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[s.verifyActionBtn, { backgroundColor: '#dc2626', minWidth: 40 }]}
                          onPress={() => {
                            setRegTrusteeVerifyingIndex(null);
                            setRegTrusteeOtp('');
                          }}
                        >
                          <Text style={s.verifyActionBtnText}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                ))}
              </View>

              {/* Step 4: Fake Shutdown & Threshold Limit */}
              <View style={s.regCard}>
                <Text style={s.regSectionTitle}>4. Fake Shutdown & Emergency Settings</Text>
                <Text style={s.textMuted}>
                  When Power is pressed anywhere on the phone, it shows a convincing fake shutdown animation.
                  The phone keeps running invisibly in the background. Configure a secret button combo below to exit the fake screen.
                </Text>

                <View style={s.toggleRow}>
                  <Text style={s.toggleLabel}>Enable Fake Shutdown</Text>
                  <Switch
                    value={regFakeShutdownEnabled}
                    onValueChange={setRegFakeShutdownEnabled}
                    trackColor={{ false: '#333', true: '#2563eb' }}
                  />
                </View>

                {regFakeShutdownEnabled && (
                  <View style={{ marginTop: 12 }}>
                    <Text style={[s.textMuted, { color: '#e2e8f0', fontWeight: 'bold' }]}>
                      Secret Unlock Sequence (Minimum 2 steps):
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 8 }}>
                      {(['volUp', 'volDown', 'power'] as ButtonToken[]).map(btn => (
                        <TouchableOpacity
                          key={btn}
                          style={s.comboAddBtn}
                          onPress={() => addRegSequenceStep(btn)}
                        >
                          <Text style={s.comboAddBtnText}>+ {BUTTON_LABELS[btn]}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    <View style={s.sequenceBox}>
                      {regSequence.length === 0 ? (
                        <Text style={{ color: '#666', fontSize: 12 }}>Tap buttons above to build your secret sequence…</Text>
                      ) : (
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                          {regSequence.map((b, i) => (
                            <View key={i} style={s.sequenceChip}>
                              <Text style={s.sequenceChipText}>{BUTTON_LABELS[b]}</Text>
                              <TouchableOpacity onPress={() => removeRegSequenceStep(i)}>
                                <Text style={s.sequenceChipRemove}>✕</Text>
                              </TouchableOpacity>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                    {regSequence.length > 0 && regSequence.length < 2 && (
                      <Text style={{ color: '#f59e0b', fontSize: 11, marginTop: 4 }}>⚠ Add at least 1 more step (min 2 required)</Text>
                    )}
                    {regSequence.length >= 2 && (
                      <Text style={{ color: '#10b981', fontSize: 11, marginTop: 4 }}>✓ Sequence ready ({regSequence.length} steps)</Text>
                    )}
                  </View>
                )}

                {/* Last Gasp Battery Threshold */}
                <View style={{ marginTop: 18, borderTopWidth: 1, borderTopColor: '#222', paddingTop: 14 }}>
                  <Text style={[s.textMuted, { color: '#e2e8f0', fontWeight: 'bold' }]}>
                    Last Gasp Battery Threshold:
                  </Text>
                  <Text style={[s.textMuted, { fontSize: 11, marginBottom: 8 }]}>
                    If battery drops to or below this level, device sends location and emergency alert to Trustee 1.
                  </Text>
                  <BatterySlider
                    value={regLastGaspLimit}
                    onValueChange={setRegLastGaspLimit}
                    min={1}
                    max={100}
                  />
                </View>
              </View>

              {/* Submit Button */}
              <TouchableOpacity
                style={[s.primaryBtn, { backgroundColor: '#2563eb', paddingVertical: 16, marginBottom: 40 }]}
                onPress={handleCompleteRegistration}
                disabled={regLoading}
              >
                {regLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={[s.primaryBtnText, { fontSize: 16 }]}>COMPLETE REGISTRATION</Text>
                )}
              </TouchableOpacity>
            </View>
          ) : (
            /* Registration Complete Screen */
            <View style={[s.regCard, { alignItems: 'center', paddingVertical: 28 }]}>
              <Text style={{ color: '#10b981', fontSize: 22, fontWeight: 'bold', marginBottom: 8 }}>
                ✓ REGISTRATION COMPLETE
              </Text>
              <Text style={{ color: '#e2e8f0', fontSize: 14, textAlign: 'center', marginBottom: 18 }}>
                Save These 5 Emergency Backup Codes
              </Text>

              <View style={s.backupCodesBox}>
                {regGeneratedCodes.map((code, index) => (
                  <Text key={index} style={s.backupCodeText}>
                    {index + 1}. {code}
                  </Text>
                ))}
              </View>

              <Text style={{ color: '#f59e0b', fontSize: 12, textAlign: 'center', marginVertical: 14 }}>
                ⚠️ Please write down or screenshot these codes. You can use any 1 of these codes to reset your password if forgotten.
              </Text>

              <TouchableOpacity
                style={[s.primaryBtn, { width: '100%', backgroundColor: '#16a34a', marginTop: 10 }]}
                onPress={handleProceedAfterRegistration}
              >
                <Text style={s.primaryBtnText}>PROCEED TO APP</Text>
              </TouchableOpacity>
            </View>
          )}

          {renderUpdateModal()}
        </ScrollView>
      );
    }
  }

  // ── Settings Handlers ─────────────────────────────────────────────────────
  const loadLatestSettings = async () => {
    if (!deviceIdRef.current && !linkedNumber) return;
    try {
      let query = supabase
        .from('devices')
        .select('id, fake_shutdown_enabled, shutdown_sequence, trusted_contacts, last_gasp_limit, imei1');
      if (deviceIdRef.current) {
        query = query.eq('id', deviceIdRef.current);
      } else {
        query = query.eq('mobile_number', linkedNumber);
      }
      const { data } = await query.single();
      if (data) {
        if (data.last_gasp_limit !== undefined && data.last_gasp_limit !== null) {
          setCompanionBatteryLimit(data.last_gasp_limit);
        }
        if (Array.isArray(data.shutdown_sequence)) {
          setCompanionSequence(data.shutdown_sequence as ButtonToken[]);
        }
        if (Array.isArray(data.trusted_contacts)) {
          setCompanionTrustees(data.trusted_contacts);
        }
      }
    } catch (e) {
      console.warn('Error loading settings:', e);
    }
  };

  const saveBatteryLimit = async () => {
    if (!deviceIdRef.current && !linkedNumber) return;
    setSavingSettings(true);
    try {
      let query = supabase.from('devices').update({ last_gasp_limit: companionBatteryLimit });
      if (deviceIdRef.current) {
        query = query.eq('id', deviceIdRef.current);
      } else {
        query = query.eq('mobile_number', linkedNumber);
      }
      const { error } = await query;
      if (error) throw error;

      const primary = companionTrustees[0] || linkedNumber;
      await FakeShutdown.saveLastGaspPrefs(primary, deviceIdRef.current, companionBatteryLimit, imeiRef.current);

      Alert.alert('Success', `Emergency battery threshold updated to ${companionBatteryLimit}%.`);
      setSettingsView('menu');
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to save battery limit');
    } finally {
      setSavingSettings(false);
    }
  };

  const saveSecretKey = async () => {
    if (!deviceIdRef.current && !linkedNumber) return;
    if (companionSequence.length < 2) {
      Alert.alert('Error', 'Please build a secret sequence of at least 2 button presses.');
      return;
    }
    setSavingSettings(true);
    try {
      let query = supabase.from('devices').update({ shutdown_sequence: companionSequence });
      if (deviceIdRef.current) {
        query = query.eq('id', deviceIdRef.current);
      } else {
        query = query.eq('mobile_number', linkedNumber);
      }
      const { error } = await query;
      if (error) throw error;

      shutdownSequenceRef.current = companionSequence;
      if (fakeShutdownRunningRef.current) {
        await FakeShutdown.updateConfig(companionSequence);
      }

      Alert.alert('Success', 'Secret unlock sequence saved successfully.');
      setSettingsView('menu');
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to save secret key');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleDeleteTrustee = (index: number) => {
    if (companionTrustees.length <= 1) {
      Alert.alert(
        'Cannot Delete',
        'At least 1 trustee device is compulsory. You must have at least one trustee registered on your account.'
      );
      return;
    }
    const target = companionTrustees[index];
    Alert.alert(
      'Delete Trustee',
      `Are you sure you want to delete trustee +91 ${target}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const updated = companionTrustees.filter((_, i) => i !== index);
            setCompanionTrustees(updated);
            try {
              let query = supabase.from('devices').update({ trusted_contacts: updated });
              if (deviceIdRef.current) {
                query = query.eq('id', deviceIdRef.current);
              } else {
                query = query.eq('mobile_number', linkedNumber);
              }
              await query;

              if (updated.length > 0) {
                await FakeShutdown.saveLastGaspPrefs(updated[0], deviceIdRef.current, companionBatteryLimit, imeiRef.current);
              }
              Alert.alert('Success', `Trustee +91 ${target} deleted.`);
            } catch (e: any) {
              Alert.alert('Error', e.message || 'Failed to delete trustee');
              loadLatestSettings();
            }
          },
        },
      ]
    );
  };

  const handleSendNewTrusteeOtp = async () => {
    const clean = newTrusteeInput.trim().replace(/[^0-9]/g, '');
    if (clean.length !== 10) {
      Alert.alert('Error', 'Trustee mobile number must be exactly 10 digits.');
      return;
    }
    if (clean === linkedNumber) {
      Alert.alert('Error', 'You cannot add your own primary mobile number as a trustee.');
      return;
    }
    if (companionTrustees.includes(clean)) {
      Alert.alert('Error', 'This trustee is already added.');
      return;
    }
    if (companionTrustees.length >= 5) {
      Alert.alert('Limit Reached', 'You can register a maximum of 5 trustee devices.');
      return;
    }

    setTrusteeOtpLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        phone: '+91' + clean,
      });
      if (error) throw error;

      setNewTrusteeOtpSent(true);
      setNewTrusteeOtp('');
      Alert.alert('OTP Sent', `A 6-digit OTP has been sent to +91 ${clean}.`);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to send OTP to trustee');
    } finally {
      setTrusteeOtpLoading(false);
    }
  };

  const handleVerifyNewTrusteeOtp = async () => {
    const clean = newTrusteeInput.trim().replace(/[^0-9]/g, '');
    const code = newTrusteeOtp.trim();
    if (code.length !== 6) {
      Alert.alert('Error', 'OTP must be exactly 6 digits.');
      return;
    }

    setTrusteeOtpLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        phone: '+91' + clean,
        token: code,
        type: 'sms',
      });
      if (error) throw error;

      const updated = [...companionTrustees, clean];
      setCompanionTrustees(updated);

      let query = supabase.from('devices').update({ trusted_contacts: updated });
      if (deviceIdRef.current) {
        query = query.eq('id', deviceIdRef.current);
      } else {
        query = query.eq('mobile_number', linkedNumber);
      }
      await query;

      await FakeShutdown.saveLastGaspPrefs(updated[0], deviceIdRef.current, companionBatteryLimit, imeiRef.current);

      setNewTrusteeInput('');
      setNewTrusteeOtp('');
      setNewTrusteeOtpSent(false);

      Alert.alert('Success', `Trustee +91 ${clean} verified and added!`);
    } catch (e: any) {
      Alert.alert('Invalid OTP', e.message || 'Verification failed');
    } finally {
      setTrusteeOtpLoading(false);
    }
  };

  const confirmLogout = () => {
    Alert.alert(
      'Log Out',
      'Are you sure you want to log out of MobTrack? Your account configuration and tracking data will remain safe in the cloud.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out',
          style: 'destructive',
          onPress: async () => {
            try {
              if (deviceIdRef.current) {
                if (isCameraActiveRef.current) await stopCamera(deviceIdRef.current);
                if (isVideoStreamingRef.current) await stopVideoStream(deviceIdRef.current);
                if (isMicActiveRef.current) await stopMic(deviceIdRef.current);
              }
              await AsyncStorage.removeItem('mobtrack_linked_number');
              await AsyncStorage.removeItem('mobtrack_device_id');

              setIsLoggedIn(false);
              setLinkedNumber('');
              setPassword('');
              deviceIdRef.current = '';
              setShowSettingsModal(false);
              setSettingsView('menu');
              setAuthView('login');
            } catch (e: any) {
              Alert.alert('Error', e.message || 'Logout failed');
            }
          },
        },
      ]
    );
  };

  const confirmDeleteAccount = () => {
    Alert.alert(
      '⚠️ PERMANENT ACCOUNT DELETION',
      'THIS ACTION CANNOT BE UNDONE!\n\nAre you sure you want to delete your account?\n\n• Your device registration will be deleted from the database.\n• All photos and 24-hour GPS tracking records will be permanently erased.\n• Emergency contacts and secret keys will be destroyed.\n\nYou will be returned to the Create Account screen.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'DELETE PERMANENTLY',
          style: 'destructive',
          onPress: performDeleteAccount,
        },
      ]
    );
  };

  const performDeleteAccount = async () => {
    const id = deviceIdRef.current;
    if (!id && !linkedNumber) return;

    try {
      // 1. Stop all native services
      try { await FakeShutdown.stopService(); } catch {}
      try { await FakeShutdown.stopLastGaspService(); } catch {}
      try { await FakeShutdown.disableFactoryReset(); } catch {}
      try { await BackgroundCamera.stopService(); } catch {}
      try { await OfflineGps.stopOfflineTracking(); } catch {}
      try { await FakeShutdown.saveLastGaspPrefs('', '', 0, ''); } catch {}

      // 2. Storage cleanup and database deletion
      if (id) {
        try {
          const { data: files } = await supabase.storage.from('device_media').list(id);
          if (files && files.length > 0) {
            await supabase.storage.from('device_media').remove(files.map(f => `${id}/${f.name}`));
          }
        } catch {}
        await supabase.from('offline_gps_history').delete().eq('device_id', id);
        await supabase.from('photo_captures').delete().eq('device_id', id);
        await supabase.from('devices').delete().eq('id', id);
      } else if (linkedNumber) {
        await supabase.from('devices').delete().eq('mobile_number', linkedNumber);
      }

      // 3. Clear AsyncStorage
      await AsyncStorage.clear();

      // 4. Reset state & navigate to Register
      setIsLoggedIn(false);
      setLinkedNumber('');
      setPassword('');
      deviceIdRef.current = '';
      setShowSettingsModal(false);
      setSettingsView('menu');
      setAuthView('register');

      Alert.alert('Account Deleted', 'Your account and all associated data have been permanently erased from the website, app, and database.');
    } catch (e: any) {
      Alert.alert('Error', 'Failed to completely delete account: ' + (e?.message || 'Unknown error'));
    }
  };

  const renderSettingsModal = () => (
    <Modal
      visible={showSettingsModal}
      animationType="slide"
      transparent={true}
      onRequestClose={() => {
        if (settingsView !== 'menu') {
          setSettingsView('menu');
        } else {
          setShowSettingsModal(false);
        }
      }}
    >
      <View style={s.settingsOverlay}>
        <View style={s.settingsContainer}>
          {/* Header */}
          <View style={s.settingsHeader}>
            {settingsView !== 'menu' ? (
              <TouchableOpacity
                style={s.settingsBackBtn}
                onPress={() => setSettingsView('menu')}
              >
                <Text style={s.settingsBackBtnText}>‹ Back</Text>
              </TouchableOpacity>
            ) : (
              <Text style={s.settingsTitle}>⚙️ Settings</Text>
            )}
            <TouchableOpacity
              style={s.settingsCloseBtn}
              onPress={() => {
                setSettingsView('menu');
                setShowSettingsModal(false);
              }}
            >
              <Text style={s.settingsCloseBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={s.settingsScrollContent}>
            {/* View 1: Main Menu */}
            {settingsView === 'menu' && (
              <View style={{ gap: 12 }}>
                {/* 1. Battery Threshold Limit */}
                <TouchableOpacity
                  style={s.settingsMenuItem}
                  onPress={() => setSettingsView('battery')}
                >
                  <View style={s.settingsMenuLeft}>
                    <Text style={s.settingsMenuIcon}>🔋</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={s.settingsMenuTitle}>Battery Threshold Limit</Text>
                      <Text style={s.settingsMenuSub}>
                        Emergency level: {companionBatteryLimit}% (1% - 100%)
                      </Text>
                    </View>
                  </View>
                  <Text style={s.settingsMenuArrow}>›</Text>
                </TouchableOpacity>

                {/* 2. Secret Key */}
                <TouchableOpacity
                  style={s.settingsMenuItem}
                  onPress={() => setSettingsView('secretKey')}
                >
                  <View style={s.settingsMenuLeft}>
                    <Text style={s.settingsMenuIcon}>🔑</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={s.settingsMenuTitle}>Secret Unlock Key</Text>
                      <Text style={s.settingsMenuSub}>
                        {companionSequence.length > 0 ? `${companionSequence.length} buttons configured` : 'Configure unlock sequence'}
                      </Text>
                    </View>
                  </View>
                  <Text style={s.settingsMenuArrow}>›</Text>
                </TouchableOpacity>

                {/* 3. Trustee Devices */}
                <TouchableOpacity
                  style={s.settingsMenuItem}
                  onPress={() => setSettingsView('trustees')}
                >
                  <View style={s.settingsMenuLeft}>
                    <Text style={s.settingsMenuIcon}>👥</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={s.settingsMenuTitle}>Trustee Devices</Text>
                      <Text style={s.settingsMenuSub}>
                        {companionTrustees.length} / 5 devices registered (Min 1 compulsory)
                      </Text>
                    </View>
                  </View>
                  <Text style={s.settingsMenuArrow}>›</Text>
                </TouchableOpacity>

                {/* Divider */}
                <View style={{ height: 1, backgroundColor: '#262626', marginVertical: 6 }} />

                {/* 4. Log Out */}
                <TouchableOpacity
                  style={[s.settingsMenuItem, { borderColor: '#3b3b3b' }]}
                  onPress={confirmLogout}
                >
                  <View style={s.settingsMenuLeft}>
                    <Text style={s.settingsMenuIcon}>🚪</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.settingsMenuTitle, { color: '#f59e0b' }]}>Log Out</Text>
                      <Text style={s.settingsMenuSub}>Safely log out of this device</Text>
                    </View>
                  </View>
                  <Text style={[s.settingsMenuArrow, { color: '#f59e0b' }]}>›</Text>
                </TouchableOpacity>

                {/* 5. Delete Account */}
                <TouchableOpacity
                  style={[s.settingsMenuItem, { borderColor: '#7f1d1d', backgroundColor: '#1a0d0d' }]}
                  onPress={confirmDeleteAccount}
                >
                  <View style={s.settingsMenuLeft}>
                    <Text style={s.settingsMenuIcon}>⚠️</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.settingsMenuTitle, { color: '#ef4444' }]}>Delete Account</Text>
                      <Text style={[s.settingsMenuSub, { color: '#f87171' }]}>
                        Permanent wipe from website, app & database
                      </Text>
                    </View>
                  </View>
                  <Text style={[s.settingsMenuArrow, { color: '#ef4444' }]}>›</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* View 2: Battery Threshold Sub-view */}
            {settingsView === 'battery' && (
              <View>
                <Text style={s.subViewTitle}>🔋 Battery Threshold Limit</Text>
                <Text style={s.subViewDesc}>
                  Configure the emergency battery percentage (between 1% and 100%). When your device battery drops to this level, MobTrack's Last Gasp engine triggers an emergency SMS with live GPS location to your primary trustee.
                </Text>

                <BatterySlider
                  value={companionBatteryLimit}
                  onValueChange={setCompanionBatteryLimit}
                  min={1}
                  max={100}
                />

                <TouchableOpacity
                  style={[s.settingsActionBtn, { marginTop: 16 }]}
                  onPress={saveBatteryLimit}
                  disabled={savingSettings}
                >
                  {savingSettings ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={s.settingsActionBtnText}>💾 SAVE BATTERY LIMIT</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}

            {/* View 3: Secret Key Sub-view */}
            {settingsView === 'secretKey' && (
              <View>
                <Text style={s.subViewTitle}>🔑 Secret Key Configuration</Text>
                <Text style={s.subViewDesc}>
                  Build the secret hardware button sequence needed to exit Fake Shutdown, silence SIM Alarm, or bypass Fake Factory Reset.
                </Text>

                {/* Buttons to Add */}
                <View style={{ flexDirection: 'row', gap: 8, marginVertical: 12 }}>
                  {(['volUp', 'volDown', 'power'] as ButtonToken[]).map((btn) => (
                    <TouchableOpacity
                      key={btn}
                      style={s.comboAddBtn}
                      onPress={() => setCompanionSequence(prev => [...prev, btn])}
                    >
                      <Text style={s.comboAddBtnText}>+ {BUTTON_LABELS[btn]}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Sequence display */}
                <View style={s.sequenceBox}>
                  {companionSequence.length === 0 ? (
                    <Text style={{ color: '#666', fontSize: 12 }}>
                      Tap the buttons above to build your secret sequence…
                    </Text>
                  ) : (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                      {companionSequence.map((b, i) => (
                        <View key={i} style={s.sequenceChip}>
                          <Text style={s.sequenceChipText}>{BUTTON_LABELS[b]}</Text>
                          <TouchableOpacity onPress={() => setCompanionSequence(prev => prev.filter((_, idx) => idx !== i))}>
                            <Text style={s.sequenceChipRemove}>✕</Text>
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  )}
                </View>

                {companionSequence.length > 0 && companionSequence.length < 2 && (
                  <Text style={{ color: '#f59e0b', fontSize: 12, marginTop: 6 }}>
                    ⚠ Add at least 1 more button (min 2 required)
                  </Text>
                )}
                {companionSequence.length >= 2 && (
                  <Text style={{ color: '#10b981', fontSize: 12, marginTop: 6 }}>
                    ✓ Sequence ready ({companionSequence.length} buttons)
                  </Text>
                )}

                {companionSequence.length > 0 && (
                  <TouchableOpacity
                    style={{ alignSelf: 'flex-start', marginTop: 8 }}
                    onPress={() => setCompanionSequence([])}
                  >
                    <Text style={{ color: '#ef4444', fontSize: 12, fontWeight: 'bold' }}>Clear Sequence</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={[s.settingsActionBtn, { marginTop: 20 }]}
                  onPress={saveSecretKey}
                  disabled={savingSettings || companionSequence.length < 2}
                >
                  {savingSettings ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={s.settingsActionBtnText}>💾 SAVE SECRET KEY</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}

            {/* View 4: Trustee Devices Sub-view */}
            {settingsView === 'trustees' && (
              <View>
                <Text style={s.subViewTitle}>👥 Trustee Devices ({companionTrustees.length}/5)</Text>
                <Text style={s.subViewDesc}>
                  Trustee devices receive emergency location alerts and can authenticate account access. At least 1 trustee device is compulsory.
                </Text>

                {/* List of current trustees */}
                <View style={{ gap: 10, marginVertical: 12 }}>
                  {companionTrustees.map((num, idx) => {
                    const isOnlyOne = companionTrustees.length <= 1;
                    return (
                      <View key={idx} style={s.trusteeCard}>
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Text style={s.trusteeCardTitle}>Trustee {idx + 1}</Text>
                            {idx === 0 && (
                              <View style={s.primaryBadge}>
                                <Text style={s.primaryBadgeText}>PRIMARY</Text>
                              </View>
                            )}
                          </View>
                          <Text style={s.trusteeCardNumber}>+91 {num}</Text>
                        </View>

                        <TouchableOpacity
                          style={[s.trusteeDeleteBtn, isOnlyOne && s.trusteeDeleteBtnDisabled]}
                          onPress={() => handleDeleteTrustee(idx)}
                        >
                          <Text style={[s.trusteeDeleteBtnText, isOnlyOne && s.trusteeDeleteBtnTextDisabled]}>
                            🗑️ Delete
                          </Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </View>

                {companionTrustees.length <= 1 && (
                  <View style={s.compulsoryNotice}>
                    <Text style={s.compulsoryNoticeText}>
                      ℹ️ At least 1 trustee device is compulsory. You cannot delete the only trustee device. Add another trustee first if you want to replace it.
                    </Text>
                  </View>
                )}

                {/* Add Trustee Section (if < 5) */}
                {companionTrustees.length < 5 ? (
                  <View style={s.addTrusteeCard}>
                    <Text style={s.addTrusteeTitle}>➕ Add New Trustee ({companionTrustees.length + 1} of 5)</Text>
                    <Text style={[s.textMuted, { fontSize: 11, marginBottom: 10 }]}>
                      Enter the 10-digit mobile number. An SMS OTP will be sent to verify ownership.
                    </Text>

                    <View style={s.verifyInputRow}>
                      <TextInput
                        style={[s.formInput, { flex: 1, marginBottom: 0 }]}
                        placeholder="10-digit mobile number"
                        placeholderTextColor="#666"
                        keyboardType="phone-pad"
                        maxLength={10}
                        value={newTrusteeInput}
                        onChangeText={(t) => setNewTrusteeInput(t.replace(/[^0-9]/g, '').slice(0, 10))}
                        editable={!newTrusteeOtpSent && !trusteeOtpLoading}
                      />
                      {!newTrusteeOtpSent ? (
                        <TouchableOpacity
                          style={s.verifyActionBtn}
                          onPress={handleSendNewTrusteeOtp}
                          disabled={trusteeOtpLoading || newTrusteeInput.length !== 10}
                        >
                          {trusteeOtpLoading ? (
                            <ActivityIndicator size="small" color="#fff" />
                          ) : (
                            <Text style={s.verifyActionBtnText}>SEND OTP</Text>
                          )}
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity
                          style={[s.verifyActionBtn, { backgroundColor: '#334155' }]}
                          onPress={() => {
                            setNewTrusteeOtpSent(false);
                            setNewTrusteeOtp('');
                          }}
                        >
                          <Text style={s.verifyActionBtnText}>CHANGE</Text>
                        </TouchableOpacity>
                      )}
                    </View>

                    {newTrusteeOtpSent && (
                      <View style={[s.inlineOtpRow, { marginTop: 10 }]}>
                        <TextInput
                          style={[s.formInput, { flex: 1, marginBottom: 0, letterSpacing: 4, textAlign: 'center', fontSize: 16 }]}
                          placeholder="6-digit OTP"
                          placeholderTextColor="#666"
                          keyboardType="number-pad"
                          maxLength={6}
                          value={newTrusteeOtp}
                          onChangeText={(t) => setNewTrusteeOtp(t.replace(/[^0-9]/g, '').slice(0, 6))}
                        />
                        <TouchableOpacity
                          style={[s.verifyActionBtn, { backgroundColor: '#16a34a' }]}
                          onPress={handleVerifyNewTrusteeOtp}
                          disabled={trusteeOtpLoading || newTrusteeOtp.length !== 6}
                        >
                          {trusteeOtpLoading ? (
                            <ActivityIndicator size="small" color="#fff" />
                          ) : (
                            <Text style={s.verifyActionBtnText}>VERIFY & ADD</Text>
                          )}
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                ) : (
                  <View style={[s.compulsoryNotice, { backgroundColor: '#1e293b', borderColor: '#334155' }]}>
                    <Text style={[s.compulsoryNoticeText, { color: '#94a3b8' }]}>
                      ✓ Maximum limit of 5 trustee devices reached.
                    </Text>
                  </View>
                )}
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  // ── Main UI ───────────────────────────────────────────────────────────────
  return (
    <ScrollView contentContainerStyle={s.scrollContainer} style={{ backgroundColor: '#000' }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <Text style={[s.title, { marginBottom: 0, textAlign: 'left' }]}>MobTrack Companion</Text>
        <TouchableOpacity
          style={s.settingsHeaderBtn}
          onPress={() => {
            loadLatestSettings();
            setSettingsView('menu');
            setShowSettingsModal(true);
          }}
          accessibilityLabel="Open Settings"
        >
          <Text style={{ fontSize: 24 }}>⚙️</Text>
        </TouchableOpacity>
      </View>


      {/* Main Security Controls Box */}
      <View style={s.box}>
        <View style={s.toggleRow}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={s.toggleLabel}>Live Camera & Video</Text>
            <Text style={{ color: '#888', fontSize: 11, marginTop: 2 }}>
              Remote photo capture and real-time live video streaming
            </Text>
          </View>
          <Switch value={prefCamera} onValueChange={(v) => togglePref('prefCamera', v, setPrefCamera, prefCameraRef)} />
        </View>
        <View style={s.toggleRow}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={s.toggleLabel}>Microphone</Text>
            <Text style={{ color: '#888', fontSize: 11, marginTop: 2 }}>
              Stream live ambient audio in background to web dashboard
            </Text>
          </View>
          <Switch value={prefMic} onValueChange={(v) => togglePref('prefMic', v, setPrefMic, prefMicRef)} />
        </View>
        <View style={s.toggleRow}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={s.toggleLabel}>Location Tracking</Text>
            <Text style={{ color: '#888', fontSize: 11, marginTop: 2 }}>
              Continuous GPS tracking and live device coordinates
            </Text>
          </View>
          <Switch value={prefLocation} onValueChange={(v) => togglePref('prefLocation', v, setPrefLocation, prefLocationRef)} />
        </View>
        <View style={s.toggleRow}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={s.toggleLabel}>Fake Shutdown & Security</Text>
            <Text style={{ color: '#888', fontSize: 11, marginTop: 2 }}>
              Simulates power off while keeping all background tracking active
            </Text>
          </View>
          <Switch value={prefSecurity} onValueChange={(v) => togglePref('prefSecurity', v, setPrefSecurity, prefSecurityRef)} />
        </View>

        <View style={[s.toggleRow, { paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#222' }]}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={s.toggleLabel}>🛡️ Intruder Selfie</Text>
            <Text style={{ color: '#888', fontSize: 11, marginTop: 2 }}>
              Silently captures front camera photo on wrong unlock attempts
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
              <Text style={{ color: '#aaa', fontSize: 13, marginRight: 8 }}>Capture after:</Text>
              <View style={{ flexDirection: 'row', backgroundColor: '#333', borderRadius: 6, overflow: 'hidden' }}>
                {[1, 2, 3].map((num) => (
                  <TouchableOpacity
                    key={num}
                    style={[{ paddingVertical: 4, paddingHorizontal: 8, borderWidth: 1, borderColor: '#444' }, intruderThreshold === num && { backgroundColor: '#2563eb', borderColor: '#2563eb' }]}
                    onPress={async () => {
                      setIntruderThreshold(num);
                      try { await BackgroundCamera.setIntruderConfig(intruderEnabled, num); } catch (e) {}
                    }}
                  >
                    <Text style={[{ color: '#aaa', fontSize: 12, fontWeight: 'bold' }, intruderThreshold === num && { color: '#fff' }]}>
                      {num} fails
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
          <Switch
            value={intruderEnabled}
            onValueChange={handleToggleIntruder}
            trackColor={{ false: '#444', true: '#0066cc' }}
          />
        </View>
        {!isAdminActive && (
          <TouchableOpacity style={[s.adminButton, { marginHorizontal: 15, marginBottom: 10, marginTop: 4 }]} onPress={handleRequestDeviceAdmin}>
            <Text style={s.adminButtonText}>⚡ 1. ACTIVATE DEVICE ADMINISTRATOR</Text>
          </TouchableOpacity>
        )}
        {!isOverlayGranted && (
          <View style={{ marginHorizontal: 15, marginBottom: 14, marginTop: isAdminActive ? 4 : 0 }}>
            <TouchableOpacity style={[s.adminButton, { backgroundColor: '#7c3aed' }]} onPress={() => BackgroundCamera.openOverlaySettings()}>
              <Text style={s.adminButtonText}>⚡ 2. ALLOW DISPLAY OVER OTHER APPS</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={s.toggleRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.toggleLabel}>🔒 Fake Factory Reset</Text>
            <Text style={{ color: '#888', fontSize: 11, marginTop: 2 }}>
              Hold Power + Vol↓ for 3s → shows fake Recovery screen
            </Text>
          </View>
          <Switch
            value={fakeRecoveryEnabled}
            onValueChange={toggleFactoryReset}
            trackColor={{ false: '#333', true: '#cc0000' }}
            thumbColor={fakeRecoveryEnabled ? '#ff4444' : '#888'}
          />
        </View>

        <View style={s.toggleRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.toggleLabel}>🔋 Emergency Battery SMS</Text>
            <Text style={{ color: '#888', fontSize: 11, marginTop: 2 }}>
              Runs LastGasp background service when enabled
            </Text>
          </View>
          <Switch
            value={prefLastGasp}
            onValueChange={toggleLastGasp}
            trackColor={{ false: '#333', true: '#00aaff' }}
            thumbColor={prefLastGasp ? '#0066cc' : '#888'}
          />
        </View>
        <View style={[s.toggleRow, { borderColor: '#1a4a2a', borderWidth: 1 }]}>
          <View style={{ flex: 1 }}>
            <Text style={s.toggleLabel}>🛰 24-Hour Path History</Text>
            <Text style={{ color: '#888', fontSize: 11, marginTop: 2 }}>
              Saves a GPS point about every 10 seconds, online or offline, then syncs automatically.
            </Text>
          </View>
          <Switch value={prefOfflineGps} onValueChange={(v) => togglePref('prefOfflineGps', v, setPrefOfflineGps, prefOfflineGpsRef)} />
        </View>
        <View style={[s.toggleRow, { borderColor: '#1a3a4a', borderWidth: 1 }]}>
          <View style={{ flex: 1 }}>
            <Text style={s.toggleLabel}>🛰 Offline SMS Relay Tracking</Text>
            <Text style={{ color: '#888', fontSize: 11, marginTop: 2 }}>
              Responds to #track 1234 SMS from Relay phone with GPS location &amp; battery when offline.
            </Text>
          </View>
          <Switch
            value={prefOfflineSmsRelay}
            onValueChange={async (v) => {
              if (v) await ensureSmsPermissions();
              await togglePref('prefOfflineSmsRelay', v, setPrefOfflineSmsRelay, prefOfflineSmsRelayRef);
              if (v) {
                try { SmsGateway.setSecurityPin('1234'); } catch (_) {}
              }
            }}
            trackColor={{ false: '#333', true: '#00aaff' }}
            thumbColor={prefOfflineSmsRelay ? '#0066cc' : '#888'}
          />
        </View>
        <View style={s.versionRow}>
          <Text style={s.versionText}>MobTrack v{currentAppVersion.versionName} (Build {currentAppVersion.versionCode})</Text>
          <TouchableOpacity
            style={s.checkUpdateButton}
            onPress={() => checkForUpdates(false)}
            disabled={isCheckingUpdate}
          >
            <Text style={s.checkUpdateButtonText}>
              {isCheckingUpdate ? 'Checking...' : 'Check for Updates'}
            </Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          onPress={() => {
            const id = hardwareDeviceId || ApkUpdater.getDeviceId();
            Alert.alert('Your Hardware Device ID', id ? `${id}\n\n(Share this ID to lock updates to your device only)` : 'Could not retrieve Device ID');
          }}
          style={{ marginTop: 8, padding: 6, backgroundColor: '#181818', borderRadius: 6, borderWidth: 1, borderColor: '#333' }}
        >
          <Text
            selectable={true}
            style={{ color: '#00ff88', fontSize: 11, textAlign: 'center', fontWeight: 'bold' }}
          >
            📱 Device ID: {hardwareDeviceId || ApkUpdater.getDeviceId() || 'Tap to view'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={[s.box, { marginTop: 15 }]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
          <TouchableOpacity style={s.testButton} onPress={handleTestIntruderCapture}>
            <Text style={s.testButtonText}>📸 Test Silent Capture</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.refreshButton} onPress={refreshIntruderStatus}>
            <Text style={s.refreshButtonText}>🔄 Refresh Status</Text>
          </TouchableOpacity>
        </View>

        {intruderPhotos.length > 0 && (
          <View style={s.historySection}>
            <Text style={s.historyTitle}>Recent Intruder Captures ({intruderPhotos.length}):</Text>
            {intruderPhotos.slice(0, 3).map((item, idx) => (
              <View key={idx} style={s.historyItem}>
                <Text style={s.historyTime}>
                  🕒 {new Date(item.timestamp).toLocaleTimeString()} ({new Date(item.timestamp).toLocaleDateString()})
                </Text>
                <Text style={[s.historyStatus, item.status === 'UPLOADED' ? s.statusUploaded : s.statusLocal]}>
                  {item.status === 'UPLOADED' ? '☁️ Uploaded' : '💾 Queued'}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>
      {renderSettingsModal()}
      {renderUpdateModal()}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000', padding: 20 },
  scrollContainer: { padding: 20, paddingTop: 40, paddingBottom: 40, backgroundColor: '#000' },
  title:     { fontSize: 22, fontWeight: 'bold', color: '#fff', marginBottom: 20, textAlign: 'center' },
  text:      { color: '#ccc', marginBottom: 10, textAlign: 'center' },
  success:   { color: '#00ff00', textAlign: 'center', fontWeight: 'bold', marginBottom: 8 },
  status:    { color: '#00aaff', textAlign: 'center', marginTop: 8, fontSize: 14, fontWeight: '600' },
  hint:      { color: '#888', textAlign: 'left', marginTop: 16, fontSize: 12, lineHeight: 20 },
  box:       { width: '100%', backgroundColor: '#111', padding: 20, borderRadius: 12, borderWidth: 1, borderColor: '#333', marginBottom: 20 },
  input:     { backgroundColor: '#222', color: '#fff', padding: 12, borderRadius: 8, marginBottom: 16, borderWidth: 1, borderColor: '#444' },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#1a1a1a', borderRadius: 8 },
  toggleLabel: { color: '#eee', fontSize: 15, fontWeight: '500' },

  // Intruder Card Styles
  intruderCard: { width: '100%', backgroundColor: '#151515', padding: 18, borderRadius: 14, borderWidth: 1, borderColor: '#0055aa', marginBottom: 20 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  cardTitle: { fontSize: 17, fontWeight: 'bold', color: '#38bdf8' },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  badgeSuccess: { backgroundColor: '#065f46' },
  badgeWarning: { backgroundColor: '#92400e' },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  intruderDesc: { color: '#94a3b8', fontSize: 13, marginBottom: 12, lineHeight: 18 },
  adminButton: { backgroundColor: '#2563eb', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8, alignItems: 'center', marginBottom: 14 },
  adminButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, marginBottom: 8 },
  infoLabel: { color: '#94a3b8', fontSize: 13 },
  infoValue: { color: '#f1f5f9', fontSize: 13, fontWeight: '500' },
  thresholdBtn: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: '#222', borderWidth: 1, borderColor: '#444' },
  thresholdBtnActive: { backgroundColor: '#1d4ed8', borderColor: '#60a5fa' },
  thresholdBtnText: { color: '#94a3b8', fontSize: 11, fontWeight: '500' },
  thresholdBtnTextActive: { color: '#fff', fontWeight: 'bold' },
  testButton: { flex: 1, backgroundColor: '#334155', paddingVertical: 8, borderRadius: 6, alignItems: 'center', marginRight: 6 },
  testButtonText: { color: '#e2e8f0', fontSize: 12, fontWeight: '600' },
  refreshButton: { flex: 1, backgroundColor: '#1e293b', paddingVertical: 8, borderRadius: 6, alignItems: 'center', marginLeft: 6, borderWidth: 1, borderColor: '#333' },
  refreshButtonText: { color: '#94a3b8', fontSize: 12, fontWeight: '600' },
  historySection: { marginTop: 14, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#222' },
  historyTitle: { color: '#cbd5e1', fontSize: 12, fontWeight: '600', marginBottom: 6 },
  historyItem: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  historyTime: { color: '#64748b', fontSize: 11 },
  historyStatus: { fontSize: 11, fontWeight: '600' },
  statusUploaded: { color: '#34d399' },
  statusLocal: { color: '#fbbf24' },
  restrictedHelpButton: { backgroundColor: '#1e1b4b', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#6366f1', marginTop: 4 },
  restrictedHelpText: { color: '#c7d2fe', fontSize: 12, textAlign: 'center', lineHeight: 16 },

  // Version and Updater Styles
  versionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 18, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#222' },
  versionText: { color: '#777', fontSize: 12 },
  checkUpdateButton: { paddingVertical: 5, paddingHorizontal: 10, backgroundColor: '#222', borderRadius: 5, borderWidth: 1, borderColor: '#333' },
  checkUpdateButtonText: { color: '#00aaff', fontSize: 12, fontWeight: '600' },

  // OTA Update Modal Styles
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { width: '100%', maxWidth: 360, backgroundColor: '#181818', borderRadius: 14, padding: 22, borderWidth: 1, borderColor: '#333' },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#fff', textAlign: 'center', marginBottom: 6 },
  modalVersion: { fontSize: 13, color: '#00aaff', textAlign: 'center', marginBottom: 14, fontWeight: '600' },
  modalNotesBox: { backgroundColor: '#111', borderRadius: 8, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: '#292929' },
  modalNotesTitle: { color: '#bbb', fontSize: 12, fontWeight: 'bold', marginBottom: 4 },
  modalNotesText: { color: '#eee', fontSize: 13, lineHeight: 18 },
  progressContainer: { width: '100%', marginVertical: 12 },
  progressBarBackground: { width: '100%', height: 8, backgroundColor: '#333', borderRadius: 4, overflow: 'hidden' },
  progressBarFill: { height: '100%', backgroundColor: '#00aaff', borderRadius: 4 },
  progressText: { color: '#aaa', fontSize: 12, marginTop: 6, textAlign: 'center' },
  modalButtonRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10, gap: 10 },
  modalButtonSecondary: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 6, justifyContent: 'center', alignItems: 'center' },
  modalButtonSecondaryText: { color: '#888', fontSize: 14, fontWeight: '600' },
  modalButtonPrimary: { backgroundColor: '#0066cc', paddingVertical: 10, paddingHorizontal: 18, borderRadius: 6, flex: 1, alignItems: 'center', justifyContent: 'center' },
  modalButtonPrimaryText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },

  // ── New Login UI Styles (Matching User Mockup) ───────────────────────────
  picContainer: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  picBox: { width: '100%', maxWidth: 360, alignItems: 'center' },
  picInput: { width: '100%', backgroundColor: '#000', borderWidth: 1, borderColor: '#fff', borderRadius: 4, paddingHorizontal: 16, paddingVertical: 14, color: '#fff', fontSize: 14, marginBottom: 16, textAlign: 'center', fontWeight: '500' },
  picLoginBtn: { width: '100%', backgroundColor: '#111', paddingVertical: 14, borderRadius: 4, alignItems: 'center', marginTop: 2, borderWidth: 1, borderColor: '#444' },
  picLoginBtnText: { color: '#fff', fontSize: 16, fontWeight: '600', letterSpacing: 0.3 },
  picLinkText: { color: '#fff', fontSize: 15, textAlign: 'center', fontWeight: '400', lineHeight: 22 },

  // ── Auth & Registration Styles ───────────────────────────────────────────
  regScroll: { backgroundColor: '#000', padding: 20, paddingTop: 40, paddingBottom: 60 },
  authHeader: { marginBottom: 20 },
  backBtn: { marginBottom: 12, paddingVertical: 4 },
  backBtnText: { color: '#38bdf8', fontSize: 14, fontWeight: '600' },
  regCard: { backgroundColor: '#111', borderRadius: 12, padding: 18, borderWidth: 1, borderColor: '#262626', marginBottom: 20 },
  regSectionTitle: { color: '#38bdf8', fontSize: 16, fontWeight: 'bold', marginBottom: 12 },
  textMuted: { color: '#94a3b8', fontSize: 13, marginBottom: 10, lineHeight: 18 },
  formInput: { backgroundColor: '#1a1a1a', color: '#fff', padding: 12, borderRadius: 8, marginBottom: 14, borderWidth: 1, borderColor: '#333', fontSize: 14 },
  primaryBtn: { backgroundColor: '#2563eb', paddingVertical: 13, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 14, fontWeight: 'bold', letterSpacing: 0.5 },
  tabRow: { flexDirection: 'row', backgroundColor: '#1a1a1a', borderRadius: 8, padding: 4, marginBottom: 14 },
  tabBtn: { flex: 1, paddingVertical: 8, borderRadius: 6, alignItems: 'center' },
  tabBtnActive: { backgroundColor: '#2563eb' },
  tabBtnText: { color: '#94a3b8', fontSize: 13, fontWeight: '500' },
  tabBtnTextActive: { color: '#fff', fontWeight: 'bold' },

  // Verification & Trustee Rows
  verifyInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  verifyActionBtn: { backgroundColor: '#d97706', paddingHorizontal: 14, paddingVertical: 12, borderRadius: 8, justifyContent: 'center', alignItems: 'center', minWidth: 80 },
  verifyActionBtnText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  verifiedBadge: { backgroundColor: '#059669', paddingHorizontal: 14, paddingVertical: 12, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  verifiedBadgeText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  inlineOtpRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  trusteeIndex: { color: '#94a3b8', fontSize: 14, fontWeight: 'bold', width: 20 },

  // IMEI Guide
  imeiGuideCard: { backgroundColor: '#181818', borderRadius: 8, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: '#262626' },
  imeiGuideHeader: { color: '#fff', fontSize: 13, fontWeight: 'bold', textAlign: 'center', marginBottom: 8 },
  imeiRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 6 },
  imeiGuideItem: { flex: 1, alignItems: 'center', backgroundColor: '#222', borderRadius: 6, padding: 6 },
  imeiImage: { width: '100%', height: 65, borderRadius: 4, marginBottom: 4 },
  imeiGuideText: { color: '#cbd5e1', fontSize: 9, textAlign: 'center', lineHeight: 12 },

  // Combo Buttons & Chips
  comboAddBtn: { backgroundColor: '#262626', borderWidth: 1, borderColor: '#444', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  comboAddBtnText: { color: '#e2e8f0', fontSize: 12, fontWeight: 'bold' },
  sequenceBox: { minHeight: 48, backgroundColor: '#181818', borderWidth: 1, borderColor: '#333', borderRadius: 8, padding: 8, justifyContent: 'center' },
  sequenceChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#333', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, gap: 6 },
  sequenceChipText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  sequenceChipRemove: { color: '#f87171', fontSize: 12, fontWeight: 'bold' },

  // Threshold Limit Selector
  thresholdOption: { flex: 1, paddingVertical: 8, borderRadius: 6, backgroundColor: '#222', borderWidth: 1, borderColor: '#333', alignItems: 'center' },
  thresholdOptionActive: { backgroundColor: '#dc2626', borderColor: '#ef4444' },
  thresholdOptionText: { color: '#94a3b8', fontSize: 12, fontWeight: 'bold' },
  thresholdOptionTextActive: { color: '#fff' },

  // Backup Codes Display Card
  backupCodesBox: { width: '100%', backgroundColor: '#181818', borderRadius: 8, padding: 16, borderWidth: 1, borderColor: '#333', gap: 8 },
  backupCodeText: { color: '#facc15', fontSize: 16, fontWeight: 'bold', textAlign: 'center', letterSpacing: 2, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },

  // Settings Modal Styles
  settingsHeaderBtn: {
    backgroundColor: '#181818',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingsOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'flex-end',
  },
  settingsContainer: {
    backgroundColor: '#121212',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
    paddingHorizontal: 20,
    paddingTop: 16,
    borderWidth: 1,
    borderColor: '#262626',
  },
  settingsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#262626',
    marginBottom: 14,
  },
  settingsTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  settingsBackBtn: {
    paddingVertical: 4,
    paddingRight: 10,
  },
  settingsBackBtnText: {
    color: '#38bdf8',
    fontSize: 16,
    fontWeight: '600',
  },
  settingsCloseBtn: {
    padding: 6,
    borderRadius: 16,
    backgroundColor: '#222',
  },
  settingsCloseBtnText: {
    color: '#aaa',
    fontSize: 16,
    fontWeight: 'bold',
    width: 20,
    textAlign: 'center',
  },
  settingsScrollContent: {
    paddingBottom: 40,
  },
  settingsMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#181818',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#262626',
  },
  settingsMenuLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flex: 1,
  },
  settingsMenuIcon: {
    fontSize: 22,
  },
  settingsMenuTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  settingsMenuSub: {
    color: '#888',
    fontSize: 12,
    marginTop: 2,
  },
  settingsMenuArrow: {
    color: '#555',
    fontSize: 22,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  subViewTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  subViewDesc: {
    color: '#94a3b8',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
  },
  settingsActionBtn: {
    backgroundColor: '#2563eb',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsActionBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  trusteeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#181818',
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#262626',
  },
  trusteeCardTitle: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: 'bold',
  },
  trusteeCardNumber: {
    color: '#94a3b8',
    fontSize: 14,
    marginTop: 2,
    fontWeight: '500',
  },
  primaryBadge: {
    backgroundColor: '#065f46',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  primaryBadgeText: {
    color: '#34d399',
    fontSize: 9,
    fontWeight: 'bold',
  },
  trusteeDeleteBtn: {
    backgroundColor: '#7f1d1d',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#991b1b',
  },
  trusteeDeleteBtnDisabled: {
    backgroundColor: '#222',
    borderColor: '#333',
    opacity: 0.5,
  },
  trusteeDeleteBtnText: {
    color: '#fca5a5',
    fontSize: 12,
    fontWeight: 'bold',
  },
  trusteeDeleteBtnTextDisabled: {
    color: '#666',
  },
  compulsoryNotice: {
    backgroundColor: '#1c1917',
    borderWidth: 1,
    borderColor: '#78350f',
    padding: 12,
    borderRadius: 8,
    marginVertical: 10,
  },
  compulsoryNoticeText: {
    color: '#fbbf24',
    fontSize: 12,
    lineHeight: 16,
  },
  addTrusteeCard: {
    backgroundColor: '#161616',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#2e2e2e',
    marginTop: 10,
  },
  addTrusteeTitle: {
    color: '#38bdf8',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 4,
  },
});

