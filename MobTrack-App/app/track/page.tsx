'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { verifyBackupCode } from '@/lib/auth-crypto';
import Link from 'next/link';
import dynamic from 'next/dynamic';

// Leaflet must be dynamically imported (no SSR) because it uses browser-only APIs
const MapView = dynamic(() => import('./MapView'), { ssr: false });

export type DeviceData = {
  id: string;
  mobile_number: string;
  full_name: string;
  trusted_contacts: string[];
  imei_number?: string | null;
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
type Breadcrumb = { latitude: number; longitude: number; timestamp: number };

export type PhotoCapture = {
  id: string;
  device_id: string;
  file_path: string;
  type: 'intruder' | 'on_demand' | 'remote_capture' | string;
  captured_at: string;
  uploaded_at: string;
  publicUrl?: string;
};

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

/**
 * Format any timestamp or ISO string into clear Indian Standard Time (IST).
 */
export function formatIST(dateInput?: string | number | Date | null): string {
  if (!dateInput) return 'N/A';
  const d = typeof dateInput === 'number' && dateInput < 10000000000 ? new Date(dateInput * 1000) : new Date(dateInput);
  if (isNaN(d.getTime())) return 'N/A';
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }) + ' IST';
}

/**
 * Convert storage path to valid public URL.
 */
