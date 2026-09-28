import re

path = 'modules/fake-shutdown/android/src/main/java/expo/modules/fakeshutdown/FakeShutdownAccessibilityService.kt'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

alarm_funcs = '''
    // Alarm Logic
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
    content = content.rstrip()
    if content.endswith('}'):
        content = content[:-1] + alarm_funcs + '\\n}'

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
