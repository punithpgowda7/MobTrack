'use client';

import { useState, useEffect, useRef, useCallback, Suspense, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import jsPDF from 'jspdf';
import { PATH_GAP_BREAK_MS, orderPathHistory, splitPathSegments, type PathPoint } from './MapView';


// Leaflet must be dynamically imported (no SSR) because it uses browser-only APIs
const MapView = dynamic(() => import('./MapView'), { ssr: false });
const CyberBackground3D = dynamic(() => import('../components/CyberBackground3D'), { ssr: false });
const HoloDevice3D = dynamic(() => import('../components/HoloDevice3D'), { ssr: false });
const HoloGlobe3D = dynamic(() => import('../components/HoloGlobe3D'), { ssr: false });

const formatDuration = (milliseconds: number) => {
  const minutes = Math.round(milliseconds / 60000);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return hours ? `${hours}h ${remainingMinutes}m` : `${remainingMinutes}m`;
};

type DeviceData = {
  id: string;
  mobile_number: string;
  full_name: string;
  trusted_contacts: string[];
  imei1?: string | null;
  imei2?: string | null;
  device_brand?: string | null;
  device_model?: string | null;
  battery_level?: number | null;
  is_charging?: boolean;
  latest_photo_url?: string | null;
  pending_command?: string;
  camera_streaming?: boolean;
  camera_last_error?: string | null;
  location_active?: boolean;
  location_last_error?: string | null;
  last_seen_at?: string | null;
  last_known_location?: {
    latitude?: number;
    longitude?: number;
    accuracy?: number | null;
    timestamp?: number;
  } | null;
};


function getPhotoUrl(filePathOrUrl?: string | null): string {
  if (!filePathOrUrl) return '';
  if (filePathOrUrl.startsWith('http://') || filePathOrUrl.startsWith('https://') || filePathOrUrl.startsWith('data:')) {
    return filePathOrUrl;
  }
  const cleanPath = filePathOrUrl.startsWith('device_media/')
    ? filePathOrUrl.replace('device_media/', '')
    : filePathOrUrl;
  const { data } = supabase.storage.from('device_media').getPublicUrl(cleanPath);
  return data?.publicUrl || '';
}
type AudioBroadcastMessage = {
  payload?: {
    data?: string;
  };
};

type VideoBroadcastMessage = {
  payload?: {
    data?: string;
  };
};

function TrackInner() {
  const [ownerName, setOwnerName] = useState('');
  const [targetMobile, setTargetMobile] = useState('');
  const [authMode, setAuthMode] = useState<'password' | 'backup' | 'trustee'>('password');
  const [password, setPassword] = useState('');
  const [backupCode, setBackupCode] = useState('');
  const [trusteeMobile, setTrusteeMobile] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [tempDeviceData, setTempDeviceData] = useState<DeviceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [deviceData, setDeviceData] = useState<DeviceData | null>(null);
  const [pathHistory, setPathHistory] = useState<PathPoint[]>([]);
  const [pathHistoryOpen, setPathHistoryOpen] = useState(false);
  const [selectedPathPoint, setSelectedPathPoint] = useState<PathPoint | null>(null);
  const [pathSyncNotice, setPathSyncNotice] = useState('');
  const [reportCooldown, setReportCooldown] = useState(0);
  const searchParams = useSearchParams();

  // Auto-restore session when returning from /photos page
  useEffect(() => {
    if (searchParams.get('restore') !== '1') return;
    const savedId = localStorage.getItem('loggedInDeviceId');
    if (!savedId || deviceData) return;
    supabase.from('devices').select('*').eq('id', savedId).single().then(({ data }) => {
      if (data) setDeviceData(data as DeviceData);
    });
  }, [searchParams]);

  // Photo state
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [photoSuccess, setPhotoSuccess] = useState('');
  const photoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [cameraCommandLoading, setCameraCommandLoading] = useState(false);
  const [cameraCommandTarget, setCameraCommandTarget] = useState<boolean | null>(null);
  const expectedCameraStateRef = useRef<boolean | null>(null);
  const cameraCommandTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [locationCommandLoading, setLocationCommandLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);

  // ── Offline Relay Tracking state ──────────────────────────────────────────
  const [offlineRelayModalOpen, setOfflineRelayModalOpen] = useState(false);
  const [relayTargetPhone, setRelayTargetPhone] = useState('');
  const [relayPin, setRelayPin] = useState('1234');
  const [isDispatchingRelay, setIsDispatchingRelay] = useState(false);
  const [relayStatus, setRelayStatus] = useState<{
    type: 'pending' | 'success' | 'error';
    title: string;
    message: string;
  } | null>(null);

  // ── Live video stream state ────────────────────────────────────────────────
  const [isLiveStreaming, setIsLiveStreaming] = useState(false);
  const isLiveStreamingRef = useRef(false);
  const [liveStreamError, setLiveStreamError] = useState('');
  const [liveStreamLoading, setLiveStreamLoading] = useState(false);
  const [frameCount, setFrameCount] = useState(0);
  const liveImgRef = useRef<HTMLImageElement | null>(null);
  const latestLiveFrameRef = useRef<string>('');
  const videoChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const streamTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFrameTimeRef = useRef<number>(0);
  const frameCounterRef = useRef<number>(0);
  const fpsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [liveFps, setLiveFps] = useState(0);
  const [zuluTime, setZuluTime] = useState('');
  const deviceDataRef = useRef<DeviceData | null>(null);
  deviceDataRef.current = deviceData;

  useEffect(() => {
    const updateZulu = () => {
      const now = new Date();
      setZuluTime(now.toTimeString().slice(0, 8) + ' UTC');
    };
    updateZulu();
    const interval = setInterval(updateZulu, 1000);
    return () => clearInterval(interval);
  }, []);

  // Mic state
  const [isMicActive, setIsMicActive] = useState(false);
  const [micError, setMicError] = useState('');
  const [micLevel, setMicLevel] = useState(0);
  const audioCtxRef       = useRef<AudioContext | null>(null);
  const nextPlayTimeRef   = useRef<number>(0);
  const micChannelRef     = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastChunkTimeRef  = useRef<number>(0);
  const micTimeoutRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const analyserRef       = useRef<AnalyserNode | null>(null);
  const animFrameRef      = useRef<number>(0);

  // ── Audio playback helpers ─────────────────────────────────────────────────
  const playPcmChunk = useCallback((base64: string) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    try {
      const bin  = atob(base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

      const int16  = new Int16Array(bytes.buffer);
      const f32    = new Float32Array(int16.length);
      let peak = 0;
      for (let i = 0; i < int16.length; i++) {
        f32[i] = int16[i] / 32768.0;
        if (Math.abs(f32[i]) > peak) peak = Math.abs(f32[i]);
      }

      const audioBuf = ctx.createBuffer(1, f32.length, 16000);
      audioBuf.getChannelData(0).set(f32);

      const source = ctx.createBufferSource();
      source.buffer = audioBuf;
      if (analyserRef.current) {
        source.connect(analyserRef.current);
        analyserRef.current.connect(ctx.destination);
      } else {
        source.connect(ctx.destination);
      }

      const now  = ctx.currentTime;
      const when = Math.max(now + 0.04, nextPlayTimeRef.current);
      source.start(when);
      nextPlayTimeRef.current = when + audioBuf.duration;

      setMicLevel(Math.min(peak * 1.4, 1));
    } catch (err) {
      console.warn('Audio decode error:', err);
    }
  }, []);

  // ── Live stream helpers ────────────────────────────────────────────────────
  const cleanupLiveStream = useCallback(() => {
    isLiveStreamingRef.current = false;
    if (streamTimeoutRef.current) { clearTimeout(streamTimeoutRef.current); streamTimeoutRef.current = null; }
    if (fpsIntervalRef.current) { clearInterval(fpsIntervalRef.current); fpsIntervalRef.current = null; }
    if (videoChannelRef.current) {
      const ch = videoChannelRef.current;
      videoChannelRef.current = null;
      try {
        ch.unsubscribe();
        supabase.removeChannel(ch);
      } catch (err) {
        console.warn('Error removing video channel:', err);
      }
    }
    if (liveImgRef.current) {
      liveImgRef.current.src = '';
    }
    setIsLiveStreaming(false);
    setLiveStreamLoading(false);
    setCameraCommandLoading(false);
    setCameraCommandTarget(null);
    expectedCameraStateRef.current = null;
    setLiveFps(0);
    frameCounterRef.current = 0;
  }, []);

  const startLiveStream = useCallback(async () => {
    if (!deviceData) return;

    const confirmed = window.confirm(
      'Start a LIVE CAMERA STREAM from the phone? The phone owner will see Android camera indicators and a persistent MobTrack notification. The live video will appear on this dashboard in real time.',
    );
    if (!confirmed) return;

    cleanupLiveStream();

    setLiveStreamError('');
    setLiveStreamLoading(true);
    setFrameCount(0);
    frameCounterRef.current = 0;
    isLiveStreamingRef.current = true;

    // Subscribe to the video broadcast channel BEFORE sending the command
    const channelName = `video-stream-${deviceData.mobile_number}`;
    const ch = supabase.channel(channelName);
    videoChannelRef.current = ch;

    ch.on('broadcast', { event: 'video-frame' }, (msg: VideoBroadcastMessage) => {
      // Discard any incoming frame if streaming was stopped
      if (!isLiveStreamingRef.current) return;

      const b64 = msg.payload?.data;
      if (!b64) return;

      latestLiveFrameRef.current = b64;
      lastFrameTimeRef.current = Date.now();
      frameCounterRef.current += 1;

      // Update the live image in the DOM without React re-render overhead
      if (liveImgRef.current) {
        liveImgRef.current.src = `data:image/jpeg;base64,${b64}`;
      }

      // Mark as streaming on first frame and unlock any command loading state
      setIsLiveStreaming(true);
      setLiveStreamLoading(false);
      setCameraCommandLoading(false);
      setCameraCommandTarget(null);
      expectedCameraStateRef.current = null;

      // Reset the dead-stream timeout on each incoming frame
      if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current);
      streamTimeoutRef.current = setTimeout(() => {
        setLiveStreamError('⚠️ No video received — device may be offline or out of range.');
        cleanupLiveStream();
      }, 8000);
    }).subscribe();

    // Track FPS every second
    fpsIntervalRef.current = setInterval(() => {
      if (!isLiveStreamingRef.current) return;
      setLiveFps(frameCounterRef.current);
      setFrameCount(prev => prev + frameCounterRef.current);
      frameCounterRef.current = 0;
    }, 1000);

    // Send command to phone
    expectedCameraStateRef.current = true;
    setCameraCommandTarget(true);
    setCameraCommandLoading(true);
    const { error } = await supabase.from('devices').update({
      pending_command: 'start_video_stream',
      camera_last_error: null,
    }).eq('id', deviceData.id);

    if (error) {
      setLiveStreamError(`Failed to send stream command: ${error.message}`);
      cleanupLiveStream();
      setCameraCommandLoading(false);
      setCameraCommandTarget(null);
      expectedCameraStateRef.current = null;
      return;
    }

    setDeviceData(current => current ? { ...current, pending_command: 'start_video_stream' } : null);

    // Fail-safe: if no frame received within 15 seconds, give up
    streamTimeoutRef.current = setTimeout(() => {
      setLiveStreamError('⚠️ Device did not start streaming — is the MobTrack app open and running?');
      cleanupLiveStream();
      setCameraCommandLoading(false);
      setCameraCommandTarget(null);
      expectedCameraStateRef.current = null;
    }, 15000);
  }, [deviceData, cleanupLiveStream]);

  const stopLiveStream = useCallback(async () => {
    const currentDevice = deviceDataRef.current || deviceData;
    if (!currentDevice) return;

    // 1. Immediately terminate stream in state and refs so all incoming frames are dropped
    isLiveStreamingRef.current = false;
    setIsLiveStreaming(false);
    setLiveStreamLoading(false);
    setCameraCommandLoading(false);
    setCameraCommandTarget(null);
    expectedCameraStateRef.current = null;
    setLiveFps(0);

    // 2. Clean up timers, unsubscribe channel, and clear live image DOM immediately
    cleanupLiveStream();

    // 3. Immediately send stop command to database for the phone
    try {
      await supabase.from('devices').update({
        pending_command: 'stop_video_stream',
        camera_streaming: false,
      }).eq('id', currentDevice.id);
    } catch (err) {
      console.error('Failed to update stop_video_stream in db:', err);
    }

    setDeviceData(current => current ? { ...current, camera_streaming: false, pending_command: 'stop_video_stream' } : null);
  }, [deviceData, cleanupLiveStream]);

  // ── Mic toggle ─────────────────────────────────────────────────────────────
  const toggleMic = async () => {
    if (!deviceData) return;

    if (!isMicActive) {
      const confirmed = window.confirm(
        'Start a microphone session on the phone? Only continue if the phone owner has enabled the visible MobTrack remote session.',
      );
      if (!confirmed) return;

      setMicError('');
      setIsMicActive(true);

      try {
        const ctx = new AudioContext({ sampleRate: 16000 });
        await ctx.resume();
        audioCtxRef.current = ctx;
        nextPlayTimeRef.current = ctx.currentTime;

        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyserRef.current = analyser;
      } catch {
        setMicError('⚠️ Audio playback blocked by browser. Click the page first.');
        setIsMicActive(false);
        return;
      }

      const channelName = `audio-stream-${deviceData.mobile_number}`;
      const ch = supabase.channel(channelName);
      micChannelRef.current = ch;

      ch.on('broadcast', { event: 'audio-chunk' }, (msg: AudioBroadcastMessage) => {
        const b64 = msg.payload?.data;
        if (!b64) return;

        lastChunkTimeRef.current = Date.now();
        playPcmChunk(b64);

        if (micTimeoutRef.current) clearTimeout(micTimeoutRef.current);
        micTimeoutRef.current = setTimeout(() => {
          setMicError('⚠️ No audio received — device may be offline.');
          setIsMicActive(false);
          setMicLevel(0);
        }, 8000);
      }).subscribe();

      await supabase
        .from('devices')
        .update({ pending_command: 'start_mic' })
        .eq('id', deviceData.id);

      micTimeoutRef.current = setTimeout(() => {
        setMicError('⚠️ Device did not respond — is the app running?');
        setIsMicActive(false);
        setMicLevel(0);
        cleanupMic();
      }, 12000);

    } else {
      await supabase
        .from('devices')
        .update({ pending_command: 'stop_mic' })
        .eq('id', deviceData.id);

      cleanupMic();
    }
  };

  const cleanupMic = () => {
    if (micTimeoutRef.current) { clearTimeout(micTimeoutRef.current); micTimeoutRef.current = null; }
    cancelAnimationFrame(animFrameRef.current);

    if (micChannelRef.current) {
      supabase.removeChannel(micChannelRef.current);
      micChannelRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    setIsMicActive(false);
    setMicLevel(0);
  };

  // Clean up when navigating away / closing session
  useEffect(() => {
    return () => {
      cleanupMic();
      cleanupLiveStream();
      if (cameraCommandTimeoutRef.current) clearTimeout(cameraCommandTimeoutRef.current);
    };
  }, []);

  const loadPathHistory = useCallback(async (deviceId: string, announceSync = false) => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    let storedResetAt = 0;
    if (typeof window !== 'undefined') {
      const resetKey = `mobtrack_path_reset_${deviceId}`;
      // localStorage survives logout, reloads, and tab navigation. Migrate an
      // older tab-scoped reset boundary once so it is not lost for this device.
      const persisted = localStorage.getItem(resetKey);
      const legacy = sessionStorage.getItem(resetKey);
      storedResetAt = Number(persisted || legacy || 0);
      if (!persisted && legacy) localStorage.setItem(resetKey, legacy);
    }
    const queryStart = Math.max(start.getTime(), Number.isFinite(storedResetAt) ? storedResetAt : 0);
    const { data, error } = await supabase.from('offline_gps_history')
      .select('device_id,latitude,longitude,timestamp')
      .eq('device_id', deviceId)
      .gte('timestamp', queryStart)
      .lt('timestamp', end.getTime())
      .order('timestamp', { ascending: true });
    if (!error && data) {
      const baseLat = Math.floor(Math.abs(deviceDataRef.current?.last_known_location?.latitude || 12)) * (deviceDataRef.current?.last_known_location?.latitude && deviceDataRef.current.last_known_location.latitude < 0 ? -1 : 1);
      const baseLng = Math.floor(Math.abs(deviceDataRef.current?.last_known_location?.longitude || 77)) * (deviceDataRef.current?.last_known_location?.longitude && deviceDataRef.current.last_known_location.longitude < 0 ? -1 : 1);

      const sanitizedPoints = (data as PathPoint[]).map(pt => {
        let lat = pt.latitude;
        let lng = pt.longitude;
        if (Math.abs(lat) < 1) lat = (baseLat >= 0 ? 1 : -1) * (Math.abs(baseLat) + Math.abs(lat));
        if (Math.abs(lng) < 1) lng = (baseLng >= 0 ? 1 : -1) * (Math.abs(baseLng) + Math.abs(lng));
        return { ...pt, latitude: parseFloat(lat.toFixed(5)), longitude: parseFloat(lng.toFixed(5)) };
      });
      const next = orderPathHistory(sanitizedPoints);
      if (announceSync && next.length > pathHistory.length) {
        setPathSyncNotice(`✓ PATH HISTORY SYNCHRONIZED · ${next.length - pathHistory.length} location${next.length - pathHistory.length === 1 ? '' : 's'} added`);
      }
      setPathHistory(next);
    }
  }, [pathHistory.length]);

  const lastPathRelayFetchRef = useRef<number>(0);

  const fetchOfflinePathViaSms = useCallback(async (dev: DeviceData) => {
    const now = Date.now();
    if (now - lastPathRelayFetchRef.current < 60000) return;
    const phone = (dev.mobile_number || '').trim();
    if (!phone) return;

    lastPathRelayFetchRef.current = now;
    const cleanDigits = phone.replace(/\D/g, '');
    const cleanPhone = cleanDigits.length === 10 ? '+91' + cleanDigits : (phone.startsWith('+') ? phone : '+' + cleanDigits);

    setPathSyncNotice('📡 Requesting latest coordinates via SMS Relay...');

    try {
      const { data, error } = await supabase.from('sms_requests').insert({
        target_device_id: dev.id,
        target_phone_number: cleanPhone,
        pin: '1234',
        status: 'pending',
      }).select().single();

      if (error) {
        console.warn('Path SMS relay error:', error.message);
        return;
      }

      const reqId = data.id;
      const reqChannel = supabase
        .channel(`req_path_${reqId}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'sms_requests', filter: `id=eq.${reqId}` },
          (payload) => {
            const updated = payload.new;
            if (updated.status === 'completed') {
              loadPathHistory(dev.id, true);
              setPathSyncNotice('✓ 3 Waypoints received & synchronized via SMS Relay!');
              try { supabase.removeChannel(reqChannel); } catch (_) {}
            } else if (updated.status === 'failed') {
              setPathSyncNotice('⚠️ SMS Relay could not reach device.');
              try { supabase.removeChannel(reqChannel); } catch (_) {}
            }
          }
        )
        .subscribe();

      setTimeout(() => {
        try { supabase.removeChannel(reqChannel); } catch (_) {}
      }, 45000);
    } catch (e: any) {
      console.warn('Error queuing path SMS relay:', e);
    }
  }, [loadPathHistory]);

  // Keep one canonical chronological sequence for the map, timeline and PDF.
  const orderedPathHistory = useMemo(
    () => orderPathHistory(pathHistory),
    [pathHistory],
  );

  // In-session data refresh: fetches latest device info (battery, location, network, status) without reloading page
  const refreshDeviceData = async () => {
    if (!deviceData?.id || isRefreshing) return;
    setIsRefreshing(true);
    try {
      const [deviceRes] = await Promise.all([
        supabase.from('devices').select('*').eq('id', deviceData.id).single(),
        loadPathHistory(deviceData.id),
      ]);
      if (deviceRes.data) {
        setDeviceData(deviceRes.data as DeviceData);
        setLastRefreshedAt(new Date());
      }
    } catch (err) {
      console.error('Failed to refresh device data:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  // ── Supabase DB realtime (device updates) ───────────────────────────────────
  useEffect(() => {
    if (!deviceData) return;

    loadPathHistory(deviceData.id);

    const channel = supabase
      .channel('device-updates')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'devices',
        filter: `id=eq.${deviceData.id}`,
      }, (payload) => {
        const nextDeviceData = payload.new as Partial<DeviceData>;
        if (nextDeviceData.location_last_error) {
          nextDeviceData.location_active = false;
        }
        setDeviceData((current) => current ? { ...current, ...nextDeviceData } : null);

        const expectedCameraState = expectedCameraStateRef.current;
        if (expectedCameraState !== null && payload.new.pending_command === 'none') {
          expectedCameraStateRef.current = null;
          setCameraCommandLoading(false);
          setCameraCommandTarget(null);
          if (cameraCommandTimeoutRef.current) {
            clearTimeout(cameraCommandTimeoutRef.current);
            cameraCommandTimeoutRef.current = null;
          }
        }

        if (
          payload.new.pending_command === 'none' &&
          payload.new.latest_photo_url !== deviceDataRef.current?.latest_photo_url
        ) {
          setPhotoLoading(false);
          setPhotoError('');
          if (photoTimeoutRef.current) { clearTimeout(photoTimeoutRef.current); photoTimeoutRef.current = null; }
        }
        if (
          payload.new.pending_command === 'none' &&
          payload.new.latest_photo_url === deviceDataRef.current?.latest_photo_url &&
          photoLoading &&
          payload.new.camera_last_error
        ) {
          setPhotoLoading(false);
          setPhotoError(`⚠️ ${payload.new.camera_last_error}`);
          if (photoTimeoutRef.current) { clearTimeout(photoTimeoutRef.current); photoTimeoutRef.current = null; }
        }

        // If the phone confirms camera_streaming turned off (e.g. phone stopped it), cleanup our stream state
        if (!payload.new.camera_streaming && isLiveStreamingRef.current) {
          cleanupLiveStream();
        }
      })
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'offline_gps_history',
        filter: `device_id=eq.${deviceData.id}`,
      }, () => { loadPathHistory(deviceData.id, true); })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [deviceData?.id, cleanupLiveStream, loadPathHistory]);

  // If phone reports location error (e.g. location off), ensure location_active is false
  useEffect(() => {
    if (deviceData?.id && deviceData.location_last_error && deviceData.location_active) {
      setDeviceData((prev) => (prev ? { ...prev, location_active: false } : prev));
    }
  }, [deviceData?.id, deviceData?.location_active, deviceData?.location_last_error]);

  // ── Photo request ─────────────────────────────────────────────────────────
  const requestPhoto = async () => {
    const currentDevice = deviceData;
    if (!currentDevice) return;

    // 1. If live video stream is running, snap the exact current frame instantly!
    if (isLiveStreaming) {
      const b64 = latestLiveFrameRef.current || (liveImgRef.current?.src?.startsWith('data:image/jpeg;base64,')
        ? liveImgRef.current.src.replace('data:image/jpeg;base64,', '')
        : '');

      if (!b64) {
        setPhotoError('No video frame received yet to snap. Please wait a moment.');
        return;
      }

      setPhotoLoading(true);
      setPhotoError('');
      setPhotoSuccess('');

      try {
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
        const fileName = `on_demand_${ts}.jpg`;
        const filePath = `${currentDevice.id}/${fileName}`;
        const capturedAt = now.toISOString();

        // Convert base64 to binary bytes for Supabase Storage
        const cleanB64 = b64.replace(/^data:image\/[a-z]+;base64,/, '');
        const binaryStr = atob(cleanB64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }

        const { error: uploadErr } = await supabase.storage
          .from('device_media')
          .upload(filePath, bytes, { contentType: 'image/jpeg', upsert: true });

        if (uploadErr) {
          throw new Error(`Upload failed: ${uploadErr.message}`);
        }

        // Insert metadata into photo_captures table for photo gallery
        await supabase.from('photo_captures').insert({
          device_id: currentDevice.id,
          file_path: filePath,
          type: 'on_demand',
          captured_at: capturedAt,
        });

        // Update latest_photo_url on device
        await supabase.from('devices').update({
          latest_photo_url: filePath,
        }).eq('id', currentDevice.id);

        setDeviceData((prev) => prev ? { ...prev, latest_photo_url: filePath } : null);
        setPhotoSuccess('✓ Snapped live photo & saved to Photo Gallery!');
        setTimeout(() => setPhotoSuccess(''), 5000);
      } catch (err: any) {
        setPhotoError(err?.message || 'Failed to save snapshot from live camera');
      } finally {
        setPhotoLoading(false);
      }
      return;
    }

    // 2. Fallback when live stream is off: send hardware capture command to phone
    const confirmed = window.confirm(
      'Take a photo with your phone now?',
    );
    if (!confirmed) return;

    if (!currentDevice.camera_streaming) {
      setPhotoError('Turn on the camera first, then take a photo.');
      return;
    }

    setPhotoLoading(true);
    setPhotoError('');
    if (photoTimeoutRef.current) clearTimeout(photoTimeoutRef.current);

    await supabase
      .from('devices')
      .update({ pending_command: 'take_photo' })
      .eq('id', currentDevice.id);

    photoTimeoutRef.current = setTimeout(() => {
      setPhotoLoading(false);
      setPhotoError('⚠️ Phone did not respond — please check if the phone is on.');
      photoTimeoutRef.current = null;
    }, 30000);
  };

  const dispatchOfflineRelayRequest = async () => {
    if (!deviceData) return;
    const phone = (relayTargetPhone || deviceData.mobile_number || '').trim();
    if (!phone) {
      setRelayStatus({ type: 'error', title: 'Need Phone Number', message: 'Please enter a phone number.' });
      return;
    }
    const cleanDigits = phone.replace(/\D/g, '');
    const cleanPhone = cleanDigits.length === 10 ? '+91' + cleanDigits : (phone.startsWith('+') ? phone : '+' + cleanDigits);
    const pin = (relayPin || '1234').trim();

    setIsDispatchingRelay(true);
    setRelayStatus({
      type: 'pending',
      title: 'Step 1: Preparing',
      message: `Sending SMS request to helper phone for ${cleanPhone}...`
    });

    try {
      const { data, error } = await supabase.from('sms_requests').insert({
        target_device_id: deviceData.id,
        target_phone_number: cleanPhone,
        pin: pin,
        status: 'pending',
      }).select().single();

      if (error) {
        setRelayStatus({ type: 'error', title: 'Could Not Send', message: error.message });
        setIsDispatchingRelay(false);
        return;
      }

      setRelayStatus({
        type: 'pending',
        title: 'Step 2: Helper Phone Notified',
        message: 'Helper phone received request. Sending text message to lost phone...'
      });

      const reqId = data.id;
      const reqChannel = supabase
        .channel(`req_track_${reqId}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'sms_requests', filter: `id=eq.${reqId}` },
          (payload) => {
            const updated = payload.new;
            if (updated.status === 'sent') {
              setRelayStatus({
                type: 'pending',
                title: 'Step 3: Text Message Sent',
                message: `Text message sent to lost phone. Waiting for location and battery reply...`
              });
            } else if (updated.status === 'completed') {
              setRelayStatus({
                type: 'success',
                title: 'Step 4: Location and Battery Found!',
                message: 'Phone replied! New location and battery updated.'
              });
              setIsDispatchingRelay(false);
              refreshDeviceData();
              loadPathHistory(deviceData.id, true);
              setTimeout(() => {
                setOfflineRelayModalOpen(false);
                setRelayStatus(null);
              }, 3000);
            } else if (updated.status === 'failed') {
              setRelayStatus({
                type: 'error',
                title: 'SMS Failed',
                message: 'Could not send text message. Please check helper phone SIM and signal.'
              });
              setIsDispatchingRelay(false);
            }
          }
        )
        .subscribe();

      setTimeout(() => {
        setIsDispatchingRelay(false);
      }, 45000);
    } catch (err: any) {
      setRelayStatus({ type: 'error', title: 'Could Not Send', message: err?.message || 'Error creating tracking request.' });
      setIsDispatchingRelay(false);
    }
  };

  const toggleLocation = async () => {
    if (!deviceData || locationCommandLoading) return;
    const isCurrentlyActive = Boolean(deviceData.location_active && !deviceData.location_last_error);
    const nextActive = !isCurrentlyActive;
    const confirmed = window.confirm(
      nextActive
        ? 'Turn on live location for this phone?'
        : 'Stop live location for this phone?',
    );
    if (!confirmed) return;

    setLocationCommandLoading(true);

    try {
      const updatePayload: any = {
        pending_command: nextActive ? 'start_location' : 'stop_location',
      };
      if (!nextActive) {
        updatePayload.location_active = false;
        updatePayload.location_last_error = null;
        setDeviceData((prev) => (prev ? { ...prev, location_active: false, location_last_error: null } : null));
      } else {
        updatePayload.location_last_error = null;
        setDeviceData((prev) => (prev ? { ...prev, location_last_error: null } : null));
      }

      const { error } = await supabase
        .from('devices')
        .update(updatePayload)
        .eq('id', deviceData.id);

      if (error) {
        setPhotoError(`Location error: ${error.message}`);
      }
    } catch (err: any) {
      setPhotoError(`Location error: ${err?.message || 'Network error'}`);
    } finally {
      setTimeout(() => setLocationCommandLoading(false), 2500);
    }
  };

  // ── Login logic ───────────────────────────────────────────────────────────
  const handlePasswordAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (targetMobile.trim().length !== 10) { setErrorMsg('Target mobile must be 10 digits.'); return; }
    if (!password) { setErrorMsg('Please enter your account password.'); return; }
    setLoading(true); setErrorMsg('');
    
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobile_number: targetMobile.trim(), password })
      });
      const result = await res.json();
      
      if (!res.ok) {
        setLoading(false);
        setErrorMsg(`Access Denied: ${result.error || 'Unknown error'}`);
        return;
      }

      localStorage.setItem('loggedInDeviceId', result.deviceId);
      
      const { data, error } = await supabase
        .from('devices')
        .select('*')
        .eq('id', result.deviceId)
        .single();
        
      setLoading(false);
      if (error || !data) {
        setErrorMsg('Failed to load device profile.');
        return;
      }
      setDeviceData(data);
    } catch (err: any) {
      setLoading(false);
      setErrorMsg('Network error while logging in.');
    }
  };

  const handleBackupAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (targetMobile.length !== 10) { setErrorMsg('Target mobile must be 10 digits.'); return; }
    setLoading(true); setErrorMsg('');
    
    try {
      const res = await fetch('/api/auth/backup-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobile_number: targetMobile, ownerName, backupCode })
      });
      const result = await res.json();
      
      if (!res.ok) {
        setLoading(false);
        setErrorMsg(result.error || 'Access Denied: Invalid Name, Mobile Number, or Backup Code.');
        return;
      }
      
      localStorage.setItem('loggedInDeviceId', result.deviceId);
      
      const { data, error } = await supabase
        .from('devices')
        .select('*')
        .eq('id', result.deviceId)
        .single();
        
      setLoading(false);
      if (error || !data) {
        setErrorMsg('Failed to load device profile.');
        return;
      }
      setDeviceData(data);
    } catch (err: any) {
      setLoading(false);
      setErrorMsg('Could not log in. Check your internet connection.');
    }
  };

  const handleTrusteeRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (targetMobile.length !== 10 || trusteeMobile.length !== 10) { setErrorMsg('Phone numbers must be 10 digits.'); return; }
    setLoading(true); setErrorMsg('');
    const { data, error } = await supabase
      .from('devices').select('*')
      .eq('mobile_number', targetMobile)
      .ilike('full_name', ownerName)
      .single();
    if (error || !data) { setLoading(false); setErrorMsg('Phone not found. Please check your details.'); return; }
    if (!data.trusted_contacts.includes(trusteeMobile)) { setLoading(false); setErrorMsg('This helper phone number is not listed.'); return; }
    const { error: sendErr } = await supabase.auth.signInWithOtp({ phone: '+91' + trusteeMobile });
    setLoading(false);
    if (sendErr) setErrorMsg(`Could not send code: ${sendErr.message}`);
    else { setTempDeviceData(data); setOtpSent(true); setErrorMsg(''); }
  };

  const handleTrusteeOTPConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otpInput.length !== 6) { setErrorMsg('Code must be 6 digits.'); return; }
    if (!tempDeviceData?.id) { setErrorMsg('Something went wrong. Please try again.'); return; }
    setLoading(true); setErrorMsg('');
    
    try {
      const res = await fetch('/api/auth/otp-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trusteeMobile, otpInput, deviceId: tempDeviceData.id })
      });
      const result = await res.json();
      
      setLoading(false);
      if (!res.ok) {
        setErrorMsg(result.error || 'Wrong code. Try again.');
        return;
      }
      
      localStorage.setItem('loggedInDeviceId', tempDeviceData.id);
      setDeviceData(tempDeviceData);
    } catch (err: any) {
      setLoading(false);
      setErrorMsg('Network error while verifying OTP.');
    }
  };

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (reportCooldown > 0) {
      timer = setInterval(() => {
        setReportCooldown(c => c - 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [reportCooldown]);

  const generateReport = () => {
    if (!deviceData || reportCooldown > 0) return;

    const doc = new jsPDF();
    
    // Title
    doc.setFontSize(22);
    doc.setTextColor(220, 38, 38);
    doc.text('MOBTRACK POLICE REPORT', 105, 20, { align: 'center' });
    
    doc.setFontSize(12);
    doc.setTextColor(0, 0, 0);

    doc.text(`Device Owner: ${deviceData.full_name}`, 20, 40);
    doc.text(`Mobile Number: ${deviceData.mobile_number}`, 20, 50);
    doc.text(`Device Model: ${deviceData.device_model || 'Unknown'}`, 20, 60);
    doc.text(`IMEI 1: ${deviceData.imei1 || 'N/A'}`, 20, 70);
    doc.text(`IMEI 2: ${deviceData.imei2 || 'N/A'}`, 20, 80);
    
    const batText = deviceData.battery_level != null ? `${deviceData.battery_level}%` : 'Unknown';
    const chargeText = deviceData.is_charging ? '(Charging)' : '';
    doc.text(`Last Seen Battery: ${batText} ${chargeText}`, 20, 90);
    
    const lastSeen = deviceData.last_seen_at ? new Date(deviceData.last_seen_at).toLocaleString() : 'Unknown';
    doc.text(`Last Seen Online: ${lastSeen}`, 20, 100);
    
    if (deviceData.last_known_location?.latitude && deviceData.last_known_location?.longitude) {
      const lat = deviceData.last_known_location.latitude;
      const lng = deviceData.last_known_location.longitude;
      doc.text(`Location Coordinates: ${lat.toFixed(6)}, ${lng.toFixed(6)}`, 20, 110);
      
      const gmapsLink = `https://www.google.com/maps?q=${lat},${lng}`;
      doc.setTextColor(37, 99, 235);
      doc.textWithLink('View on Google Maps', 20, 120, { url: gmapsLink });
      doc.setTextColor(0, 0, 0);
    } else {
      doc.text(`Location Coordinates: Not Shared`, 20, 110);
    }

    // ── Steps to follow for lost / offline device ──
    doc.setDrawColor(200, 200, 200);
    doc.line(20, 135, 190, 135);

    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(220, 38, 38);
    doc.text('STEPS TO FOLLOW TO FIND YOUR LOST / OFFLINE DEVICE:', 20, 147);

    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text('1) CALL 112 AND REPORT TO POLICE', 20, 158);

    doc.setFont('helvetica', 'bold');
    doc.text('2) Visit the station:', 20, 169);
    doc.setFont('helvetica', 'normal');
    const step2Text = 'Go to the nearest police station where you lost the phone. Explain when and where you lost it. Give them your phone details (Present in this PDF) and an alternate contact number.';
    const splitStep2 = doc.splitTextToSize(step2Text, 170);
    doc.text(splitStep2, 20, 176);

    doc.setFont('helvetica', 'bold');
    doc.text('3) Get the acknowledgement:', 20, 194);
    doc.setFont('helvetica', 'normal');
    const step3Text = 'Ask the officer for a stamped copy of the FIR or a Lost Note / NCR (Non-Cognizable Report).';
    const splitStep3 = doc.splitTextToSize(step3Text, 170);
    doc.text(splitStep3, 20, 201);

    // ── Footer ──
    doc.setDrawColor(220, 220, 220);
    doc.line(20, 265, 190, 265);
    doc.setTextColor(130, 130, 130);
    doc.setFontSize(9);
    doc.text(`Generated at: ${new Date().toLocaleString()}`, 20, 274);
    doc.text('Confidential Emergency Document • MobTrack Device Protection', 20, 281);

    doc.save(`MobTrack_Report_${deviceData.mobile_number}.pdf`);
    setReportCooldown(10);
  };

  const generatePathReport = () => {
    if (!deviceData || orderedPathHistory.length === 0) return;
    const doc = new jsPDF();
    const dateLabel = new Date(orderedPathHistory[0].timestamp).toLocaleDateString();
    doc.setFillColor(15, 23, 42); doc.rect(0, 0, 210, 34, 'F');
    doc.setTextColor(56, 189, 248); doc.setFontSize(20); doc.setFont('helvetica', 'bold');
    doc.text('MOBTRACK', 18, 15); doc.setFontSize(11); doc.setTextColor(226, 232, 240);
    doc.text('24-HOUR PATH HISTORY REPORT', 18, 25);
    doc.setTextColor(25, 25, 25); doc.setFontSize(10); doc.setFont('helvetica', 'normal');
    doc.text(`Device: ${deviceData.device_brand || ''} ${deviceData.device_model || 'Unknown'} · ${deviceData.mobile_number}`, 18, 47);
    doc.text(`Date: ${dateLabel}`, 18, 55); doc.text(`Recorded locations: ${orderedPathHistory.length}`, 18, 63);
    doc.text(`First: ${new Date(orderedPathHistory[0].timestamp).toLocaleString()}`, 18, 71);
    doc.text(`Latest: ${new Date(orderedPathHistory[orderedPathHistory.length - 1].timestamp).toLocaleString()}`, 18, 79);
    doc.setDrawColor(148, 163, 184); doc.rect(18, 88, 174, 72);
    const minLat = Math.min(...orderedPathHistory.map(p => p.latitude)); const maxLat = Math.max(...orderedPathHistory.map(p => p.latitude));
    const minLng = Math.min(...orderedPathHistory.map(p => p.longitude)); const maxLng = Math.max(...orderedPathHistory.map(p => p.longitude));
    const latSpan = Math.max(maxLat - minLat, 0.00001); const lngSpan = Math.max(maxLng - minLng, 0.00001);
    const project = (p: PathPoint): [number, number] => [28 + ((p.longitude - minLng) / lngSpan) * 154, 153 - ((p.latitude - minLat) / latSpan) * 58];
    doc.setDrawColor(14, 165, 233); doc.setLineWidth(1.6);
    splitPathSegments(orderedPathHistory).forEach((segment) => segment.slice(1).forEach((point, i) => { const a = project(segment[i]); const b = project(point); doc.line(a[0], a[1], b[0], b[1]); }));
    orderedPathHistory.forEach((point, i) => { const [x, y] = project(point); const isLatest = i === orderedPathHistory.length - 1; doc.setFillColor(isLatest ? 234 : 14, isLatest ? 179 : 165, isLatest ? 8 : 233); doc.circle(x, y, isLatest ? 2.5 : 1.5, 'F'); doc.setTextColor(15, 23, 42); doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.text(String(i + 1), x + 2, y - 2); });
    doc.setFontSize(8); doc.setTextColor(100, 116, 139); doc.text('Static route rendering from recorded GPS coordinates · not to scale', 18, 168);
    let y = 180; doc.setFont('helvetica', 'bold'); doc.setTextColor(15, 23, 42); doc.text('LOCATION TIMELINE', 18, y); y += 8;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text('Point #', 18, y); doc.text('Time', 38, y); doc.text('Latitude', 112, y); doc.text('Longitude', 148, y); y += 6;
    doc.setFont('helvetica', 'normal');
    orderedPathHistory.forEach((point, index) => { if (index > 0 && point.timestamp - orderedPathHistory[index - 1].timestamp > PATH_GAP_BREAK_MS) { if (y > 270) { doc.addPage(); y = 20; } doc.setTextColor(180, 83, 9); doc.text(`— ${formatDuration(point.timestamp - orderedPathHistory[index - 1].timestamp)} collection gap —`, 38, y); y += 6; doc.setTextColor(15, 23, 42); } if (y > 275) { doc.addPage(); y = 20; doc.setFont('helvetica', 'bold'); doc.text('LOCATION TIMELINE (CONTINUED)', 18, y); y += 8; doc.text('Point #', 18, y); doc.text('Time', 38, y); doc.text('Latitude', 112, y); doc.text('Longitude', 148, y); y += 6; doc.setFont('helvetica', 'normal'); } doc.text(`Point ${index + 1}`, 18, y); doc.text(new Date(point.timestamp).toLocaleString(), 38, y); doc.text(point.latitude.toFixed(6), 112, y); doc.text(point.longitude.toFixed(6), 148, y); y += 6; });
    doc.setFontSize(8); doc.setTextColor(100, 116, 139); doc.text('MobTrack · Actual synchronized device data', 18, 288);
    doc.save(`MobTrack_Path_History_${deviceData.mobile_number}_${dateLabel.replace(/\//g, '-')}.pdf`);
  };

  const resetPathHistoryView = () => {
    if (!deviceData) return;
    const confirmed = window.confirm(
      'Reset Path History?\n\nThis starts a new visible Path History boundary for this device. Previously synchronized MobTrack records will not be deleted, and Live Location and other features will not be affected. The reset will remain active after logout and reload.',
    );
    if (!confirmed) return;
    const resetAt = Date.now();
    localStorage.setItem(`mobtrack_path_reset_${deviceData.id}`, String(resetAt));
    setPathHistory([]);
    setSelectedPathPoint(null);
    setPathSyncNotice('PATH HISTORY VIEW RESET · New synchronized points will start at Point 1. Existing MobTrack records were preserved.');
  };

  const latitude = deviceData?.last_known_location?.latitude;
  const longitude = deviceData?.last_known_location?.longitude;
  const hasLocation = typeof latitude === 'number' && typeof longitude === 'number';
  const isLocationStreamingActive = Boolean(deviceData?.location_active && !deviceData?.location_last_error);

  // ── Render ────────────────────────────────────────────────────────────────
  const batteryPct = deviceData?.battery_level ?? 0;
  const batteryColor = batteryPct < 20 ? 'text-rose-400' : batteryPct < 50 ? 'text-amber-400' : 'text-emerald-400';
  const batteryBg = batteryPct < 20 ? 'bg-rose-500' : batteryPct < 50 ? 'bg-amber-500' : 'bg-emerald-500';

  return (
    <div className="min-h-screen lg:h-screen lg:max-h-screen lg:overflow-hidden cyber-bg text-slate-100 p-2 sm:p-3 lg:p-3.5 flex flex-col relative">

      {/* Ambient background glow orb */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[85vw] max-w-[700px] h-[320px] bg-sky-500/10 blur-[130px] rounded-full" />
        <div className="absolute bottom-10 right-[-10%] w-[50vw] max-w-[500px] h-[300px] bg-rose-500/5 blur-[120px] rounded-full" />
      </div>

      {/* 3D Cyber Particle Mesh (Ultra-lightweight WebGL, auto-paused during live streaming or inactive tabs) */}
      <CyberBackground3D isStreaming={isLiveStreaming} />

      {!deviceData ? (
        /* ════════════════════════ LOG IN ════════════════════════ */
        <div className="flex-1 flex flex-col items-center justify-center relative z-10 px-2 py-4">
          
          <div suppressHydrationWarning className="w-full max-w-md bracket-box cyber-panel p-6 sm:p-7 rounded-2xl relative shadow-2xl">
            
            {/* Header */}
            <div className="text-center mb-6">
              <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-emerald-950/70 border border-emerald-500/40 text-emerald-400 text-xs font-mono uppercase tracking-wider mb-3 shadow-sm">
                <span className="h-2 w-2 rounded-full bg-emerald-400 inline-block animate-pulse" />
                FIND MY PHONE
              </div>
              <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white font-sans">
                MOBTRACK
              </h1>
              <p className="text-slate-400 text-xs sm:text-sm mt-1.5 max-w-sm mx-auto font-mono font-medium">
                Find and track your lost phone
              </p>
            </div>

            {/* Target Mobile & Owner inputs */}
            <div className="space-y-3.5 mb-6 font-mono">
              <div>
                <label className="block text-xs font-mono font-semibold uppercase tracking-wider text-slate-400 mb-1">
                  Your Name {authMode === 'password' && <span className="text-[11px] text-slate-500 font-normal lowercase">(optional)</span>}
                </label>
                <input
                  suppressHydrationWarning
                  type="text"
                  required={authMode !== 'password'}
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  disabled={otpSent}
                  className="w-full px-4 py-3 rounded-xl bg-black/40 border border-slate-700/60 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 text-sm transition shadow-inner font-mono"
                  placeholder="Your Name"
                />
              </div>
              <div>
                <label className="block text-xs font-mono font-semibold uppercase tracking-wider text-emerald-400 mb-1">
                  Phone Number <span className="text-rose-400">*</span>
                </label>
                <input
                  suppressHydrationWarning
                  type="tel"
                  required
                  value={targetMobile}
                  onChange={(e) => setTargetMobile(e.target.value)}
                  disabled={otpSent}
                  className="w-full px-4 py-3 rounded-xl bg-black/40 border border-slate-700/60 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 text-sm font-mono tracking-wider transition shadow-inner"
                  placeholder="10-digit phone number"
                />
              </div>
            </div>

            {/* 3-Mode Pill Tab Switcher */}
            <div className="p-1 rounded-xl bg-black/50 border border-slate-700/40 grid grid-cols-3 gap-1 mb-6 text-xs font-mono font-semibold">
              <button
                suppressHydrationWarning
                type="button"
                onClick={() => { setAuthMode('password'); setErrorMsg(''); }}
                className={`py-2 px-1 rounded-lg text-center transition-all ${
                  authMode === 'password'
                    ? 'cyber-btn cyber-btn-emerald text-white shadow-md font-bold'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                Password
              </button>
              <button
                suppressHydrationWarning
                type="button"
                onClick={() => { setAuthMode('backup'); setErrorMsg(''); }}
                className={`py-2 px-1 rounded-lg text-center transition-all ${
                  authMode === 'backup'
                    ? 'cyber-btn cyber-btn-emerald text-white shadow-md font-bold'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                Backup Code
              </button>
              <button
                suppressHydrationWarning
                type="button"
                onClick={() => { setAuthMode('trustee'); setErrorMsg(''); }}
                className={`py-2 px-1 rounded-lg text-center transition-all ${
                  authMode === 'trustee'
                    ? 'cyber-btn cyber-btn-amber text-white shadow-md font-bold'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                Trustee OTP
              </button>
            </div>

            {/* Active Authentication Mode Form */}
            {authMode === 'password' ? (
              <form suppressHydrationWarning onSubmit={handlePasswordAccess} className="space-y-4 font-mono">
                <div>
                  <label className="block text-xs font-mono font-semibold uppercase tracking-wider text-slate-300 mb-1">
                    Password
                  </label>
                  <input
                    suppressHydrationWarning
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-3.5 rounded-xl bg-black/40 border border-slate-700/60 text-white text-center text-lg tracking-widest focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition shadow-inner"
                    placeholder="••••••••"
                  />
                </div>
                <button
                  suppressHydrationWarning
                  type="submit"
                  disabled={loading}
                  className="cyber-btn cyber-btn-emerald w-full text-white font-bold py-3.5 rounded-xl shadow-lg transition-all duration-200 active:scale-[0.99] disabled:opacity-50 text-sm tracking-wider uppercase"
                >
                  {loading ? 'CHECKING…' : 'LOG IN'}
                </button>
              </form>
            ) : authMode === 'backup' ? (
              <form suppressHydrationWarning onSubmit={handleBackupAccess} className="space-y-4 font-mono">
                <div>
                  <label className="block text-xs font-mono font-semibold uppercase tracking-wider text-emerald-400 mb-1">
                    8-Digit Backup Code
                  </label>
                  <input
                    suppressHydrationWarning
                    type="text"
                    required
                    value={backupCode}
                    onChange={(e) => setBackupCode(e.target.value)}
                    className="w-full px-4 py-3.5 rounded-xl bg-black/40 border border-slate-700/60 text-white font-mono text-center text-xl tracking-widest focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 uppercase transition shadow-inner"
                    placeholder="XXXXXXXX"
                    maxLength={8}
                  />
                </div>
                <button
                  suppressHydrationWarning
                  type="submit"
                  disabled={loading}
                  className="cyber-btn cyber-btn-emerald w-full text-white font-bold py-3.5 rounded-xl shadow-lg transition-all duration-200 active:scale-[0.99] disabled:opacity-50 text-sm tracking-wider uppercase"
                >
                  {loading ? 'CHECKING…' : 'LOG IN WITH CODE'}
                </button>
              </form>
            ) : (
              <div className="font-mono">
                {!otpSent ? (
                  <form suppressHydrationWarning onSubmit={handleTrusteeRequest} className="space-y-4">
                    <div>
                      <label className="block text-xs font-mono font-semibold uppercase tracking-wider text-amber-400 mb-1">
                        Trustee Cellular Number
                      </label>
                      <input
                        suppressHydrationWarning
                        type="tel"
                        required
                        value={trusteeMobile}
                        onChange={(e) => setTrusteeMobile(e.target.value)}
                        className="w-full px-4 py-3.5 rounded-xl bg-black/40 border border-slate-700/60 text-white focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 text-sm font-mono transition shadow-inner"
                        placeholder="10-digit phone number"
                      />
                    </div>
                    <button
                      suppressHydrationWarning
                      type="submit"
                      disabled={loading}
                      className="cyber-btn cyber-btn-amber w-full text-white font-bold py-3.5 rounded-xl shadow-lg transition-all duration-200 active:scale-[0.99] disabled:opacity-50 text-sm tracking-wider uppercase"
                    >
                      {loading ? 'SENDING CODE…' : 'SEND CODE'}
                    </button>
                  </form>
                ) : (
                  <form suppressHydrationWarning onSubmit={handleTrusteeOTPConfirm} className="space-y-4">
                    <div>
                      <label className="block text-xs font-mono font-semibold uppercase tracking-wider text-emerald-400 mb-1">
                        6-Digit Code
                      </label>
                      <input
                        suppressHydrationWarning
                        type="text"
                        required
                        value={otpInput}
                        onChange={(e) => setOtpInput(e.target.value)}
                        maxLength={6}
                        className="w-full px-4 py-3.5 rounded-xl bg-black/40 border border-emerald-500/50 text-white font-mono text-center text-xl tracking-widest focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition shadow-inner"
                        placeholder="XXXXXX"
                      />
                    </div>
                    <button
                      suppressHydrationWarning
                      type="submit"
                      disabled={loading}
                      className="cyber-btn cyber-btn-emerald w-full text-white font-bold py-3.5 rounded-xl shadow-lg transition-all duration-200 active:scale-[0.99] disabled:opacity-50 text-sm tracking-wider uppercase"
                    >
                      {loading ? 'CHECKING…' : 'LOG IN'}
                    </button>
                    <button
                      suppressHydrationWarning
                      type="button"
                      onClick={() => { setOtpSent(false); setOtpInput(''); }}
                      className="w-full text-slate-400 hover:text-white text-xs transition text-center underline font-mono mt-2"
                    >
                      Change Phone Number
                    </button>
                  </form>
                )}
              </div>
            )}

            {errorMsg && (
              <div className="mt-5 bg-rose-950/60 border border-rose-800/80 p-3.5 rounded-2xl flex items-center gap-2">
                <span className="text-rose-400 text-lg">⚠️</span>
                <p className="text-xs font-medium text-rose-300">{errorMsg}</p>
              </div>
            )}
          </div>
        </div>

      ) : (

        /* ════════════════════ DASHBOARD (UNSCROLLABLE 100VH ON DESKTOP) ════════════════════ */
        <div className="flex-1 min-h-0 flex flex-col w-full max-w-[1700px] mx-auto gap-2.5 sm:gap-3 relative z-10">

          {/* ── TOP NAVIGATION BAR (TACTICAL AVIONICS COCKPIT HUD) ──────────── */}
          <header className="shrink-0 bracket-box cyber-panel rounded-xl px-3.5 sm:px-5 py-2 shadow-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            
            {/* Status & Owner Readout */}
            <div className="flex items-center gap-3">
              <div className="relative flex items-center justify-center">
                <span className="h-3.5 w-3.5 rounded-full bg-emerald-400 animate-ping absolute opacity-75" />
                <span className="h-3 w-3 rounded-full bg-emerald-400 relative inline-block shadow-[0_0_12px_#10b981]" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap font-mono">
                  <h1 className="text-xs sm:text-sm font-extrabold tracking-wider text-white uppercase truncate flex items-center gap-1.5">
                    <span>{deviceData.full_name}</span>
                  </h1>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-950/90 text-emerald-300 border border-emerald-500/50 shadow-[0_0_8px_rgba(16,185,129,0.3)]">
                    ● ONLINE
                  </span>
                  <span className="hidden md:inline-flex px-2 py-0.5 rounded text-[10px] font-mono text-emerald-400 bg-emerald-950/80 border border-emerald-500/40">
                    FAST
                  </span>
                  {zuluTime && (
                    <span className="hidden xl:inline-flex px-2 py-0.5 rounded text-[10px] font-mono text-slate-300 bg-white/[0.04] border border-white/10">
                      ⏱️ {zuluTime}
                    </span>
                  )}
                </div>
                <p className="text-[11px] font-mono text-slate-400 truncate mt-0.5">
                  PHONE: <span className="text-emerald-400 font-semibold">{deviceData.mobile_number}</span>
                  <span className="text-slate-500 ml-2">
                    · TYPE: {deviceData.device_model || 'Android Phone'}
                  </span>
                </p>
              </div>
            </div>

            {/* Action Buttons Row: REFRESH, PHOTO GALLERY, and CLOSE */}
            <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto font-mono">
              <button
                onClick={refreshDeviceData}
                disabled={isRefreshing}
                title="Update phone info"
                className="cyber-btn flex-1 sm:flex-initial px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-emerald-500/30 hover:border-emerald-400/60 text-xs font-semibold text-slate-200 transition-all active:scale-95 flex items-center justify-center gap-1.5 disabled:opacity-50 whitespace-nowrap shadow-sm"
              >
                <span className={`inline-block text-xs ${isRefreshing ? 'animate-spin' : ''}`}>🔄</span>
                <span>{isRefreshing ? 'UPDATING…' : 'UPDATE'}</span>
              </button>

              <Link
                href="/photos"
                className="cyber-btn cyber-btn-emerald flex-1 sm:flex-initial px-3.5 py-1.5 rounded-lg text-xs font-bold text-white transition-all shadow-md active:scale-95 flex items-center justify-center gap-1.5 whitespace-nowrap"
              >
                <span>📷</span>
                <span>PHOTOS</span>
              </Link>

              <button
                onClick={async () => { 
                  cleanupMic(); 
                  cleanupLiveStream(); 
                  setDeviceData(null); 
                  localStorage.removeItem('loggedInDeviceId'); 
                  setAuthMode('password'); 
                  setPassword(''); 
                  setBackupCode(''); 
                  setOtpSent(false); 
                  try { await fetch('/api/auth/logout', { method: 'POST' }); } catch(e){} 
                }}
                className="cyber-btn cyber-btn-rose flex-1 sm:flex-initial px-3 py-1.5 rounded-lg text-xs font-bold text-rose-200 transition-all active:scale-95 flex items-center justify-center gap-1.5 whitespace-nowrap"
              >
                <span>🚪</span>
                <span>LOG OUT</span>
              </button>
            </div>
          </header>

          {/* ── MAIN DASHBOARD GRID: 3 COLUMNS (LEFT CONTENT EXPANDED, CENTER MAP SHIFTED RIGHT, RIGHT PINNED COMPACT) ── */}
          <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_240px] gap-3 overflow-y-auto lg:overflow-hidden pb-20 lg:pb-0">

            {/* ── LEFT COLUMN: CAMERA VIEWFINDER (EXPANDED WIDE & TALL) & TELEMETRY (SNUG BOTTOM) ── */}
            <div className="flex flex-col gap-2.5 min-h-0 h-full">

              {/* Viewfinder / Captured Media Panel (Expanded to fill max available space) */}
              <div className="bracket-box cyber-panel flex-1 min-h-0 p-3 shadow-2xl relative overflow-hidden flex flex-col rounded-xl">
                <div className="shrink-0 flex items-center justify-between border-b border-emerald-500/20 pb-2 mb-2 font-mono">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${isLiveStreaming ? 'bg-rose-500 animate-ping' : 'bg-emerald-400'} inline-block`} />
                    <h2 className="text-xs font-bold uppercase tracking-wider text-slate-100 flex items-center gap-1.5">
                      <span className={isLiveStreaming ? 'text-rose-400' : 'text-emerald-400'}>
                        {isLiveStreaming ? 'REC [LIVE CAMERA]' : 'CAMERA'}
                      </span>
                    </h2>
                  </div>
                  {isLiveStreaming ? (
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-rose-600/90 text-white animate-pulse flex items-center gap-1 shadow-[0_0_10px_#f43f5e]">
                      ● LIVE {liveFps > 0 ? `· ${liveFps} FPS` : ''}
                    </span>
                  ) : (
                    <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 px-1.5 py-0.5 rounded font-bold">
                      {deviceData.camera_streaming ? 'CAMERA ON' : 'CAMERA OFF'}
                    </span>
                  )}
                </div>

                {/* Video Monitor Frame with Tactical HUD corners - Stretches horizontally & vertically */}
                <div className="hud-corner hud-scanlines bracket-box bg-[#070a10] rounded-lg border border-emerald-500/30 flex-1 min-h-[220px] flex items-center justify-center overflow-hidden relative shadow-[inset_0_0_35px_rgba(0,0,0,0.95)]">
                  {/* Tactical Corner HUD Metadata */}
                  <div className="absolute top-2 left-2 z-20 pointer-events-none font-mono text-[9px] text-emerald-400 bg-black/75 px-1.5 py-0.5 rounded border border-emerald-500/30">
                    FRONT CAMERA
                  </div>
                  <div className="absolute top-2 right-2 z-20 pointer-events-none font-mono text-[9px] text-slate-300 bg-black/75 px-1.5 py-0.5 rounded border border-white/10">
                    {isLiveStreaming ? `${liveFps} FPS` : 'OFF'}
                  </div>

                  {/* Live video frame image */}
                  <img
                    ref={liveImgRef}
                    alt="Live stream from phone"
                    className="w-full h-full object-contain"
                    style={{ display: isLiveStreaming ? 'block' : 'none' }}
                  />

                  {/* Scanline overlay */}
                  <div className="scanline-overlay absolute inset-0 pointer-events-none opacity-30" />

                  {!isLiveStreaming && (
                    <div className="w-full h-full flex items-center justify-center p-2 text-center z-10">
                      {liveStreamLoading ? (
                        <div className="text-rose-400 space-y-1.5 animate-pulse">
                          <div className="w-8 h-8 rounded-full border-2 border-rose-500 border-t-transparent animate-spin mx-auto" />
                          <p className="font-bold text-xs">Starting camera…</p>
                          <p className="text-[10px] text-slate-400">Waiting for phone…</p>
                        </div>
                      ) : photoLoading ? (
                        <div className="text-sky-400 space-y-1.5 animate-pulse">
                          <div className="w-8 h-8 rounded-full border-2 border-sky-500 border-t-transparent animate-spin mx-auto" />
                          <p className="font-bold text-xs">Taking photo…</p>
                          <p className="text-[10px] text-slate-400">Waiting for photo…</p>
                        </div>
                      ) : photoError ? (
                        <div className="space-y-1 p-2 rounded-xl bg-rose-950/40 border border-rose-800/40">
                          <p className="text-lg">❌</p>
                          <p className="text-[11px] text-rose-300 font-semibold">{photoError}</p>
                          <p className="text-[10px] text-slate-400">Check phone and try again</p>
                        </div>
                      ) : deviceData.latest_photo_url ? (
                        <img
                          src={getPhotoUrl(deviceData.latest_photo_url)}
                          alt="Photo from device"
                          className="w-full h-full object-contain rounded-lg"
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center relative p-2">
                          <div className="w-full h-[180px] max-h-[220px] relative pointer-events-none">
                            <HoloDevice3D />
                          </div>
                          <p className="text-xs text-slate-400 max-w-xs mx-auto -mt-2 z-10">
                            No photos yet. Tap <b className="text-slate-200">LIVE CAMERA</b> or <b className="text-slate-200">TAKE PHOTO</b>.
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* On-demand snap overlay pill when live streaming */}
                  {isLiveStreaming && (
                    <div className="absolute bottom-2.5 right-2.5 z-20 flex items-center gap-2">
                      <button
                        onClick={requestPhoto}
                        disabled={photoLoading}
                        className="px-2.5 py-1 rounded-lg bg-sky-600/90 hover:bg-sky-500 text-white text-[11px] font-bold shadow-lg backdrop-blur flex items-center gap-1.5 transition active:scale-95"
                      >
                        <span>📸</span>
                        <span>{photoLoading ? 'WAIT…' : 'TAKE PHOTO'}</span>
                      </button>
                    </div>
                  )}
                </div>

                {liveStreamError && (
                  <div className="shrink-0 mt-2 bg-rose-950/50 border border-rose-800/60 p-2 rounded-xl">
                    <p className="text-[11px] text-rose-300 font-medium">{liveStreamError}</p>
                  </div>
                )}

                {photoSuccess && (
                  <div className="shrink-0 mt-2 bg-emerald-950/60 border border-emerald-700/70 p-2 rounded-xl flex items-center justify-between text-[11px]">
                    <span className="text-emerald-300 font-semibold">{photoSuccess}</span>
                    <Link href="/photos" className="text-emerald-400 underline hover:text-white font-bold text-[10px] ml-2 shrink-0">
                      SEE PHOTOS →
                    </Link>
                  </div>
                )}

                {/* Live Microphone Audio HUD Meter */}
                {isMicActive && (
                  <div className="shrink-0 mt-2 bg-emerald-950/30 border border-emerald-500/40 rounded-xl p-2 space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-emerald-400 font-mono font-bold flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
                        AUDIO STREAM · 16 kHz PCM
                      </span>
                      <span className="text-emerald-300 font-mono font-bold">{Math.round(micLevel * 100)}%</span>
                    </div>
                    {/* Segmented LED visualizer bar */}
                    <div className="h-2 bg-slate-900 rounded-full overflow-hidden p-0.5 border border-emerald-950 flex gap-0.5">
                      <div
                        className="h-full rounded-full transition-all duration-75"
                        style={{
                          width: `${Math.max(micLevel * 100, 4)}%`,
                          background: micLevel > 0.7 ? '#ef4444' : micLevel > 0.4 ? '#f59e0b' : '#10b981',
                          boxShadow: '0 0 8px currentColor',
                        }}
                      />
                    </div>
                  </div>
                )}
                {micError && (
                  <div className="shrink-0 mt-2 bg-rose-950/50 border border-rose-800/60 p-2 rounded-xl">
                    <p className="text-[11px] text-rose-300 font-medium">{micError}</p>
                  </div>
                )}
              </div>

              {/* Phone Info & Battery Bento (Snug, Compact & Pinned to Bottom) */}
              <div className="shrink-0 bracket-box cyber-panel rounded-xl p-2.5 sm:p-3 shadow-2xl space-y-1.5">
                <div className="flex items-center justify-between border-b border-emerald-500/20 pb-1.5 font-mono">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-1.5">
                    <span className="text-emerald-400">⚡</span>
                    <span>PHONE INFO</span>
                  </h2>
                  <span className="text-[9px] font-mono text-emerald-400 bg-emerald-950/80 border border-emerald-500/40 px-1.5 py-0.5 rounded font-bold">
                    ● CONNECTED
                  </span>
                </div>

                <div className="space-y-1.5 text-xs font-mono">
                  
                  {/* Battery Slider */}
                  <div className="p-2 rounded-lg bg-black/50 border border-emerald-500/20 space-y-1.5 font-mono">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400 flex items-center gap-1.5 text-[10px] font-bold uppercase">
                        <span>🔋</span> BATTERY:
                      </span>
                      <span className={`font-bold text-xs ${batteryColor}`}>
                        {deviceData.battery_level != null ? `${deviceData.battery_level}%` : 'WAITING…'}
                        {deviceData.is_charging && <span className="text-amber-400 ml-1">⚡ Charging</span>}
                      </span>
                    </div>
                    {/* Battery Slider Track & Handle */}
                    <div className="relative w-full py-1">
                      <div className="w-full h-2.5 bg-slate-900 rounded-full overflow-hidden border border-white/10 relative">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            batteryPct < 20
                              ? 'bg-rose-500 shadow-[0_0_10px_#f43f5e]'
                              : batteryPct < 50
                              ? 'bg-amber-400 shadow-[0_0_10px_#f59e0b]'
                              : 'bg-emerald-400 shadow-[0_0_10px_#10b981]'
                          }`}
                          style={{ width: `${Math.min(Math.max(batteryPct, 0), 100)}%` }}
                        />
                      </div>
                      {/* Slider Thumb */}
                      <div
                        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-white border-2 border-slate-900 shadow-[0_0_6px_rgba(255,255,255,0.9)] pointer-events-none transition-all duration-500"
                        style={{ left: `${Math.min(Math.max(batteryPct, 3), 97)}%` }}
                      />
                    </div>
                  </div>

                  {/* 4-Bento Grid: 4 cols on wider screens */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 font-mono">
                    <div className="p-1.5 px-2 rounded-lg bg-black/40 border border-emerald-500/20">
                      <span className="text-[9px] text-slate-400 block uppercase font-bold">Phone Number</span>
                      <span className="font-bold text-emerald-400 text-[11px] truncate block">{deviceData.mobile_number}</span>
                    </div>

                    <div className="p-1.5 px-2 rounded-lg bg-black/40 border border-emerald-500/20">
                      <span className="text-[9px] text-slate-400 block uppercase font-bold">Connection</span>
                      <span className="font-bold text-emerald-400 text-[11px] block truncate">● Online</span>
                    </div>

                    <div className="p-1.5 px-2 rounded-lg bg-black/40 border border-emerald-500/20">
                      <span className="text-[9px] text-slate-400 block uppercase font-bold">IMEI Number</span>
                      <span className="text-slate-200 text-[10px] truncate block font-mono font-bold">
                        {deviceData.imei1 || <span className="text-amber-400">Unavailable</span>}
                      </span>
                    </div>

                    <div className="p-1.5 px-2 rounded-lg bg-black/40 border border-emerald-500/20">
                      <span className="text-[9px] text-slate-400 block uppercase font-bold">Phone State</span>
                      <span className="text-emerald-400 text-[10px] truncate block font-mono font-bold">
                        Normal
                      </span>
                    </div>
                  </div>
                </div>

                {/* Last Seen Footer */}
                <div className="p-1.5 px-2 rounded-xl bg-white/[0.03] border border-white/10 flex items-center justify-between text-[10px] font-mono">
                  <span className="text-slate-500">Last seen:</span>
                  <span className="text-slate-200 font-bold text-right truncate ml-1">
                    {deviceData.last_seen_at ? new Date(deviceData.last_seen_at).toLocaleTimeString() : 'Waiting for phone…'}
                  </span>
                </div>
              </div>

            </div>

            {/* ── CENTER COLUMN: GPS MAP HUD (SHIFTED TO RIGHT) ── */}
            <div className="flex flex-col min-h-0 h-full">

              <div className="h-full flex flex-col bracket-box cyber-panel p-3 rounded-xl shadow-2xl">
                
                {/* Map Header */}
                <div className="shrink-0 flex items-center justify-between border-b border-emerald-500/20 pb-2 mb-2 font-mono">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#10b981] animate-pulse" />
                    <h2 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-1.5">
                      <span className="text-emerald-400">PHONE LOCATION</span>
                    </h2>
                    <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-500/40">
                      LOCATION
                    </span>
                  </div>
                  {hasLocation && (
                    <button
                      onClick={() => {
                        window.open(
                          `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${latitude}%2C${longitude}%3B${latitude}%2C${longitude}#map=16/${latitude}/${longitude}`,
                          '_blank',
                        );
                      }}
                      className="cyber-btn cyber-btn-emerald text-[10px] px-2.5 py-1 rounded-lg text-white font-bold transition shadow active:scale-95 flex items-center gap-1"
                    >
                      <span>🗺️</span>
                      <span>OPEN IN MAPS</span>
                    </button>
                  )}
                </div>

                {/* Leaflet Map Frame */}
                <div className="hud-corner bracket-box flex-1 min-h-[260px] lg:min-h-0 bg-[#070a10] rounded-lg border border-emerald-500/30 relative overflow-hidden shadow-[inset_0_0_35px_rgba(0,0,0,0.95)]">
                  {hasLocation ? (
                    <MapView latitude={latitude!} longitude={longitude!} />
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full p-4 text-center relative overflow-hidden">
                      <div className="w-full h-[220px] max-h-[260px] relative pointer-events-none">
                        <HoloGlobe3D />
                      </div>
                      <div className="space-y-1 relative z-10 -mt-4 font-mono">
                        <p className="text-xs uppercase tracking-wider text-rose-400 font-bold">
                          {isLocationStreamingActive ? 'WAITING FOR LOCATION…' : '(device location off unable to fetch)'}
                        </p>
                        <p className="text-[11px] text-slate-400 max-w-xs mx-auto">
                          Turn on location on your phone and tap <b className="text-emerald-400">START LOCATION</b>.
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {!isLocationStreamingActive && (
                  <p className="shrink-0 mt-1.5 text-[11px] text-amber-400 font-medium font-mono">
                    ⚠️ (device location off unable to fetch)
                  </p>
                )}

                {hasLocation && (
                  <div className="shrink-0 mt-2 flex flex-wrap items-center justify-between gap-1.5 text-[11px] text-slate-400 font-mono">
                    <p className="bg-white/[0.04] px-2.5 py-1 rounded-lg border border-white/10 truncate">
                      📍 {latitude!.toFixed(6)}, {longitude!.toFixed(6)}
                      {deviceData.last_known_location?.accuracy ? ` (±${Math.round(deviceData.last_known_location.accuracy)}m)` : ''}
                    </p>
                    <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold ${
                      isLocationStreamingActive
                        ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-700/60 animate-pulse'
                        : 'bg-rose-950/80 text-rose-300 border border-rose-700/60'
                    }`}>
                      {isLocationStreamingActive ? '● ACTIVE' : '(device location off unable to fetch)'}
                    </span>
                  </div>
                )}
              </div>

            </div>

            {/* ── RIGHT COLUMN: PINNED ACTION COMMAND CENTER (COMPACT 240px PINNED FAR RIGHT) ── */}
            <div className="flex flex-col min-h-0 h-full w-full lg:w-[240px]">

              <div className="bracket-box cyber-panel h-full flex flex-col rounded-xl border border-emerald-500/20 p-2.5 shadow-2xl justify-between">
                
                {/* Header */}
                <div className="shrink-0 flex items-center justify-between border-b border-emerald-500/20 pb-1.5 mb-1.5 font-mono">
                  <div className="flex items-center gap-1.5">
                    <span className="text-emerald-400 text-xs">⚡</span>
                    <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1">
                      <span className="text-emerald-400">PHONE</span> CONTROLS
                    </h3>
                  </div>
                  <span className="text-[9px] font-mono text-emerald-300 bg-emerald-950/80 border border-emerald-500/40 px-1.5 py-0.5 rounded font-bold">
                    7 ACTIONS
                  </span>
                </div>

                {/* 7 Feature Buttons Stacked Vertically: Compact 240px format */}
                <div className="flex-1 min-h-0 flex flex-col justify-between gap-1.5">

                  {/* 1. Path History */}
                  <button
                    onClick={() => { setPathHistoryOpen(true); if (deviceData) { loadPathHistory(deviceData.id, true); fetchOfflinePathViaSms(deviceData); } }}
                    className={`cyber-btn w-full p-1.5 px-2 rounded-lg font-mono transition-all flex items-center justify-between text-left relative overflow-hidden active:scale-95 border ${
                      pathHistoryOpen
                        ? 'cyber-btn-emerald ring-2 ring-emerald-400/50 shadow-lg shadow-emerald-950'
                        : 'bg-white/[0.04] hover:bg-white/[0.08] text-slate-200 border-white/10 hover:border-emerald-500/50'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-7 h-7 rounded flex items-center justify-center text-sm bg-emerald-950/70 border border-emerald-500/30 text-emerald-400 shrink-0">
                        📍
                      </div>
                      <div className="min-w-0 font-mono">
                        <div className="text-[11px] font-bold tracking-wide uppercase truncate text-slate-100">PAST LOCATIONS</div>
                        <div className="text-[9px] text-emerald-400/70 truncate">{pathHistory.length} SPOTS</div>
                      </div>
                    </div>
                    <span className="text-[9px] font-mono font-bold text-emerald-300 bg-emerald-950/80 border border-emerald-500/30 px-1.5 py-0.5 rounded shrink-0">VIEW →</span>
                  </button>

                  {/* 2. Photo */}
                  <button
                    id="btn-request-photo"
                    onClick={requestPhoto}
                    disabled={photoLoading}
                    className={`cyber-btn w-full p-1.5 px-2 rounded-lg font-mono transition-all flex items-center justify-between text-left relative overflow-hidden active:scale-95 border ${
                      photoLoading
                        ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500 animate-pulse cursor-wait'
                        : isLiveStreaming
                        ? 'cyber-btn-emerald ring-2 ring-emerald-400/50 shadow-lg'
                        : 'bg-white/[0.04] hover:bg-white/[0.08] text-slate-200 border-white/10 hover:border-emerald-500/50'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-7 h-7 rounded flex items-center justify-center text-sm bg-emerald-950/70 border border-emerald-500/30 text-emerald-400 shrink-0">
                        📸
                      </div>
                      <div className="min-w-0 font-mono">
                        <div className="text-[11px] font-bold tracking-wide uppercase truncate text-slate-100">
                          {photoLoading ? 'WAIT…' : 'TAKE PHOTO'}
                        </div>
                        <div className="text-[9px] text-slate-400 truncate">
                          PHOTO
                        </div>
                      </div>
                    </div>
                    <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-slate-300 shrink-0">
                      {photoLoading ? 'WAIT' : 'SNAP'}
                    </span>
                  </button>

                  {/* 3. Live Camera */}
                  <button
                    id="btn-live-camera"
                    onClick={isLiveStreaming ? stopLiveStream : startLiveStream}
                    disabled={!isLiveStreaming && (liveStreamLoading || cameraCommandLoading)}
                    className={`cyber-btn w-full p-1.5 px-2 rounded-lg font-mono transition-all flex items-center justify-between text-left relative overflow-hidden active:scale-95 border ${
                      isLiveStreaming
                        ? 'cyber-btn-rose ring-2 ring-rose-400/50 shadow-lg shadow-rose-950/80 pulse-glow-rose'
                        : liveStreamLoading
                        ? 'bg-rose-950/80 text-rose-300 border-rose-600 animate-pulse cursor-wait'
                        : 'bg-white/[0.04] hover:bg-white/[0.08] text-slate-200 border-white/10 hover:border-rose-500/50'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={`w-7 h-7 rounded flex items-center justify-center text-sm shrink-0 ${
                        isLiveStreaming ? 'bg-rose-500 text-white' : 'bg-rose-950/70 border border-rose-500/30 text-rose-400'
                      }`}>
                        📹
                      </div>
                      <div className="min-w-0 font-mono">
                        <div className="text-[11px] font-bold tracking-wide uppercase truncate text-slate-100">
                          {isLiveStreaming ? 'STOP CAMERA' : liveStreamLoading ? 'STARTING…' : 'LIVE CAMERA'}
                        </div>
                        <div className="text-[9px] text-rose-400/80 truncate">
                          {isLiveStreaming ? `${liveFps} FPS` : 'LIVE VIDEO'}
                        </div>
                      </div>
                    </div>
                    <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded shrink-0 border ${
                      isLiveStreaming ? 'bg-rose-600 text-white border-rose-400 animate-pulse' : 'bg-white/5 border-white/10 text-slate-400'
                    }`}>
                      {isLiveStreaming ? 'LIVE' : 'CAMERA'}
                    </span>
                  </button>

                  {/* 4. Microphone */}
                  <button
                    id="btn-toggle-mic"
                    onClick={toggleMic}
                    className={`cyber-btn w-full p-1.5 px-2 rounded-lg font-mono transition-all flex items-center justify-between text-left relative overflow-hidden active:scale-95 border ${
                      isMicActive
                        ? 'cyber-btn-emerald ring-2 ring-emerald-400/50 shadow-lg shadow-emerald-950'
                        : 'bg-white/[0.04] hover:bg-white/[0.08] text-slate-200 border-white/10 hover:border-emerald-500/50'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={`w-7 h-7 rounded flex items-center justify-center text-sm shrink-0 ${
                        isMicActive ? 'bg-emerald-500 text-white' : 'bg-emerald-950/70 border border-emerald-500/30 text-emerald-400'
                      }`}>
                        🎤
                      </div>
                      <div className="min-w-0 font-mono">
                        <div className="text-[11px] font-bold tracking-wide uppercase truncate text-slate-100">
                          {isMicActive ? 'STOP MIC' : 'START MIC'}
                        </div>
                        <div className="text-[9px] text-emerald-400/80 truncate">
                          {isMicActive ? 'HEARING SOUND' : 'MICROPHONE'}
                        </div>
                      </div>
                    </div>
                    <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded shrink-0 border ${
                      isMicActive ? 'bg-emerald-600 text-white border-emerald-400 animate-pulse' : 'bg-white/5 border-white/10 text-slate-400'
                    }`}>
                      {isMicActive ? 'ON' : 'LISTEN'}
                    </span>
                  </button>

                  {/* 5. Location */}
                  <button
                    id="btn-toggle-location"
                    onClick={toggleLocation}
                    disabled={locationCommandLoading}
                    className={`cyber-btn w-full p-1.5 px-2 rounded-lg font-mono transition-all flex items-center justify-between text-left relative overflow-hidden active:scale-95 border ${
                      isLocationStreamingActive
                        ? 'cyber-btn-emerald ring-2 ring-emerald-400/50 shadow-lg shadow-emerald-950'
                        : 'bg-white/[0.04] hover:bg-white/[0.08] text-slate-200 border-white/10 hover:border-emerald-500/50'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={`w-7 h-7 rounded flex items-center justify-center text-sm shrink-0 ${
                        isLocationStreamingActive ? 'bg-emerald-500 text-white' : 'bg-emerald-950/70 border border-emerald-500/30 text-emerald-400'
                      }`}>
                        🛰️
                      </div>
                      <div className="min-w-0 font-mono">
                        <div className="text-[11px] font-bold tracking-wide uppercase truncate text-slate-100">
                          {locationCommandLoading ? 'PLEASE WAIT…' : isLocationStreamingActive ? 'STOP LOCATION' : 'START LOCATION'}
                        </div>
                        <div className={`text-[9px] truncate ${isLocationStreamingActive ? 'text-emerald-400/80' : 'text-amber-400/90'}`}>
                          {isLocationStreamingActive ? 'LIVE LOCATION' : '(device location off unable to fetch)'}
                        </div>
                      </div>
                    </div>
                    <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded shrink-0 border ${
                      isLocationStreamingActive ? 'bg-emerald-500 text-white border-emerald-300 animate-pulse' : 'bg-white/5 border-white/10 text-slate-400'
                    }`}>
                      {isLocationStreamingActive ? 'ACTIVE' : 'OFF'}
                    </span>
                  </button>

                  {/* 6. Offline Relay */}
                  <button
                    id="btn-offline-relay"
                    onClick={() => {
                      if (deviceData) setRelayTargetPhone(deviceData.mobile_number || '');
                      setOfflineRelayModalOpen(true);
                    }}
                    className="cyber-btn cyber-btn-amber w-full p-1.5 px-2 rounded-lg font-mono transition-all flex items-center justify-between text-left relative overflow-hidden active:scale-95 border bg-white/[0.04] hover:bg-white/[0.08] text-slate-200 border-white/10 hover:border-amber-500/50"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-7 h-7 rounded flex items-center justify-center text-sm bg-amber-950/70 border border-amber-500/30 text-amber-400 shrink-0">
                        📱
                      </div>
                      <div className="min-w-0 font-mono">
                        <div className="text-[11px] font-bold tracking-wide uppercase text-amber-300 truncate">OFFLINE CELLULAR RELAY</div>
                        <div className="text-[9px] text-slate-400 truncate">SMS #track BRIDGE</div>
                      </div>
                    </div>
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-amber-950/90 text-amber-300 border border-amber-500/40 shrink-0 font-bold">
                      SMS ⚡
                    </span>
                  </button>

                  {/* 7. Police Report */}
                  <button
                    onClick={generateReport}
                    disabled={reportCooldown > 0}
                    className={`cyber-btn w-full p-1.5 px-2 rounded-lg font-mono transition-all flex items-center justify-between text-left relative overflow-hidden active:scale-95 border ${
                      reportCooldown > 0
                        ? 'bg-slate-950 text-slate-600 border-white/5 opacity-50 cursor-not-allowed'
                        : 'cyber-btn-rose bg-white/[0.04] hover:bg-white/[0.08] text-slate-200 border-white/10 hover:border-rose-500/50'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-7 h-7 rounded flex items-center justify-center text-sm bg-rose-950/70 border border-rose-500/30 text-rose-400 shrink-0">
                        🚨
                      </div>
                      <div className="min-w-0 font-mono">
                        <div className="text-[11px] font-bold tracking-wide uppercase text-rose-300 truncate">
                          {reportCooldown > 0 ? `WAIT ${reportCooldown}S` : 'DOWNLOAD REPORT'}
                        </div>
                        <div className="text-[9px] text-slate-400 truncate">POLICE HELP FILE</div>
                      </div>
                    </div>
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-rose-950/90 text-rose-300 border border-rose-500/40 shrink-0 font-bold">
                      PDF 📥
                    </span>
                  </button>

                </div>
              </div>

            </div>

          </div>

          {/* ── PATH HISTORY MODAL ── */}
          {pathHistoryOpen && (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[1500] flex items-center justify-center p-3 sm:p-6">
              <div className="bracket-box cyber-panel bg-[#070a10] border border-emerald-500/40 rounded-2xl p-4 sm:p-6 max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl space-y-3 relative overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-500/20 pb-3 shrink-0 font-mono">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-emerald-400 text-lg sm:text-xl">📍</span>
                      <h2 className="text-sm sm:text-base font-bold text-emerald-300 uppercase tracking-wide flex items-center gap-1.5">
                        <span>PAST LOCATIONS</span>
                      </h2>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      List of places your phone was seen today.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={resetPathHistoryView}
                      className="cyber-btn cyber-btn-amber px-3 py-1.5 rounded-lg text-amber-200 text-xs font-bold transition active:scale-95"
                    >
                      RESET VIEW
                    </button>
                    <button
                      onClick={generatePathReport}
                      disabled={!pathHistory.length}
                      className="cyber-btn cyber-btn-emerald px-3.5 py-1.5 rounded-lg disabled:opacity-40 text-white text-xs font-bold transition shadow active:scale-95"
                    >
                      DOWNLOAD PDF
                    </button>
                    <button
                      onClick={() => setPathHistoryOpen(false)}
                      className="cyber-btn w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-slate-300 hover:text-white font-bold transition ml-1"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* 4 Telemetry Metrics */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 text-xs font-mono shrink-0">
                  <div className="bg-white/[0.03] border border-white/10 rounded-xl p-2.5">
                    <span className="text-slate-400 text-[10px] block uppercase">Points Recorded</span>
                    <b className="text-sky-300 text-base block mt-0.5">{orderedPathHistory.length}</b>
                  </div>
                  <div className="bg-white/[0.03] border border-white/10 rounded-xl p-2.5">
                    <span className="text-slate-400 text-[10px] block uppercase">First Spot</span>
                    <b className="text-slate-200 text-xs block mt-0.5">
                      {orderedPathHistory[0] ? new Date(orderedPathHistory[0].timestamp).toLocaleTimeString() : '—'}
                    </b>
                  </div>
                  <div className="bg-white/[0.03] border border-white/10 rounded-xl p-2.5">
                    <span className="text-slate-400 text-[10px] block uppercase">Latest Spot</span>
                    <b className="text-slate-200 text-xs block mt-0.5">
                      {orderedPathHistory.length ? new Date(orderedPathHistory[orderedPathHistory.length - 1].timestamp).toLocaleTimeString() : '—'}
                    </b>
                  </div>
                  <div className="bg-white/[0.03] border border-white/10 rounded-xl p-2.5">
                    <span className="text-slate-400 text-[10px] block uppercase">Phone Status</span>
                    <b className="text-emerald-400 text-xs block mt-0.5">
                      {deviceData.last_seen_at && Date.now() - new Date(deviceData.last_seen_at).getTime() < 20 * 60 * 1000 ? '● ONLINE' : 'OFFLINE'}
                    </b>
                  </div>
                </div>

                {pathSyncNotice && (
                  <div className="bg-emerald-950/40 border border-emerald-700/50 rounded-xl p-2 text-xs text-emerald-300 font-medium shrink-0">
                    {pathSyncNotice}
                  </div>
                )}

                {!orderedPathHistory.length ? (
                  <p className="text-slate-500 text-xs py-8 text-center flex-1">
                    No places saved yet today. When your phone moves, places show here.
                  </p>
                ) : (
                  <div className="flex-1 min-h-0 flex flex-col gap-2.5 overflow-hidden">
                    <div className="h-[280px] sm:h-[340px] bg-[#020617] rounded-xl border border-white/10 overflow-hidden relative shadow-inner shrink-0">
                      <MapView
                        latitude={orderedPathHistory[orderedPathHistory.length - 1].latitude}
                        longitude={orderedPathHistory[orderedPathHistory.length - 1].longitude}
                        history={orderedPathHistory}
                        historyMode
                        onPointClick={setSelectedPathPoint}
                      />
                      <div className="absolute left-3 bottom-3 z-[1000] rounded-xl bg-[#000814]/90 backdrop-blur border border-white/10 px-3 py-1.5 text-[10px] text-slate-300 space-y-0.5 pointer-events-none shadow-lg font-mono">
                        <div className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-sky-400 inline-block" /> Past spot</div>
                        <div className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-300 inline-block" /> ★ Latest spot</div>
                        <div className="flex items-center gap-1.5"><span className="w-3 border-t-2 border-sky-400 inline-block" /> Path walked</div>
                      </div>
                    </div>

                    {selectedPathPoint && (
                      <div className="bg-sky-950/40 border border-sky-700/50 rounded-xl p-2.5 text-xs font-mono shrink-0">
                        <b className="text-sky-300">Selected Spot Details:</b>
                        <div className="text-slate-300 mt-0.5 text-[11px]">
                          Time: {new Date(selectedPathPoint.timestamp).toLocaleString()} · Lat: {selectedPathPoint.latitude.toFixed(6)}, Lng: {selectedPathPoint.longitude.toFixed(6)}
                        </div>
                      </div>
                    )}

                    <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-white/5 text-xs font-mono pr-1">
                      {orderedPathHistory.map((point, index) => (
                        <div key={`${point.timestamp}-${index}`}>
                          {index > 0 && point.timestamp - orderedPathHistory[index - 1].timestamp > PATH_GAP_BREAK_MS && (
                            <div className="py-1 text-center text-amber-400 text-[10px] tracking-wide bg-amber-950/20 my-1 rounded-lg">
                              ── {formatDuration(point.timestamp - orderedPathHistory[index - 1].timestamp)} gap ──
                            </div>
                          )}
                          <button
                            onClick={() => setSelectedPathPoint(point)}
                            className="w-full text-left py-1.5 px-2 hover:bg-white/5 rounded-lg flex items-center justify-between transition"
                          >
                            <span className="font-semibold text-sky-300 text-[11px]">Spot {index + 1} · {new Date(point.timestamp).toLocaleTimeString()}</span>
                            <span className="text-slate-400 text-[11px]">{point.latitude.toFixed(6)}, {point.longitude.toFixed(6)}{index === orderedPathHistory.length - 1 ? ' ★' : ''}</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}


          {/* ── MOBILE STICKY ACTION DOCK (PREVENTS SCROLLING UP & DOWN!) ──── */}
          <div className="md:hidden fixed bottom-3 inset-x-3 z-40 bg-[#000814]/90 backdrop-blur-[24px] border border-white/15 rounded-2xl p-2 shadow-[0_10px_35px_rgba(0,0,0,0.9)] flex items-center justify-around gap-1">
            <button
              onClick={requestPhoto}
              disabled={photoLoading}
              className={`flex-1 py-2 px-1 rounded-xl flex flex-col items-center justify-center text-[10px] font-bold transition active:scale-95 ${
                photoLoading ? 'bg-indigo-950 text-indigo-300 animate-pulse' : 'text-slate-200 hover:bg-white/10'
              }`}
            >
              <span className="text-base">📸</span>
              <span>PHOTO</span>
            </button>

            <button
              onClick={isLiveStreaming ? stopLiveStream : startLiveStream}
              className={`flex-1 py-2 px-1 rounded-xl flex flex-col items-center justify-center text-[10px] font-bold transition active:scale-95 ${
                isLiveStreaming ? 'bg-rose-600 text-white animate-pulse' : 'text-slate-200 hover:bg-white/10'
              }`}
            >
              <span className="text-base">📹</span>
              <span>{isLiveStreaming ? 'STOP' : 'LIVE'}</span>
            </button>

            <button
              onClick={toggleMic}
              className={`flex-1 py-2 px-1 rounded-xl flex flex-col items-center justify-center text-[10px] font-bold transition active:scale-95 ${
                isMicActive ? 'bg-emerald-600 text-white animate-pulse' : 'text-slate-200 hover:bg-white/10'
              }`}
            >
              <span className="text-base">🎤</span>
              <span>{isMicActive ? 'STOP' : 'MIC'}</span>
            </button>

            <button
              onClick={toggleLocation}
              disabled={locationCommandLoading}
              className={`flex-1 py-2 px-1 rounded-xl flex flex-col items-center justify-center text-[10px] font-bold transition active:scale-95 ${
                deviceData.location_active ? 'bg-sky-600 text-white' : 'text-slate-200 hover:bg-white/10'
              }`}
            >
              <span className="text-base">📍</span>
              <span>LOCATION</span>
            </button>

            <button
              onClick={() => {
                if (deviceData) setRelayTargetPhone(deviceData.mobile_number || '');
                setOfflineRelayModalOpen(true);
              }}
              className="flex-1 py-2 px-1 rounded-xl flex flex-col items-center justify-center text-[10px] font-bold text-amber-300 hover:bg-white/10 transition active:scale-95"
            >
              <span className="text-base">💬</span>
              <span>SMS</span>
            </button>
          </div>

          {/* ── OFFLINE SMS RELAY MODAL ────────────────────────────────────── */}
          {offlineRelayModalOpen && (
            <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[2000] flex items-center justify-center p-4">
              <div className="bracket-box bracket-box-rose cyber-panel bg-[#000814] border border-amber-500/40 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4 relative font-mono">
                
                {/* Modal Header */}
                <div className="flex justify-between items-center border-b border-amber-500/30 pb-3">
                  <div className="flex items-center gap-2.5">
                    <span className="text-2xl">🛰️</span>
                    <div>
                      <h3 className="font-bold text-amber-400 text-sm uppercase tracking-wider flex items-center gap-1.5">
                        <span className="text-slate-400">OFFLINE</span> SMS RELAY BRIDGE
                      </h3>
                      <p className="text-[11px] text-slate-400 mt-0.5">Direct cellular broadcast uplink when IP data is severed</p>
                    </div>
                  </div>
                  <button
                    onClick={() => { setOfflineRelayModalOpen(false); setRelayStatus(null); }}
                    className="cyber-btn text-slate-400 hover:text-white text-base font-bold w-8 h-8 rounded-lg border border-white/10 flex items-center justify-center transition"
                  >
                    ✕
                  </button>
                </div>

                <div className="space-y-3.5 text-xs font-mono">
                  <div>
                    <label className="block text-slate-400 mb-1 uppercase tracking-wider text-[10px]">Phone Number</label>
                    <input
                      type="tel"
                      value={relayTargetPhone}
                      onChange={(e) => setRelayTargetPhone(e.target.value)}
                      placeholder="e.g. 9876543210"
                      className="w-full px-3.5 py-2.5 bg-white/[0.04] border border-emerald-500/30 focus:border-amber-400 rounded-lg text-white focus:outline-none font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-400 mb-1 uppercase tracking-wider text-[10px]">Security PIN</label>
                    <input
                      type="text"
                      value={relayPin}
                      onChange={(e) => setRelayPin(e.target.value)}
                      placeholder="1234"
                      className="w-full px-3.5 py-2.5 bg-white/[0.04] border border-emerald-500/30 focus:border-amber-400 rounded-lg text-white font-bold tracking-widest text-center focus:outline-none font-mono"
                    />
                    <span className="text-[10px] text-slate-500 mt-1 block">PIN is set in the phone app</span>
                  </div>

                  {relayStatus && (
                    <div className={`p-3 rounded-xl border text-xs space-y-1 font-mono ${
                      relayStatus.type === 'error'
                        ? 'bg-rose-950/60 border-rose-800 text-rose-300'
                        : relayStatus.type === 'success'
                        ? 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
                        : 'bg-amber-950/60 border-amber-800 text-amber-300'
                    }`}>
                      <p className="font-bold flex items-center gap-1.5">
                        <span className="animate-pulse">●</span> {relayStatus.title}
                      </p>
                      <p className="text-slate-300 text-[11px]">{relayStatus.message}</p>
                    </div>
                  )}
                </div>

                <div className="pt-2 flex gap-2 font-mono">
                  <button
                    type="button"
                    onClick={dispatchOfflineRelayRequest}
                    disabled={isDispatchingRelay}
                    className="cyber-btn cyber-btn-amber flex-1 disabled:opacity-50 text-white font-bold py-2.5 rounded-lg text-xs uppercase tracking-wider transition shadow active:scale-95"
                  >
                    {isDispatchingRelay ? 'SENDING SMS…' : `SEND SMS #track ${relayPin || '1234'}`}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setOfflineRelayModalOpen(false); setRelayStatus(null); }}
                    className="cyber-btn px-4 bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 font-bold py-2.5 rounded-lg text-xs transition border border-white/10"
                  >
                    CANCEL
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}

export default function Track() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black text-white flex items-center justify-center">Loading…</div>}>
      <TrackInner />
    </Suspense>
  );
}