export function getPhotoUrl(filePathOrUrl?: string | null): string {
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

export default function Track() {
  const [ownerName, setOwnerName] = useState('');
  const [targetMobile, setTargetMobile] = useState('');
  const [authMode, setAuthMode] = useState<'backup' | 'trustee'>('backup');
  const [backupCode, setBackupCode] = useState('');
  const [trusteeMobile, setTrusteeMobile] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [tempDeviceData, setTempDeviceData] = useState<DeviceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [deviceData, setDeviceData] = useState<DeviceData | null>(null);
  const [offlineHistory, setOfflineHistory] = useState<Breadcrumb[]>([]);

  // Photo state
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const photoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [cameraCommandLoading, setCameraCommandLoading] = useState(false);
  const [cameraCommandTarget, setCameraCommandTarget] = useState<boolean | null>(null);
  const expectedCameraStateRef = useRef<boolean | null>(null);
  const cameraCommandTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [locationCommandLoading, setLocationCommandLoading] = useState(false);

  // ── Photo Gallery state ───────────────────────────────────────────────────
  const [photoGallery, setPhotoGallery] = useState<PhotoCapture[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoCapture | null>(null);

  // ── Live video stream state ────────────────────────────────────────────────
  const [isLiveStreaming, setIsLiveStreaming] = useState(false);
  const [liveStreamError, setLiveStreamError] = useState('');
  const [liveStreamLoading, setLiveStreamLoading] = useState(false);
  const [frameCount, setFrameCount] = useState(0);
  const liveImgRef = useRef<HTMLImageElement | null>(null);
  const videoChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const streamTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFrameTimeRef = useRef<number>(0);
  const frameCounterRef = useRef<number>(0);
  const fpsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [liveFps, setLiveFps] = useState(0);

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
    if (streamTimeoutRef.current) { clearTimeout(streamTimeoutRef.current); streamTimeoutRef.current = null; }
    if (fpsIntervalRef.current) { clearInterval(fpsIntervalRef.current); fpsIntervalRef.current = null; }
    if (videoChannelRef.current) {
      supabase.removeChannel(videoChannelRef.current);
      videoChannelRef.current = null;
    }
    setIsLiveStreaming(false);
    setLiveStreamLoading(false);
    setLiveFps(0);
    frameCounterRef.current = 0;
  }, []);

  const startLiveStream = useCallback(async () => {
    if (!deviceData) return;

    const confirmed = window.confirm(
      'Start a LIVE CAMERA STREAM from the phone? The phone owner will see Android camera indicators and a persistent MobTrack notification. The live video will appear on this dashboard in real time.',
    );
    if (!confirmed) return;

    setLiveStreamError('');
    setLiveStreamLoading(true);
    setFrameCount(0);
    frameCounterRef.current = 0;

    // Subscribe to the video broadcast channel BEFORE sending the command
    const channelName = `video-stream-${deviceData.mobile_number}`;
    const ch = supabase.channel(channelName);
    videoChannelRef.current = ch;

    ch.on('broadcast', { event: 'video-frame' }, (msg: VideoBroadcastMessage) => {
      const b64 = msg.payload?.data;
      if (!b64) return;

      lastFrameTimeRef.current = Date.now();
      frameCounterRef.current += 1;

      // Update the live image in the DOM without React re-render overhead
      if (liveImgRef.current) {
        liveImgRef.current.src = `data:image/jpeg;base64,${b64}`;
      }

      // Mark as streaming on first frame
      setIsLiveStreaming(true);
      setLiveStreamLoading(false);

      // Reset the dead-stream timeout on each incoming frame
      if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current);
      streamTimeoutRef.current = setTimeout(() => {
        setLiveStreamError('⚠️ No video received — device may be offline or out of range.');
        cleanupLiveStream();
      }, 8000);
    }).subscribe();

    // Track FPS every second
    fpsIntervalRef.current = setInterval(() => {
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
    if (!deviceData) return;

    cleanupLiveStream();

    await supabase.from('devices').update({
      pending_command: 'stop_video_stream',
    }).eq('id', deviceData.id);

    setDeviceData(current => current ? { ...current, camera_streaming: false } : null);
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
  }, [cleanupLiveStream]);

  // Auto-restore session from login if available
  useEffect(() => {
    const savedDeviceId = localStorage.getItem('loggedInDeviceId');
    if (savedDeviceId && !deviceData) {
      supabase
        .from('devices')
        .select('*')
        .eq('id', savedDeviceId)
        .single()
        .then(({ data }: any) => {
          if (data) setDeviceData(data);
        });
    }
  }, [deviceData]);

  // ── Photo Gallery Fetcher & Realtime Sync ─────────────────────────────────
  const fetchPhotoGallery = useCallback(async (devId: string, mobNum?: string) => {
    setGalleryLoading(true);
    try {
      const itemsMap = new Map<string, PhotoCapture>();

      // 1. Direct Supabase Storage folder listing
      const folders = [devId];
      if (mobNum && mobNum !== devId) folders.push(mobNum);

      for (const folder of folders) {
        const { data: storageFiles } = await supabase
          .storage
          .from('device_media')
          .list(folder, {
            limit: 100,
            sortBy: { column: 'created_at', order: 'desc' },
          });

        if (storageFiles) {
          for (const file of storageFiles) {
            if (!file.name || file.name.startsWith('.')) continue;
            const fullPath = `${folder}/${file.name}`;
            const isIntruder = file.name.toLowerCase().includes('intruder');

            let capturedAt = file.created_at || file.updated_at || new Date().toISOString();
            const match = file.name.match(/(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})/);
            if (match) {
              const datePart = match[1];
              const timePart = match[2].replace(/-/g, ':');
              const parsedDate = new Date(`${datePart}T${timePart}`);
              if (!isNaN(parsedDate.getTime())) {
                capturedAt = parsedDate.toISOString();
              }
            }

            itemsMap.set(file.name, {
              id: file.id || fullPath,
              device_id: devId,
              file_path: fullPath,
              publicUrl: getPhotoUrl(fullPath),
              type: isIntruder ? 'intruder' : 'on_demand',
              captured_at: capturedAt,
              uploaded_at: file.created_at || capturedAt,
            });
          }
        }
      }

      // 2. Query photo_captures table for additional metadata
      const { data: dbRows } = await supabase
        .from('photo_captures')
        .select('*')
        .eq('device_id', devId)
        .order('captured_at', { ascending: false });

      if (dbRows) {
        for (const row of dbRows) {
          const fileName = row.file_path.split('/').pop() || row.file_path;
          const existing = itemsMap.get(fileName);

          if (existing) {
            existing.captured_at = row.captured_at || existing.captured_at;
            existing.uploaded_at = row.uploaded_at || existing.uploaded_at;
            existing.type = row.type || existing.type;
          } else {
            itemsMap.set(fileName, {
              id: row.id,
              device_id: devId,
              file_path: row.file_path,
              publicUrl: getPhotoUrl(row.file_path),
              type: row.type || (fileName.includes('intruder') ? 'intruder' : 'on_demand'),
              captured_at: row.captured_at || new Date().toISOString(),
              uploaded_at: row.uploaded_at || row.captured_at || new Date().toISOString(),
            });
          }
        }
      }

      const sortedPhotos = Array.from(itemsMap.values()).sort((a, b) => {
        return new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime();
      });

      setPhotoGallery(sortedPhotos);
    } catch (err) {
      console.warn('Error fetching photo gallery:', err);
    } finally {
      setGalleryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!deviceData?.id) return;
    fetchPhotoGallery(deviceData.id, deviceData.mobile_number);

    // Subscribe to Realtime new photo captures for THIS user device only
    const galleryChannel = supabase
      .channel(`gallery-sync-${deviceData.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'photo_captures',
          filter: `device_id=eq.${deviceData.id}`,
        },
        () => {
          fetchPhotoGallery(deviceData.id, deviceData.mobile_number);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(galleryChannel);
    };
  }, [deviceData?.id, deviceData?.mobile_number, fetchPhotoGallery]);

  // ── Supabase DB realtime (device updates) ───────────────────────────────────
  useEffect(() => {
    if (!deviceData) return;

    let cancelled = false;
    const loadHistory = async () => {
      const { data, error } = await supabase.from('offline_gps_history')
        .select('latitude,longitude,timestamp').eq('device_id', deviceData.id)
        .order('timestamp', { ascending: true });
      if (!cancelled && !error && data) setOfflineHistory(data as Breadcrumb[]);
    };
    loadHistory();

    const channel = supabase
      .channel('device-updates')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'devices',
        filter: `id=eq.${deviceData.id}`,
      }, (payload: any) => {
        const nextDeviceData = payload.new as Partial<DeviceData>;
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
          payload.new.latest_photo_url !== deviceData.latest_photo_url
        ) {
          setPhotoLoading(false);
          setPhotoError('');
          if (photoTimeoutRef.current) { clearTimeout(photoTimeoutRef.current); photoTimeoutRef.current = null; }
          // Refresh gallery when latest_photo_url changes
          if (deviceData?.id) fetchPhotoGallery(deviceData.id);
        }
        if (
          payload.new.pending_command === 'none' &&
          payload.new.latest_photo_url === deviceData.latest_photo_url &&
          photoLoading &&
          payload.new.camera_last_error
        ) {
          setPhotoLoading(false);
          setPhotoError(`⚠️ ${payload.new.camera_last_error}`);
          if (photoTimeoutRef.current) { clearTimeout(photoTimeoutRef.current); photoTimeoutRef.current = null; }
        }

        if (payload.new.camera_streaming === false && isLiveStreaming) {
          cleanupLiveStream();
        }
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [deviceData, isLiveStreaming, cleanupLiveStream, photoLoading, fetchPhotoGallery]);

  // ── Camera capture trigger ────────────────────────────────────────────────
  const requestPhoto = async () => {
    if (!deviceData) return;
    const currentDevice = deviceData;

    setPhotoLoading(true);
    setPhotoError('');
    if (photoTimeoutRef.current) clearTimeout(photoTimeoutRef.current);

    await supabase
      .from('devices')
      .update({ pending_command: 'take_photo' })
      .eq('id', currentDevice.id);

    photoTimeoutRef.current = setTimeout(() => {
      setPhotoLoading(false);
      setPhotoError('⚠️ Capture timed out — device may be offline or unreachable.');
      photoTimeoutRef.current = null;
    }, 30000);
  };

  const toggleLocation = async () => {
    if (!deviceData || locationCommandLoading) return;
    const nextActive = !deviceData.location_active;
    const confirmed = window.confirm(
      nextActive
        ? 'Share this phone’s location with the authorized dashboard? The phone owner must allow location access, and Android will show a location notification.'
        : 'Stop sharing this phone’s location now?',
    );
    if (!confirmed) return;

    setLocationCommandLoading(true);
    const { error } = await supabase.from('devices').update({
      pending_command: nextActive ? 'start_location' : 'stop_location',
      location_last_error: null,
    }).eq('id', deviceData.id);
    if (error) setPhotoError(`Location command failed: ${error.message}`);
    setLocationCommandLoading(false);
  };

  // ── Login logic ───────────────────────────────────────────────────────────
  const handleBackupAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (targetMobile.length !== 10) { setErrorMsg('Target mobile must be 10 digits.'); return; }
    setLoading(true); setErrorMsg('');
    const { data, error } = await supabase
      .from('devices').select('*')
      .eq('mobile_number', targetMobile)
      .ilike('full_name', ownerName)
      .single();
    
    const isCodeValid = await verifyBackupCode(backupCode, data?.backup_codes_hash);
    setLoading(false);
    if (error || !data || !isCodeValid) setErrorMsg('Access Denied: Invalid Name, Mobile Number, or Backup Code.');
    else setDeviceData(data);
  };

  const handleTrusteeRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (targetMobile.length !== 10 || trusteeMobile.length !== 10) { setErrorMsg('Mobiles must be 10 digits.'); return; }
    setLoading(true); setErrorMsg('');
    const { data, error } = await supabase
      .from('devices').select('*')
      .eq('mobile_number', targetMobile)
      .ilike('full_name', ownerName)
      .single();
    if (error || !data) { setLoading(false); setErrorMsg('Access Denied.'); return; }
    if (!data.trusted_contacts.includes(trusteeMobile)) { setLoading(false); setErrorMsg('SECURITY BLOCK: Unauthorized trustee.'); return; }
    const { error: sendErr } = await supabase.auth.signInWithOtp({ phone: '+91' + trusteeMobile });
    setLoading(false);
    if (sendErr) setErrorMsg(`Failed to send OTP: ${sendErr.message}`);
    else { setTempDeviceData(data); setOtpSent(true); setErrorMsg(''); }
  };

  const handleTrusteeOTPConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otpInput.length !== 6) { setErrorMsg('OTP must be 6 digits.'); return; }
    setLoading(true); setErrorMsg('');
    const { error: verifyErr } = await supabase.auth.verifyOtp({ phone: '+91' + trusteeMobile, token: otpInput, type: 'sms' });
    setLoading(false);
    if (verifyErr) setErrorMsg(`Invalid OTP: ${verifyErr.message}`);
    else setDeviceData(tempDeviceData);
  };

  const latitude = deviceData?.last_known_location?.latitude;
  const longitude = deviceData?.last_known_location?.longitude;
  const hasLocation = typeof latitude === 'number' && typeof longitude === 'number';
  const displayLatestPhotoUrl = getPhotoUrl(deviceData?.latest_photo_url);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-black text-white p-6">

      {!deviceData ? (
        /* ════════════════════════ LOGIN ════════════════════════ */
        <div className="flex flex-col items-center justify-center min-h-[85vh]">
          <div className="w-full max-w-md bg-gray-900 p-8 rounded-lg border border-red-900 shadow-2xl shadow-red-900/20 mt-10">
            <h1 className="text-3xl font-bold mb-2 text-center text-red-500">EMERGENCY TRACKING</h1>
            <p className="text-gray-400 text-sm text-center mb-6">Connect to a phone that has explicitly enabled its MobTrack remote session.</p>

            <div className="space-y-4 mb-8">
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-300">Device Owner Name</label>
                <input type="text" required value={ownerName} onChange={(e) => setOwnerName(e.target.value)} disabled={otpSent}
                  className="w-full p-3 rounded bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-red-500" placeholder="Official Full Name" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-300">Lost Mobile Number</label>
                <input type="tel" required value={targetMobile} onChange={(e) => setTargetMobile(e.target.value)} disabled={otpSent}
                  className="w-full p-3 rounded bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-red-500" placeholder="10-digit Mobile Number" />
              </div>
            </div>

            {authMode === 'backup' ? (
              <form onSubmit={handleBackupAccess} className="space-y-6 border-t border-gray-800 pt-6">
                <div>
                  <label className="block text-sm font-medium mb-1 text-blue-400">Security Backup Code</label>
                  <input type="text" required value={backupCode} onChange={(e) => setBackupCode(e.target.value)}
                    className="w-full p-4 rounded bg-gray-800 border border-gray-700 text-white font-mono text-center text-xl tracking-widest focus:outline-none focus:border-red-500 uppercase" placeholder="XXXXXXXX" maxLength={8} />
                </div>
                <button type="submit" disabled={loading}
                  className="w-full bg-red-600 hover:bg-red-700 font-bold py-4 rounded transition duration-200">
                  {loading ? 'Verifying…' : 'CONNECT TO DEVICE'}
                </button>
                <div className="flex justify-between items-center text-xs text-gray-400 mt-4">
                  <button type="button" onClick={() => { setAuthMode('trustee'); setErrorMsg(''); }} className="hover:text-blue-400 underline">Use Trustee Emergency Access</button>
                  <Link href="/login" className="hover:text-white">Owner Login →</Link>
                </div>
              </form>
            ) : (
              <div className="border-t border-gray-800 pt-6">
                {!otpSent ? (
                  <form onSubmit={handleTrusteeRequest} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-1 text-green-400">Trustee Registered Mobile</label>
                      <input type="tel" required value={trusteeMobile} onChange={(e) => setTrusteeMobile(e.target.value)}
                        className="w-full p-3 rounded bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-green-500" placeholder="10-digit Trustee Number" />
                    </div>
                    <button type="submit" disabled={loading}
                      className="w-full bg-green-600 hover:bg-green-700 font-bold py-3 rounded transition duration-200">
                      {loading ? 'Requesting…' : 'SEND OTP TO TRUSTEE'}
                    </button>
                    <button type="button" onClick={() => { setAuthMode('backup'); setErrorMsg(''); }}
                      className="w-full text-gray-400 hover:text-white text-sm transition mt-2 underline">
                      ← Back to Backup Code
                    </button>
                  </form>
                ) : (
                  <form onSubmit={handleTrusteeOTPConfirm} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-1 text-green-400">Enter 6-Digit OTP sent to Trustee</label>
                      <input type="text" required value={otpInput} onChange={(e) => setOtpInput(e.target.value)} maxLength={6}
                        className="w-full p-4 rounded bg-gray-800 border border-green-500 text-white font-mono text-center text-xl tracking-widest focus:outline-none" placeholder="XXXXXX" />
                    </div>
                    <button type="submit" disabled={loading}
                      className="w-full bg-green-600 hover:bg-green-700 font-bold py-4 rounded transition duration-200">
                      {loading ? 'Verifying…' : 'VERIFY & ACCESS GPS'}
                    </button>
                    <button type="button" onClick={() => { setOtpSent(false); setOtpInput(''); }}
                      className="w-full text-gray-400 hover:text-white text-sm transition mt-2 underline">
                      Cancel / Change Trustee Number
                    </button>
                  </form>
                )}
              </div>
            )}
            {errorMsg && (
              <div className="mt-6 bg-red-900/30 border border-red-800 p-3 rounded">
                <p className="text-center text-sm font-medium text-red-400">{errorMsg}</p>
              </div>
            )}
            <div className="mt-8 text-center">
              <Link href="/" className="text-gray-600 hover:text-white text-sm transition">← Return to Main Menu</Link>
            </div>
          </div>
        </div>

      ) : (

        /* ════════════════════ DASHBOARD ════════════════════ */
        <div className="max-w-6xl mx-auto space-y-6 mt-4">

          {/* Header */}
          <div className="flex justify-between items-center bg-gray-900 p-4 rounded border border-red-900">
            <div>
                <h1 className="text-2xl font-bold text-red-500 flex items-center">
                  <span className="animate-pulse h-3 w-3 bg-red-500 rounded-full mr-3"></span>
                AUTHORIZED DEVICE SESSION ACTIVE
              </h1>
              <p className="text-sm text-gray-400">Device Owner: {deviceData.full_name}</p>
            </div>
            <button
              onClick={() => { cleanupMic(); cleanupLiveStream(); setDeviceData(null); setAuthMode('backup'); setBackupCode(''); setOtpSent(false); }}
              className="bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded text-sm transition">
              CLOSE SESSION
            </button>
          </div>

          {/* Main Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

            {/* Left column — hardware profile + media preview */}
            <div className="bg-gray-900 p-6 rounded border border-gray-800 space-y-4">
              <h2 className="text-lg font-bold border-b border-gray-700 pb-2">Hardware Profile</h2>
              <div className="space-y-2 text-sm font-mono text-gray-300">
                <p><span className="text-gray-500">Target Mobile:</span> {deviceData.mobile_number}</p>
                <p>
                  <span className="text-gray-500">IMEI number:</span>{' '}
                  {deviceData.imei_number || <span className="text-yellow-400">Unavailable on this Android version</span>}
                </p>
                <p><span className="text-gray-500">Network:</span> <span className="text-green-400">Internet connected (Realtime)</span></p>
                <p><span className="text-gray-500">Battery:</span>{' '}
                  {deviceData.battery_level != null ? (
                    <span className={deviceData.battery_level < 20 ? 'text-red-400' : deviceData.battery_level < 50 ? 'text-yellow-400' : 'text-green-400'}>
                      {deviceData.battery_level}%{deviceData.is_charging ? ' ⚡ Charging' : ''}
                    </span>
                  ) : <span className="text-yellow-400 animate-pulse">Syncing…</span>}
                </p>
                <p><span className="text-gray-500">Camera:</span>{' '}
                  <span className={deviceData.camera_streaming ? 'text-red-400' : 'text-gray-400'}>
                    {isLiveStreaming ? '🔴 LIVE STREAMING' : deviceData.camera_streaming ? 'ACTIVE' : 'OFF'}
                  </span>
                </p>
                <p><span className="text-gray-500">Location:</span>{' '}
                  <span className={deviceData.location_active ? 'text-blue-400' : 'text-gray-400'}>
                    {deviceData.location_active ? 'SHARING' : 'OFF'}
                  </span>
                </p>
                <p><span className="text-gray-500">Last seen (IST):</span>{' '}
                  <span className="text-white font-sans">{formatIST(deviceData.last_seen_at)}</span>
                </p>
                <p><span className="text-gray-500">Status:</span> <span className="text-green-400">AUTHORIZED SESSION</span></p>
              </div>

              {/* Live Camera Feed / Captured Media */}
              <h2 className="text-lg font-bold border-b border-gray-700 pb-2 mt-4">
                {isLiveStreaming ? '📹 Live Camera Feed' : 'Latest Captured Photo'}
              </h2>

              {/* Live Stream Panel */}
              <div className="bg-gray-800 rounded border border-gray-700 min-h-[220px] flex items-center justify-center overflow-hidden relative">
                {/* Always render the img for live frames, hide when not streaming */}
                <img
                  ref={liveImgRef}
                  alt="Live camera feed from authorized device"
                  className="w-full h-full object-cover"
                  style={{ display: isLiveStreaming ? 'block' : 'none' }}
                />

                {!isLiveStreaming && (
                  <>
                    {liveStreamLoading ? (
                      <div className="text-center text-red-400 animate-pulse text-sm p-4">
                        <p className="text-3xl mb-2">📹</p>
                        <p className="font-bold">Starting live stream…</p>
                        <p className="text-xs text-gray-500 mt-2">Waiting for phone to respond…</p>
                      </div>
                    ) : photoLoading ? (
                      <div className="text-center text-blue-400 animate-pulse text-sm">
                        <p className="text-2xl mb-2">📸</p>
                        <p>Command sent to hardware…</p>
                        <p className="text-xs text-gray-500">Waiting for the authorized phone session…</p>
                      </div>
                    ) : photoError ? (
                      <div className="text-center text-sm p-4">
                        <p className="text-2xl mb-2">❌</p>
                        <p className="text-red-400 font-medium">{photoError}</p>
                        <p className="text-xs text-gray-500 mt-2">Click REQUEST PHOTO to try again.</p>
                      </div>
                    ) : displayLatestPhotoUrl ? (
                      <img
                        src={displayLatestPhotoUrl}
                        alt="Photo from the authorized device session"
                        className="w-full h-full object-cover cursor-pointer hover:opacity-90 transition"
                        onClick={() => setSelectedPhoto({
                          id: 'latest',
                          device_id: deviceData.id,
                          file_path: deviceData.latest_photo_url || '',
                          type: 'latest_capture',
                          captured_at: new Date().toISOString(),
                          uploaded_at: new Date().toISOString(),
                          publicUrl: displayLatestPhotoUrl,
                        })}
                      />
                    ) : (
                      <p className="text-gray-600 text-sm p-4 text-center">Click LIVE CAMERA to stream, or REQUEST PHOTO for a still shot.</p>
                    )}
                  </>
                )}

                {/* Live overlay badge */}
                {isLiveStreaming && (
                  <div className="absolute top-2 left-2 bg-red-600 text-white text-xs font-bold px-2 py-1 rounded flex items-center gap-1">
                    <span className="animate-pulse h-2 w-2 bg-white rounded-full inline-block"></span>
                    LIVE {liveFps > 0 ? `· ${liveFps} fps` : ''}
                  </div>
                )}
              </div>

              {liveStreamError && (
                <div className="mt-1 bg-red-900/30 border border-red-800 p-2 rounded">
                  <p className="text-xs text-red-400">{liveStreamError}</p>
                </div>
              )}

              {/* Live Audio Indicator */}
              {isMicActive && (
                <div className="mt-2 bg-gray-800 rounded border border-green-800 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-green-400 text-xs font-mono flex items-center gap-2">
                      <span className="animate-pulse h-2 w-2 bg-green-400 rounded-full inline-block"></span>
                      LIVE AUDIO STREAM
                    </span>
                    <span className="text-green-400 text-xs">{Math.round(micLevel * 100)}%</span>
                  </div>
                  <div className="h-2 bg-gray-700 rounded overflow-hidden">
                    <div
                      className="h-full rounded transition-all duration-100"
                      style={{
                        width: `${micLevel * 100}%`,
                        background: micLevel > 0.7
                          ? '#ef4444'
                          : micLevel > 0.4
                          ? '#eab308'
                          : '#22c55e',
                      }}
                    />
                  </div>
                </div>
              )}
              {micError && (
                <div className="mt-2 bg-red-900/30 border border-red-800 p-2 rounded">
                  <p className="text-xs text-red-400">{micError}</p>
                </div>
              )}
            </div>

            {/* Right columns — OpenStreetMap location */}
            <div className="bg-gray-900 p-6 rounded border border-gray-800 col-span-2 flex flex-col">
              <div className="flex items-center justify-between border-b border-gray-700 pb-2 mb-4">
                <h2 className="text-lg font-bold">📍 Device Location</h2>
                {hasLocation && (
                  <button
                    onClick={() => {
                      window.open(
                        `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${latitude}%2C${longitude}%3B${latitude}%2C${longitude}#map=16/${latitude}/${longitude}`,
                        '_blank',
                      );
                    }}
                    className="text-xs px-3 py-1 rounded bg-blue-700 hover:bg-blue-600 text-white font-bold transition"
                  >
                    🗺️ OPEN IN MAPS
                  </button>
                )}
              </div>
              <div className="flex-1 bg-gray-800 rounded border border-gray-700 relative overflow-hidden min-h-[350px]">
                {hasLocation ? (
                  <MapView latitude={latitude!} longitude={longitude!} history={offlineHistory} />
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center z-10 p-6">
                      <p className="text-gray-500 font-mono text-sm mb-2">LOCATION NOT SHARED</p>
                      <p className="text-gray-600 text-xs mt-2">Click START LOCATION below and allow location access on the phone.</p>
                    </div>
                  </div>
                )}
              </div>
              {deviceData.location_last_error && <p className="mt-2 text-xs text-yellow-400">Phone location status: {deviceData.location_last_error}</p>}
              {hasLocation && (
                <p className="mt-2 text-xs text-gray-400 font-mono">
                  Coordinates: {latitude!.toFixed(6)}, {longitude!.toFixed(6)}
                  {deviceData.last_known_location?.accuracy ? ` · ±${Math.round(deviceData.last_known_location.accuracy)} m` : ''}
                  {deviceData.last_known_location?.timestamp ? ` · Recorded: ${formatIST(deviceData.last_known_location.timestamp)}` : ''}
                </p>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mt-6">

            {/* Photo */}
            <button
              id="btn-request-photo"
              onClick={requestPhoto}
              disabled={photoLoading}
              className={`${photoLoading ? 'bg-blue-800 cursor-wait' : 'bg-blue-600 hover:bg-blue-700'} p-4 rounded font-bold transition flex flex-col items-center`}
            >
              <span>📸 {photoLoading ? 'CAPTURING…' : 'REQUEST PHOTO'}</span>
              <span className="text-xs font-normal text-blue-200 mt-1">Still shot from live camera</span>
            </button>

            {/* Live Camera Stream */}
            <button
              id="btn-live-camera"
              onClick={isLiveStreaming ? stopLiveStream : startLiveStream}
              disabled={liveStreamLoading || cameraCommandLoading}
              className={`${
                isLiveStreaming
                  ? 'bg-red-700 hover:bg-red-800 ring-2 ring-red-400'
                  : liveStreamLoading
                  ? 'bg-red-900 cursor-wait'
                  : 'bg-gray-700 hover:bg-gray-600'
              } p-4 rounded font-bold transition flex flex-col items-center relative overflow-hidden`}
            >
              {isLiveStreaming && (
                <span className="absolute inset-0 animate-pulse bg-red-500/10 rounded" />
              )}
              <span className="relative">
                📹 {isLiveStreaming ? 'STOP STREAM' : liveStreamLoading ? 'CONNECTING…' : 'LIVE CAMERA'}
              </span>
              <span className={`text-xs font-normal mt-1 relative ${isLiveStreaming ? 'text-red-200' : 'text-gray-300'}`}>
                {isLiveStreaming ? `Streaming live · ${liveFps} fps` : 'Real-time video from phone'}
              </span>
            </button>

            {/* Microphone */}
            <button
              id="btn-toggle-mic"
              onClick={toggleMic}
              className={`
                ${isMicActive
                  ? 'bg-green-700 hover:bg-green-800 ring-2 ring-green-400'
                  : 'bg-gray-700 hover:bg-gray-600'}
                p-4 rounded font-bold transition flex flex-col items-center relative overflow-hidden`}
            >
              {isMicActive && (
                <span className="absolute inset-0 animate-pulse bg-green-500/10 rounded" />
              )}
              <span className="relative">
                🎤 {isMicActive ? 'STOP MIC' : 'START MIC'}
              </span>
              <span className={`text-xs font-normal mt-1 relative ${isMicActive ? 'text-green-200' : 'text-gray-300'}`}>
                {isMicActive ? 'Streaming with phone consent…' : 'Microphone session'}
              </span>
            </button>

            {/* Location */}
            <button
              id="btn-toggle-location"
              onClick={toggleLocation}
              disabled={locationCommandLoading}
              className={`${deviceData.location_active ? 'bg-blue-700 hover:bg-blue-800 ring-2 ring-blue-400' : 'bg-yellow-600 hover:bg-yellow-700'} p-4 rounded font-bold transition flex flex-col items-center text-black`}
            >
              <span>📍 {locationCommandLoading ? 'UPDATING…' : deviceData.location_active ? 'STOP LOCATION' : 'START LOCATION'}</span>
              <span className="text-xs font-normal text-yellow-900 mt-1">Phone owner permission required</span>
            </button>

            {/* Police report (placeholder) */}
            <button
              className="bg-red-600 hover:bg-red-700 p-4 rounded font-bold transition flex flex-col items-center opacity-50 cursor-not-allowed"
              disabled
            >
              <span>🚨 POLICE REPORT</span>
              <span className="text-xs font-normal text-red-200 mt-1">Pending setup…</span>
            </button>
          </div>

          {/* ════════════════════ PHOTO GALLERY ════════════════════ */}
          <div className="bg-gray-900 p-6 rounded-lg border border-gray-800 mt-8 space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-gray-800 pb-4 gap-2">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <span>📸 Security & Intruder Photo Gallery</span>
                  <span className="bg-blue-600/30 text-blue-400 text-xs px-2.5 py-0.5 rounded-full border border-blue-500/40">
                    {photoGallery.length} {photoGallery.length === 1 ? 'Capture' : 'Captures'}
                  </span>
                </h2>
                <p className="text-xs text-gray-400 mt-1">
                  Photos captured automatically upon incorrect PIN attempts or requested remotely from this dashboard.
                </p>
              </div>
              <button
                onClick={() => deviceData?.id && fetchPhotoGallery(deviceData.id, deviceData.mobile_number)}
                disabled={galleryLoading}
                className="text-xs bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded text-gray-300 hover:text-white font-medium transition flex items-center gap-1.5 border border-gray-700"
              >
                <span>🔄</span>
                <span>{galleryLoading ? 'Refreshing…' : 'Refresh Gallery'}</span>
              </button>
            </div>

            {galleryLoading && photoGallery.length === 0 ? (
              <div className="py-12 text-center text-gray-400 animate-pulse">
                <p className="text-2xl mb-2">⏳</p>
                <p className="text-sm">Loading security photos for your device…</p>
              </div>
            ) : photoGallery.length === 0 ? (
              <div className="py-12 text-center text-gray-500 bg-gray-950/40 rounded-lg border border-dashed border-gray-800 p-8">
                <p className="text-3xl mb-2">🛡️</p>
                <p className="text-base font-semibold text-gray-300">No Security Photos Yet</p>
                <p className="text-xs text-gray-500 max-w-md mx-auto mt-1">
                  Intruder selfies taken when someone enters an incorrect PIN 3 times (or photos captured via REQUEST PHOTO) will appear here instantly.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 pt-2">
                {photoGallery.map((photo, index) => {
                  const isIntruder = photo.type === 'intruder';
                  return (
                    <div
                      key={photo.id || index}
                      className="bg-gray-950/70 rounded-lg border border-gray-800 overflow-hidden hover:border-gray-600 transition flex flex-col group shadow-lg"
                    >
                      {/* Image Thumbnail with click to expand */}
                      <div
                        className="relative aspect-video bg-black cursor-pointer overflow-hidden flex items-center justify-center"
                        onClick={() => setSelectedPhoto(photo)}
                      >
                        {photo.publicUrl ? (
                          <img
                            src={photo.publicUrl}
                            alt={`Capture ${index + 1}`}
                            className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                            loading="lazy"
                          />
                        ) : (
                          <div className="text-xs text-gray-600">No image preview</div>
                        )}
                        <span className={`absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded shadow ${
                          isIntruder ? 'bg-red-600 text-white' : 'bg-blue-600 text-white'
                        }`}>
                          {isIntruder ? '🚨 INTRUDER SELFIE' : '📸 REMOTE CAPTURE'}
                        </span>
                        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                          <span className="bg-black/70 text-white text-xs px-3 py-1.5 rounded-full border border-white/20 font-medium">
                            🔍 Expand
                          </span>
                        </div>
                      </div>

                      {/* Card Metadata */}
                      <div className="p-3 flex-1 flex flex-col justify-between space-y-2 text-xs">
                        <div className="space-y-1">
                          <div className="flex items-start justify-between gap-1">
                            <span className="text-gray-400 font-medium">Captured:</span>
                            <span className="text-white font-semibold text-right">
                              {formatIST(photo.captured_at)}
                            </span>
                          </div>
                          <div className="flex items-start justify-between gap-1 text-[11px] text-gray-400">
                            <span>Uploaded:</span>
                            <span className="text-gray-300 text-right">
                              {formatIST(photo.uploaded_at)}
                            </span>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center justify-between pt-2 border-t border-gray-800/80">
                          <button
                            onClick={() => setSelectedPhoto(photo)}
                            className="text-blue-400 hover:text-blue-300 font-medium text-[11px]"
                          >
                            View Full ↗
                          </button>
                          {photo.publicUrl && (
                            <a
                              href={photo.publicUrl}
                              target="_blank"
                              rel="noreferrer"
                              download
                              className="text-gray-400 hover:text-white text-[11px] bg-gray-800 px-2 py-0.5 rounded"
                            >
                              ⬇ Download
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ════════════════════ IMAGE PREVIEW MODAL ════════════════════ */}
          {selectedPhoto && (
            <div
              className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4"
              onClick={() => setSelectedPhoto(null)}
            >
              <div
                className="bg-gray-900 border border-gray-700 rounded-xl max-w-3xl w-full overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex justify-between items-center p-4 border-b border-gray-800">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold px-2.5 py-1 rounded ${
                      selectedPhoto.type === 'intruder' ? 'bg-red-600 text-white' : 'bg-blue-600 text-white'
                    }`}>
                      {selectedPhoto.type === 'intruder' ? '🚨 INTRUDER ATTEMPT' : '📸 REMOTE CAPTURE'}
                    </span>
                    <span className="text-sm text-gray-300 font-mono">
                      {formatIST(selectedPhoto.captured_at)}
                    </span>
                  </div>
                  <button
                    onClick={() => setSelectedPhoto(null)}
                    className="text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 p-2 rounded-full text-sm font-bold w-8 h-8 flex items-center justify-center transition"
                  >
                    ✕
                  </button>
                </div>

                <div className="max-h-[70vh] bg-black flex items-center justify-center p-2 overflow-hidden">
                  {selectedPhoto.publicUrl ? (
                    <img
                      src={selectedPhoto.publicUrl}
                      alt="Security photo detail"
                      className="max-h-[68vh] w-auto object-contain rounded"
                    />
                  ) : (
                    <p className="text-gray-500 py-12">Image source not available</p>
                  )}
                </div>

                <div className="p-4 bg-gray-950 flex flex-col sm:flex-row justify-between items-center gap-2 text-xs border-t border-gray-800">
                  <div className="text-gray-400 space-y-0.5 text-center sm:text-left">
                    <p><span className="text-gray-500">Captured:</span> {formatIST(selectedPhoto.captured_at)}</p>
                    <p><span className="text-gray-500">Uploaded:</span> {formatIST(selectedPhoto.uploaded_at)}</p>
                  </div>
                  {selectedPhoto.publicUrl && (
                    <div className="flex gap-2">
                      <a
                        href={selectedPhoto.publicUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded font-bold transition flex items-center gap-1.5"
                      >
                        <span>Open In New Tab</span>
                        <span>↗</span>
                      </a>
                      <a
                        href={selectedPhoto.publicUrl}
                        download
                        className="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded font-bold transition flex items-center gap-1.5 border border-gray-700"
                      >
                        <span>⬇ Download</span>
                      </a>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
