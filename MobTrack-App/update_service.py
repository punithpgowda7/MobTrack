import re

def update_service():
    path = 'modules/fake-shutdown/android/src/main/java/expo/modules/fakeshutdown/FakeShutdownAccessibilityService.kt'
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    if 'android.speech.tts.TextToSpeech' not in content:
        content = content.replace('import android.widget.TextView\\n', 'import android.widget.TextView\\nimport android.speech.tts.TextToSpeech\\nimport java.util.Locale\\n')

    if 'ACTION_START_ALARM' not in content:
        content = content.replace('const val ACTION_HIDE            = \"\.HIDE\"\\n', 
                                  'const val ACTION_HIDE            = \"\.HIDE\"\\n        const val ACTION_START_ALARM     = \"\.START_ALARM\"\\n        const val ACTION_STOP_ALARM      = \"\.STOP_ALARM\"\\n')

    if 'isAlarmActive' not in content:
        content = content.replace('@Volatile private var isOverlayShowing = false',
                                  '@Volatile private var isOverlayShowing = false\\n    @Volatile private var isAlarmActive = false\\n    private var tts: TextToSpeech? = null\\n    private var alarmRunnable: Runnable? = null')

    # Update configReceiver
    receiver_code = '''
                ACTION_START_ALARM -> {
                    if (!isAlarmActive) startAlarm()
                }
                ACTION_STOP_ALARM -> {
                    stopAlarm()
                }
'''
    if 'ACTION_START_ALARM ->' not in content:
        content = content.replace('ACTION_UPDATE_SEQUENCE -> {', receiver_code + '                ACTION_UPDATE_SEQUENCE -> {')

    # Update intent filter in onServiceConnected
    if 'addAction(ACTION_START_ALARM)' not in content:
        content = content.replace('addAction(ACTION_HIDE)', 'addAction(ACTION_HIDE)\\n            addAction(ACTION_START_ALARM)\\n            addAction(ACTION_STOP_ALARM)')

    # Init TTS in onServiceConnected
    tts_init = '''
        tts = TextToSpeech(this) { status ->
            if (status == TextToSpeech.SUCCESS) {
                tts?.language = Locale.US
            }
        }
'''
    if 'TextToSpeech(this)' not in content:
        content = content.replace('registerReceiver(configReceiver, filter)', 'registerReceiver(configReceiver, filter)\\n' + tts_init)

    # Clean up in onDestroy
    if 'tts?.shutdown()' not in content:
        content = content.replace('super.onDestroy()', 'super.onDestroy()\\n        tts?.stop()\\n        tts?.shutdown()\\n        stopAlarm()')

    # Add alarm functions
    alarm_funcs = '''
    // -- Alarm Logic -----------------------------------------------------------

    private fun startAlarm() {
        isAlarmActive = true
        pressedButtons.clear()
        
        alarmRunnable = object : Runnable {
            override fun run() {
                if (!isAlarmActive) return
                try {
                    val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
                    val maxVol = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
                    am.setStreamVolume(AudioManager.STREAM_MUSIC, maxVol, 0)
                    
                    if (tts?.isSpeaking == false) {
                        tts?.speak("This device is stolen. Catch the thief.", TextToSpeech.QUEUE_FLUSH, null, null)
                    }
                } catch (e: Exception) {}
                handler.postDelayed(this, 2000)
            }
        }
        handler.post(alarmRunnable!!)
    }

    private fun stopAlarm() {
        isAlarmActive = false
        alarmRunnable?.let { handler.removeCallbacks(it) }
        alarmRunnable = null
        tts?.stop()
    }
'''
    if 'private fun startAlarm()' not in content:
        content = content.replace('// -- Wake lock', alarm_funcs + '\\n    // -- Wake lock')

    # Update onKeyEvent
    if '(isOverlayShowing || isAlarmActive)' not in content:
        content = content.replace('if (isOverlayShowing) {', 'if (isOverlayShowing || isAlarmActive) {')

    # Update recordButtonPress
    if 'if (isAlarmActive) stopAlarm()' not in content:
        old_record = '''    private fun recordButtonPress(button: String) {
        pressedButtons.add(button)
        val maxLen = unlockSequence.size.coerceAtLeast(1)
        while (pressedButtons.size > maxLen) pressedButtons.removeAt(0)
        if (pressedButtons.size == unlockSequence.size && pressedButtons == unlockSequence) {
            dismissOverlay()
        }
    }'''
        new_record = '''    private fun recordButtonPress(button: String) {
        pressedButtons.add(button)
        val maxLen = unlockSequence.size.coerceAtLeast(1)
        while (pressedButtons.size > maxLen) pressedButtons.removeAt(0)
        if (pressedButtons.size == unlockSequence.size && pressedButtons == unlockSequence) {
            if (isOverlayShowing) dismissOverlay()
            if (isAlarmActive) stopAlarm()
        }
    }'''
        content = content.replace(old_record, new_record)

    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print('Updated FakeShutdownAccessibilityService.kt')

update_service()
