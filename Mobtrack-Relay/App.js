import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  SafeAreaView,
  TouchableOpacity,
  PermissionsAndroid,
  Platform,
  Linking,
  StatusBar
} from 'react-native';
import 'react-native-url-polyfill/auto';
import 'react-native-get-random-values';
import { createClient } from '@supabase/supabase-js';
import * as SmsGateway from 'sms-gateway';

const supabaseUrl = 'https://bmqmdykqrnocjyqjjtzb.supabase.co';
const supabaseAnonKey = 'sb_publishable_43VlpJVrEI8fzut89x0Isg_kq6G32CU';
const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  }
});

export default function App() {
  const [logs, setLogs] = useState([]);
  const [permissionsGranted, setPermissionsGranted] = useState(false);
  const [latestLocation, setLatestLocation] = useState(null);
  const processedRequestIds = useRef(new Set());

  const addLog = (msg) => {
    console.log(msg);
    setLogs((prev) => [
      {
        id: Date.now().toString() + Math.random(),
        time: new Date().toLocaleTimeString(),
        msg
      },
      ...prev
    ]);
  };

  const checkOrRequestPermissions = async () => {
    if (Platform.OS !== 'android') {
      setPermissionsGranted(true);
      return true;
    }
    try {
      const hasReceive = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS);
      const hasSend = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.SEND_SMS);
      if (hasReceive && hasSend) {
        setPermissionsGranted(true);
        return true;
      }
      const results = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
        PermissionsAndroid.PERMISSIONS.SEND_SMS,
        PermissionsAndroid.PERMISSIONS.READ_SMS,
      ]);
      const granted =
        results[PermissionsAndroid.PERMISSIONS.RECEIVE_SMS] === PermissionsAndroid.RESULTS.GRANTED &&
        results[PermissionsAndroid.PERMISSIONS.SEND_SMS] === PermissionsAndroid.RESULTS.GRANTED;
      setPermissionsGranted(granted);
      if (granted) {
        addLog('✅ SMS permissions granted.');
      } else {
        addLog('⚠️ SMS permissions not granted. Tap "GRANT PERMISSION" button above.');
      }
      return granted;
    } catch (err) {
      addLog(`❌ Permission check error: ${err.message}`);
      return false;
    }
  };

  const handlePendingRequest = async (req) => {
    if (!req || !req.id || processedRequestIds.current.has(req.id)) return;
    processedRequestIds.current.add(req.id);

    addLog(`📥 [1] Input received from web: Request for phone ${req.target_phone_number} (Device: ${req.target_device_id || 'N/A'})`);
    const triggerMessage = `#track ${req.pin || '1234'}`;
    addLog(`📤 [2] Sending to lost mobile: "${triggerMessage}" to ${req.target_phone_number}`);

    try {
      const success = await SmsGateway.sendSms(req.target_phone_number, triggerMessage);
      if (success) {
        addLog(`✅ [2] Dispatched SMS "${triggerMessage}" to ${req.target_phone_number}`);
        await supabase
          .from('sms_requests')
          .update({ status: 'sent', updated_at: new Date().toISOString() })
          .eq('id', req.id);
      } else {
        addLog(`❌ [2] FAILED: Could not send SMS to ${req.target_phone_number}. Check SIM card, SMS quota & permissions.`);
        await supabase
          .from('sms_requests')
          .update({ status: 'failed', updated_at: new Date().toISOString() })
          .eq('id', req.id);
      }
    } catch (err) {
      addLog(`❌ [2] FAILED: Exception sending SMS to lost mobile - ${err.message}`);
      await supabase
        .from('sms_requests')
        .update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', req.id);
    }
  };

  const handleIncomingTelemetry = async (event) => {
    const payload = event?.payload || '';
    const sender = event?.senderNumber || 'Unknown';
    addLog(`📨 [3] Received input from lost mobile (${sender}): ${payload}`);

    let lat = null;
    let lng = null;
    let battery = null;
    let deviceId = '';
    let msgTime = Date.now();
    let rawPathPointsStr = '';

    if (payload.startsWith('MT1:')) {
      const body = payload.substring(4);
      const parts = body.split(':');
      if (parts.length >= 3) {
        deviceId = parts[1];
        if (parts[2] && parts[2] !== 'NO_LOC') {
          const coords = parts[2].split(',');
          const pLat = parseFloat(coords[0]);
          const pLng = parseFloat(coords[1]);
          if (!isNaN(pLat) && !isNaN(pLng)) {
            lat = pLat;
            lng = pLng;
          }
        }
        if (parts.length >= 4 && parts[3]) {
          const b = parseInt(parts[3], 10);
          if (!isNaN(b)) battery = b;
        }
        if (parts.length >= 5 && parts[4]) {
          const t = parseInt(parts[4], 10);
          if (!isNaN(t) && t > 0) msgTime = t;
        }
        if (parts.length >= 6 && parts[5]) {
          rawPathPointsStr = parts.slice(5).join(':');
        }
      }
    } else if (payload.startsWith('MTP:')) {
      const body = payload.substring(4);
      const parts = body.split(':');
      if (parts.length >= 3) {
        deviceId = parts[1];
        rawPathPointsStr = parts.slice(2).join(':');
      }
    } else {
      const coordMatch = payload.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
      if (coordMatch) {
        lat = parseFloat(coordMatch[1]);
        lng = parseFloat(coordMatch[2]);
      }
      const batMatch = payload.match(/(\d+)%/);
      if (batMatch) {
        battery = parseInt(batMatch[1], 10);
      }
    }

    // Resolve target device ID and base integer coordinates for reconstruction
    let targetDeviceId = deviceId;
    let baseLatInt = 12; // Bangalore / South India fallback
    let baseLngInt = 77;

    try {
      let devQuery = supabase.from('devices').select('id, last_known_location');
      if (deviceId && deviceId !== 'device' && deviceId !== 'unknown_device') {
        devQuery = devQuery.eq('id', deviceId);
      } else {
        const cleanSender = sender.replace(/\s+/g, '').replace(/^\+91/, '');
        devQuery = devQuery.or(`mobile_number.eq.${sender},mobile_number.eq.+91${cleanSender},mobile_number.eq.${cleanSender}`);
      }
      const { data: matchedDev } = await devQuery.maybeSingle();
      if (matchedDev) {
        if (!targetDeviceId || targetDeviceId === 'device' || targetDeviceId === 'unknown_device') {
          targetDeviceId = matchedDev.id;
        }
        if (matchedDev.last_known_location?.latitude) {
          baseLatInt = Math.floor(Math.abs(matchedDev.last_known_location.latitude)) * (matchedDev.last_known_location.latitude < 0 ? -1 : 1);
          baseLngInt = Math.floor(Math.abs(matchedDev.last_known_location.longitude)) * (matchedDev.last_known_location.longitude < 0 ? -1 : 1);
        }
      }
    } catch (_) {}

    if (lat !== null && !isNaN(lat)) {
      baseLatInt = Math.floor(Math.abs(lat)) * (lat < 0 ? -1 : 1);
      baseLngInt = Math.floor(Math.abs(lng)) * (lng < 0 ? -1 : 1);
    }

    // Parse compressed path history points: e.g. ".9712,.5940,15;.9716,.5946,10;.9721,.5951,5"
    const parsedPathPoints = [];
    if (rawPathPointsStr) {
      const items = rawPathPointsStr.split(';');
      for (const item of items) {
        const trimmed = item.trim();
        if (!trimmed) continue;
        const pParts = trimmed.split(',');
        if (pParts.length >= 2) {
          let ptLat = parseFloat(pParts[0]);
          let ptLng = parseFloat(pParts[1]);
          const diffMin = pParts.length >= 3 ? parseInt(pParts[2], 10) || 0 : 0;

          if (!isNaN(ptLat) && !isNaN(ptLng)) {
            // If first two digits were omitted (e.g. ".9712" or value < 1)
            if (Math.abs(ptLat) < 1) {
              ptLat = (baseLatInt >= 0 ? 1 : -1) * (Math.abs(baseLatInt) + Math.abs(ptLat));
            }
            if (Math.abs(ptLng) < 1) {
              ptLng = (baseLngInt >= 0 ? 1 : -1) * (Math.abs(baseLngInt) + Math.abs(ptLng));
            }

            const ptTime = msgTime - (diffMin * 60 * 1000);
            parsedPathPoints.push({
              latitude: parseFloat(ptLat.toFixed(5)),
              longitude: parseFloat(ptLng.toFixed(5)),
              timestamp: ptTime
            });
          }
        }
      }
    }

    // Insert parsed path points into offline_gps_history
    if (parsedPathPoints.length > 0 && targetDeviceId && targetDeviceId !== 'device') {
      addLog(`🗺️ [4] Inserting ${parsedPathPoints.length} path waypoints into offline_gps_history...`);
      try {
        const rows = parsedPathPoints.map(pt => ({
          device_id: targetDeviceId,
          latitude: pt.latitude,
          longitude: pt.longitude,
          timestamp: pt.timestamp
        }));
        const { error: pathErr } = await supabase.from('offline_gps_history').insert(rows);
        if (pathErr) {
          addLog(`⚠️ [4] Path history insert warning: ${pathErr.message}`);
        } else {
          addLog(`✅ [4] Successfully synced ${parsedPathPoints.length} path waypoints to website!`);
        }
      } catch (e) {
        addLog(`⚠️ [4] Path insert error: ${e.message}`);
      }
    }

    // Fallback: If current location was missing but path points exist, use latest path point
    if (lat === null && parsedPathPoints.length > 0) {
      const latestPt = parsedPathPoints[parsedPathPoints.length - 1];
      lat = latestPt.latitude;
      lng = latestPt.longitude;
    }

    if (lat !== null && lng !== null) {
      const batVal = isNaN(battery) || battery === null ? 50 : battery;
      addLog(`📍 Location Parsed: Lat ${lat.toFixed(5)}, Lng ${lng.toFixed(5)}, Battery: ${batVal}%`);
      setLatestLocation({
        latitude: lat,
        longitude: lng,
        battery: batVal,
        timestamp: new Date().toLocaleTimeString(),
        sender,
      });

      addLog(`🌐 [4] Updating in website: Pushing coordinates and battery to Supabase...`);
      try {
        let updateQuery = supabase.from('devices').update({
          last_known_location: {
            latitude: lat,
            longitude: lng,
            accuracy: 10,
            timestamp: msgTime
          },
          battery_level: batVal,
          last_seen_at: new Date().toISOString(),
          location_active: true
        });

        if (targetDeviceId && targetDeviceId !== 'device' && targetDeviceId !== 'unknown_device') {
          updateQuery = updateQuery.eq('id', targetDeviceId);
        } else {
          const cleanSender = sender.replace(/\s+/g, '').replace(/^\+91/, '');
          updateQuery = updateQuery.or(`mobile_number.eq.${sender},mobile_number.eq.+91${cleanSender},mobile_number.eq.${cleanSender}`);
        }

        const { error: devError } = await updateQuery;
        if (devError) {
          addLog(`❌ [4] FAILED: Updating devices table failed - ${devError.message}`);
        } else {
          addLog(`✅ [4] Successfully updated website devices table with fresh GPS!`);
        }

        let reqUpdateQuery = supabase
          .from('sms_requests')
          .update({ status: 'completed', updated_at: new Date().toISOString() })
          .eq('status', 'sent');

        const cleanSender = sender.replace(/\s+/g, '').replace(/^\+91/, '');
        if (targetDeviceId && targetDeviceId !== 'device' && targetDeviceId !== 'unknown_device') {
          reqUpdateQuery = reqUpdateQuery.or(`target_device_id.eq.${targetDeviceId},target_phone_number.eq.${sender},target_phone_number.eq.+91${cleanSender},target_phone_number.eq.${cleanSender}`);
        } else {
          reqUpdateQuery = reqUpdateQuery.or(`target_phone_number.eq.${sender},target_phone_number.eq.+91${cleanSender},target_phone_number.eq.${cleanSender}`);
        }

        const { error: reqError } = await reqUpdateQuery;
        if (reqError) {
          addLog(`⚠️ [4] Failed to mark request completed: ${reqError.message}`);
        } else {
          addLog(`✅ [4] Marked SMS tracking request for ${targetDeviceId || sender} as completed.`);
        }
      } catch (err) {
        addLog(`❌ [4] FAILED: Updating website exception - ${err.message}`);
      }
    } else {
      addLog(`⚠️ [3] No valid coordinates could be parsed from payload.`);
    }
  };

  useEffect(() => {
    addLog('🚀 Relay Server Starting...');

    // Request permissions safely after mount
    setTimeout(() => {
      checkOrRequestPermissions();
    }, 500);

    // 1. Supabase Realtime Listener on sms_requests table
    const channel = supabase
      .channel('sms_requests_relay_channel')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'sms_requests' },
        (payload) => {
          const req = payload.new;
          if (req && req.status === 'pending') {
            handlePendingRequest(req);
          }
        }
      )
      .subscribe((status) => {
        addLog(`📡 Realtime Channel Status: ${status}`);
      });

    // 2. Polling Fallback: checks for pending requests every 4 seconds
    const interval = setInterval(async () => {
      try {
        const { data, error } = await supabase
          .from('sms_requests')
          .select('*')
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(1);

        if (data && data.length > 0) {
          handlePendingRequest(data[0]);
        }
      } catch (_) {}
    }, 4000);

    // 3. Native SMS Telemetry Listener (messages from lost mobile)
    let sub = null;
    try {
      sub = SmsGateway.addSmsTelemetryListener(handleIncomingTelemetry);
    } catch (e) {
      addLog(`⚠️ Warning adding SMS listener: ${e.message}`);
    }

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
      if (sub && typeof sub.remove === 'function') {
        sub.remove();
      }
    };
  }, []);

  const getLogStyle = (msg) => {
    if (msg.includes('FAILED') || msg.includes('❌') || msg.includes('Error')) {
      return styles.logError;
    }
    if (msg.includes('[1]') || msg.includes('Input received')) {
      return styles.logWebIn;
    }
    if (msg.includes('[2]') || msg.includes('Sending to lost mobile')) {
      return styles.logSmsOut;
    }
    if (msg.includes('[3]') || msg.includes('Received input')) {
      return styles.logSmsIn;
    }
    if (msg.includes('[4]') || msg.includes('Updating in website')) {
      return styles.logWebSync;
    }
    return styles.logNormal;
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>⚡ MOBTRACK RELAY SERVER</Text>
          <View style={styles.statusBadge}>
            <View style={styles.statusDot} />
            <Text style={styles.statusText}>ACTIVE</Text>
          </View>
        </View>
        <Text style={styles.headerSubtitle}>Bridge between Web & Offline Lost Mobile</Text>
      </View>

      {/* Permission Warning Banner if not granted */}
      {!permissionsGranted && (
        <TouchableOpacity style={styles.permBanner} onPress={checkOrRequestPermissions}>
          <Text style={styles.permBannerText}>⚠️ SMS PERMISSIONS REQUIRED: Tap here to grant</Text>
        </TouchableOpacity>
      )}

      {/* Latest Relayed Location Card */}
      {latestLocation && (
        <View style={styles.locationCard}>
          <View style={styles.locationHeaderRow}>
            <Text style={styles.locationTitle}>📍 LATEST RELAYED LOCATION</Text>
            <Text style={styles.batteryBadge}>⚡ {latestLocation.battery}%</Text>
          </View>
          <Text style={styles.coordsText}>
            {latestLocation.latitude.toFixed(6)}, {latestLocation.longitude.toFixed(6)}
          </Text>
          <View style={styles.locationMetaRow}>
            <Text style={styles.metaText}>From: {latestLocation.sender}</Text>
            <Text style={styles.metaText}>Time: {latestLocation.timestamp}</Text>
          </View>
          <TouchableOpacity
            style={styles.mapBtn}
            onPress={() => {
              const url = `https://www.google.com/maps/search/?api=1&query=${latestLocation.latitude},${latestLocation.longitude}`;
              Linking.openURL(url).catch(() => {});
            }}
          >
            <Text style={styles.mapBtnText}>🗺️ VIEW ON GOOGLE MAPS</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Action Bar */}
      <View style={styles.actionBar}>
        <Text style={styles.sectionTitle}>SERVER ACTIVITY LOGS</Text>
        <TouchableOpacity style={styles.clearBtn} onPress={() => setLogs([])}>
          <Text style={styles.clearBtnText}>CLEAR LOGS</Text>
        </TouchableOpacity>
      </View>

      {/* Live Logs List */}
      <FlatList
        data={logs}
        keyExtractor={(item) => item.id}
        style={styles.list}
        contentContainerStyle={{ paddingBottom: 20 }}
        renderItem={({ item }) => (
          <View style={styles.logRow}>
            <Text style={styles.logTime}>[{item.time}]</Text>
            <Text style={[styles.logMsg, getLogStyle(item.msg)]} selectable>
              {item.msg}
            </Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#141414',
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    color: '#00ff88',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 1,
  },
  headerSubtitle: {
    color: '#777',
    fontSize: 11,
    marginTop: 4,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#003318',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#00aa55',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#00ff88',
    marginRight: 5,
  },
  statusText: {
    color: '#00ff88',
    fontSize: 10,
    fontWeight: 'bold',
  },
  permBanner: {
    backgroundColor: '#663300',
    padding: 10,
    marginHorizontal: 12,
    marginTop: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ff9900',
  },
  permBannerText: {
    color: '#ffcc00',
    fontSize: 12,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  locationCard: {
    backgroundColor: '#121e16',
    marginHorizontal: 12,
    marginTop: 10,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#00aa55',
  },
  locationHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  locationTitle: {
    color: '#00ff88',
    fontSize: 12,
    fontWeight: 'bold',
  },
  batteryBadge: {
    color: '#00ff88',
    fontSize: 12,
    fontWeight: 'bold',
    backgroundColor: '#003318',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  coordsText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier',
    marginVertical: 4,
  },
  locationMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  metaText: {
    color: '#888',
    fontSize: 11,
  },
  mapBtn: {
    backgroundColor: '#006633',
    paddingVertical: 6,
    borderRadius: 4,
    alignItems: 'center',
  },
  mapBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: 'bold',
  },
  actionBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  sectionTitle: {
    color: '#666',
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  clearBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: '#222',
    borderRadius: 4,
  },
  clearBtnText: {
    color: '#aaa',
    fontSize: 10,
  },
  list: {
    flex: 1,
    paddingHorizontal: 10,
  },
  logRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#161616',
    alignItems: 'flex-start',
  },
  logTime: {
    color: '#555',
    fontSize: 11,
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier',
    marginRight: 6,
    marginTop: 1,
  },
  logMsg: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier',
  },
  logNormal: {
    color: '#ccc',
  },
  logWebIn: {
    color: '#ffcc00', // Yellow for incoming web request
  },
  logSmsOut: {
    color: '#33bbff', // Cyan for outgoing SMS to lost phone
  },
  logSmsIn: {
    color: '#ff66cc', // Magenta for incoming SMS from lost phone
  },
  logWebSync: {
    color: '#00ff88', // Green for web update
  },
  logError: {
    color: '#ff4444', // Red for errors
    fontWeight: 'bold',
  },
});
