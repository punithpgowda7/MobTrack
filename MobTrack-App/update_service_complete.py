# -*- coding: utf-8 -*-
code = """package expo.modules.fakeshutdown

import android.accessibilityservice.AccessibilityService
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.media.AudioManager
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.Vibrator
import android.os.VibratorManager
import android.speech.tts.TextToSpeech
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager
import android.view.Gravity
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import java.util.Locale

/**
 * FakeShutdownAccessibilityService
 *
 * Provides:
 *  1. Realistic "Fake Power Off / Restart" overlay intercepting power menu.
 *  2. 100% OFFLINE SIM Card Removal Alarm (detects SIM removal immediately via
 *     TelephonyManager + SubscriptionManager + background polling, blasts max volume
 *     siren + TTS "THIS DEVICE IS STOLEN. CATCH THE THIEF.", lock volume against mute,
 *     and unlocks ONLY via secret sequence).
 */
class FakeShutdownAccessibilityService : AccessibilityService() {

    companion object {
        private const val PKG = "expo.modules.fakeshutdown"
        const val ACTION_SHOW            = "$PKG.SHOW"
        const val ACTION_HIDE            = "$PKG.HIDE"
        const val ACTION_UPDATE_SEQUENCE = "$PKG.UPDATE_SEQUENCE"
        const val ACTION_START_ALARM     = "$PKG.START_ALARM"
        const val ACTION_STOP_ALARM      = "$PKG.STOP_ALARM"
        const val EXTRA_SEQUENCE         = "unlockSequence"

        /** Milliseconds the power button must be held before we intercept. */
        private const val LONG_PRESS_MS = 650L
    }

    private val handler = Handler(Looper.getMainLooper())
    private var wm: WindowManager? = null
    private var overlayRoot: FrameLayout? = null
    private var overlayParams: WindowManager.LayoutParams? = null
    private var wakeLock: PowerManager.WakeLock? = null

    @Volatile private var featureEnabled  = false
    @Volatile private var isOverlayShowing = false
    @Volatile private var isAlarmActive = false
    @Volatile private var unlockSequence: List<String> = listOf("volUp", "volDown")
    private val pressedButtons = mutableListOf<String>()

    // TTS and Alarm Sound
    private var tts: TextToSpeech? = null
    private var isTtsReady = false
    private var alarmRingtone: Ringtone? = null
    private var alarmRunnable: Runnable? = null

    // Offline SIM Monitoring
    @Volatile private var simEverPresent = false
    private var subChangeListener: Any? = null
    private var simBroadcastReceiver: BroadcastReceiver? = null

    // Config receiver

    private val configReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: Intent) {
            when (intent.action) {
                ACTION_SHOW -> {
                    featureEnabled = true
                    intent.getStringArrayListExtra(EXTRA_SEQUENCE)?.let { seq ->
                        if (seq.isNotEmpty()) {
                            unlockSequence = seq.toList()
                            pressedButtons.clear()
                        }
                    }
                    checkSimInitial()
                }
                ACTION_HIDE -> {
                    featureEnabled = false
                    handler.post { 
                        dismissOverlay()
                        stopAlarm()
                    }
                }
                ACTION_START_ALARM -> {
                    if (!isAlarmActive) startAlarm()
                }
                ACTION_STOP_ALARM -> {
                    stopAlarm()
                }
                ACTION_UPDATE_SEQUENCE -> {
                    intent.getStringArrayListExtra(EXTRA_SEQUENCE)?.let { seq ->
                        if (seq.isNotEmpty()) {
                            unlockSequence = seq.toList()
                            pressedButtons.clear()
                        }
                    }
                }
            }
        }
    }

    // Service lifecycle

    override fun onServiceConnected() {
        wm = getSystemService(WINDOW_SERVICE) as WindowManager
        
        val filter = IntentFilter().apply {
            addAction(ACTION_SHOW)
            addAction(ACTION_HIDE)
            addAction(ACTION_START_ALARM)
            addAction(ACTION_STOP_ALARM)
            addAction(ACTION_UPDATE_SEQUENCE)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(configReceiver, filter, RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            registerReceiver(configReceiver, filter)
        }

        initTts()
        startOfflineSimMonitor()
    }

    private fun initTts() {
        try {
            tts = TextToSpeech(applicationContext) { status ->
                if (status == TextToSpeech.SUCCESS) {
                    tts?.language = Locale.US
                    tts?.setSpeechRate(0.95f)
                    tts?.setPitch(1.05f)
                    isTtsReady = true
                }
            }
        } catch (_: Exception) {}
    }

    // Offline SIM Detection

    private fun checkSimInitial() {
        try {
            val tm = getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
            if (tm != null) {
                val state = tm.simState
                if (state != TelephonyManager.SIM_STATE_ABSENT && state != TelephonyManager.SIM_STATE_UNKNOWN) {
                    simEverPresent = true
                }
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP_MR1) {
                val sm = getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE) as? SubscriptionManager
                if (sm != null) {
                    val count = sm.activeSubscriptionInfoCount
                    if (count > 0) {
                        simEverPresent = true
                    }
                }
            }
        } catch (_: Exception) {}
    }

    private fun isSimAbsent(): Boolean {
        try {
            val tm = getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
            if (tm != null) {
                val state = tm.simState
                if (state == TelephonyManager.SIM_STATE_ABSENT) {
                    return true
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    val s0 = tm.getSimState(0)
                    val s1 = tm.getSimState(1)
                    val is0Absent = (s0 == TelephonyManager.SIM_STATE_ABSENT || s0 == TelephonyManager.SIM_STATE_UNKNOWN)
                    val is1Absent = (s1 == TelephonyManager.SIM_STATE_ABSENT || s1 == TelephonyManager.SIM_STATE_UNKNOWN)
                    if (is0Absent && is1Absent && simEverPresent) {
                        return true
                    }
                }
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP_MR1) {
                val sm = getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE) as? SubscriptionManager
                if (sm != null) {
                    val count = sm.activeSubscriptionInfoCount
                    if (count == 0 && simEverPresent) {
                        return true
                    }
                }
            }
        } catch (_: Exception) {}
        return false
    }

    private fun startOfflineSimMonitor() {
        checkSimInitial()

        // 1. Subscription change listener (Android 5.1+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP_MR1) {
            try {
                val sm = getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE) as? SubscriptionManager
                if (sm != null) {
                    val listener = object : SubscriptionManager.OnSubscriptionsChangedListener() {
                        override fun onSubscriptionsChanged() {
                            super.onSubscriptionsChanged()
                            if (featureEnabled && !isAlarmActive) {
                                if (!simEverPresent) {
                                    checkSimInitial()
                                } else if (isSimAbsent()) {
                                    handler.post { startAlarm() }
                                }
                            }
                        }
                    }
                    subChangeListener = listener
                    sm.addOnSubscriptionsChangedListener(listener)
                }
            } catch (_: Exception) {}
        }

        // 2. Broadcast receiver for SIM state changes
        try {
            val filter = IntentFilter().apply {
                addAction("android.intent.action.SIM_STATE_CHANGED")
                addAction("android.telephony.action.SIM_CARD_STATE_CHANGED")
                addAction("android.telephony.action.SIM_APPLICATION_STATE_CHANGED")
                addAction("android.intent.action.ACTION_SUBINFO_RECORD_UPDATED")
            }
            simBroadcastReceiver = object : BroadcastReceiver() {
                override fun onReceive(context: Context?, intent: Intent?) {
                    if (featureEnabled && !isAlarmActive) {
                        if (!simEverPresent) {
                            checkSimInitial()
                        } else if (isSimAbsent()) {
                            handler.post { startAlarm() }
                        }
                    }
                }
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(simBroadcastReceiver, filter, Context.RECEIVER_EXPORTED)
            } else {
                @Suppress("UnspecifiedRegisterReceiverFlag")
                registerReceiver(simBroadcastReceiver, filter)
            }
        } catch (_: Exception) {}

        // 3. Fast offline polling check (every 750ms)
        handler.post(simPollingRunnable)
    }

    private val simPollingRunnable = object : Runnable {
        override fun run() {
            if (featureEnabled && !isAlarmActive) {
                if (!simEverPresent) {
                    checkSimInitial()
                } else if (isSimAbsent()) {
                    startAlarm()
                }
            }
            handler.postDelayed(this, 750)
        }
    }

    // Loud Siren + Voice Alarm

    private fun startAlarm() {
        if (isAlarmActive) return
        isAlarmActive = true
        pressedButtons.clear()
        acquireWakeLock()

        // 1. Force ringtone siren to start
        try {
            val alertUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            alarmRingtone = RingtoneManager.getRingtone(applicationContext, alertUri)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                alarmRingtone?.isLooping = true
            }
            alarmRingtone?.play()
        } catch (_: Exception) {}

        // 2. Loop maximum volume & speak voice alert
        alarmRunnable = object : Runnable {
            override fun run() {
                if (!isAlarmActive) return
                try {
                    val am = getSystemService(AUDIO_SERVICE) as AudioManager
                    
                    // Force maximum volume across all audio streams
                    val streams = listOf(
                        AudioManager.STREAM_MUSIC,
                        AudioManager.STREAM_ALARM,
                        AudioManager.STREAM_RING,
                        AudioManager.STREAM_NOTIFICATION,
                        AudioManager.STREAM_SYSTEM
                    )
                    for (s in streams) {
                        try {
                            val max = am.getStreamMaxVolume(s)
                            am.setStreamVolume(s, max, 0)
                        } catch (_: Exception) {}
                    }

                    try {
                        am.ringerMode = AudioManager.RINGER_MODE_NORMAL
                    } catch (_: Exception) {}

                    // Voice announcement
                    if (tts != null && isTtsReady) {
                        if (tts?.isSpeaking == false) {
                            tts?.speak(
                                "Attention! This device is stolen. Catch the thief!",
                                TextToSpeech.QUEUE_FLUSH,
                                null,
                                "STOLEN_VOICE_ALERT"
                            )
                        }
                    }

                    // Keep alarm sound ringing
                    if (alarmRingtone?.isPlaying == false) {
                        alarmRingtone?.play()
                    }
                } catch (_: Exception) {}
                handler.postDelayed(this, 1200)
            }
        }
        handler.post(alarmRunnable!!)
    }

    private fun stopAlarm() {
        isAlarmActive = false
        alarmRunnable?.let { handler.removeCallbacks(it) }
        alarmRunnable = null
        try { alarmRingtone?.stop() } catch (_: Exception) {}
        try { tts?.stop() } catch (_: Exception) {}
        releaseWakeLock()
    }

    // Power Menu Interception via Accessibility Events

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        if (!featureEnabled) return
        if (isOverlayShowing) return

        if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            val pkg = event.packageName?.toString() ?: ""
            val cls = event.className?.toString() ?: ""
            val text = event.text.toString()

            val isSystemUi = pkg == "com.android.systemui" || pkg == "android"
            val isGlobalActions = cls.contains("GlobalActions", ignoreCase = true) || 
                                  cls.contains("globalactions", ignoreCase = true)
            val containsPowerText = text.contains("Power off", ignoreCase = true) || 
                                    text.contains("Restart", ignoreCase = true) ||
                                    text.contains("Shut down", ignoreCase = true)

            if (isSystemUi && (isGlobalActions || containsPowerText)) {
                performGlobalAction(GLOBAL_ACTION_BACK)
                handler.post { showFakePowerMenu() }
            }
        }
    }
    
    override fun onInterrupt() {}

    override fun onDestroy() {
        super.onDestroy()
        stopAlarm()
        stopAggressiveMute()
        handler.removeCallbacks(simPollingRunnable)
        try { unregisterReceiver(configReceiver) } catch (_: Exception) {}
        try { simBroadcastReceiver?.let { unregisterReceiver(it) } } catch (_: Exception) {}
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP_MR1) {
            try {
                val sm = getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE) as? SubscriptionManager
                (subChangeListener as? SubscriptionManager.OnSubscriptionsChangedListener)?.let {
                    sm?.removeOnSubscriptionsChangedListener(it)
                }
            } catch (_: Exception) {}
        }
        try {
            tts?.stop()
            tts?.shutdown()
        } catch (_: Exception) {}
        handler.post { dismissOverlay() }
        releaseWakeLock()
    }

    // Key event interception

    override fun onKeyEvent(event: KeyEvent): Boolean {
        // While overlay is showing OR alarm is sounding, consume all key events and track sequence
        if (isOverlayShowing || isAlarmActive) {
            if (event.action == KeyEvent.ACTION_DOWN) {
                when (event.keyCode) {
                    KeyEvent.KEYCODE_VOLUME_UP   -> { recordButtonPress("volUp");   return true }
                    KeyEvent.KEYCODE_VOLUME_DOWN -> { recordButtonPress("volDown"); return true }
                    KeyEvent.KEYCODE_BACK        -> return true
                    KeyEvent.KEYCODE_POWER       -> { recordButtonPress("power");   return true }
                    KeyEvent.KEYCODE_HOME        -> return true
                    KeyEvent.KEYCODE_APP_SWITCH  -> return true
                }
            }
            if (event.action == KeyEvent.ACTION_UP) {
                when (event.keyCode) {
                    KeyEvent.KEYCODE_VOLUME_UP,
                    KeyEvent.KEYCODE_VOLUME_DOWN,
                    KeyEvent.KEYCODE_BACK,
                    KeyEvent.KEYCODE_POWER,
                    KeyEvent.KEYCODE_HOME,
                    KeyEvent.KEYCODE_APP_SWITCH -> return true
                }
            }
            return true
        }

        return false
    }

    // Wake lock

    @Suppress("DEPRECATION")
    private fun acquireWakeLock() {
        releaseWakeLock()
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(
            PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP,
            "mobtrack:fakeshutdown_acc"
        )
        wakeLock?.acquire(60 * 60 * 1000L)
    }

    private fun releaseWakeLock() {
        try { if (wakeLock?.isHeld == true) wakeLock?.release() } catch (_: Exception) {}
        wakeLock = null
    }

    // Show fake power menu

    private fun showFakePowerMenu() {
        if (isOverlayShowing) return
        val windowManager = wm ?: return

        acquireWakeLock()
        isOverlayShowing = true
        pressedButtons.clear()

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                    WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
                    WindowManager.LayoutParams.FLAG_FULLSCREEN or
                    WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
                    WindowManager.LayoutParams.FLAG_SECURE,
            PixelFormat.OPAQUE
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            screenBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
        }
        overlayParams = params

        val root = object : FrameLayout(this) {
            override fun onTouchEvent(e: MotionEvent): Boolean = true
        }
        root.setBackgroundColor(Color.BLACK)
        root.isFocusable            = true
        root.isFocusableInTouchMode = true
        root.keepScreenOn           = true

        root.addView(View(this).apply { setBackgroundColor(Color.BLACK) },
            FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, dp(120), Gravity.TOP))

        root.addView(View(this).apply { setBackgroundColor(Color.BLACK) },
            FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, dp(80), Gravity.BOTTOM))

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = GradientDrawable().apply {
                shape         = GradientDrawable.RECTANGLE
                cornerRadius  = dp(24).toFloat()
                setColor(Color.parseColor("#1C1C1E"))
            }
            setPadding(dp(8), dp(12), dp(8), dp(12))
            elevation = dp(16).toFloat()
        }

        val powerOffRow = buildMenuRow("Power off",  Color.parseColor("#FF453A"))
        val restartRow  = buildMenuRow("Restart",    Color.parseColor("#30D158"))
        val divider = View(this).apply { setBackgroundColor(Color.parseColor("#38383A")) }

        card.addView(powerOffRow)
        card.addView(divider, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 1
        ).apply { marginStart = dp(20); marginEnd = dp(20); topMargin = dp(4); bottomMargin = dp(4) })
        card.addView(restartRow)

        val cardLp = FrameLayout.LayoutParams(dp(260), FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER)
        root.addView(card, cardLp)

        val statusTv = TextView(this).apply {
            textSize  = 15f
            setTextColor(Color.WHITE)
            gravity   = Gravity.CENTER
            alpha     = 0f
        }
        root.addView(statusTv, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.CENTER
        ))

        overlayRoot = root

        try {
            windowManager.addView(root, params)
            root.requestFocus()
        } catch (e: Exception) {
            isOverlayShowing = false
            overlayRoot      = null
            overlayParams    = null
            releaseWakeLock()
            return
        }

        powerOffRow.setOnClickListener {
            onChoiceMade(card, statusTv, "Powering off...", windowManager)
        }
        restartRow.setOnClickListener {
            onChoiceMade(card, statusTv, "Restarting...", windowManager)
        }
    }

    private fun buildMenuRow(label: String, iconColor: Int): LinearLayout {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity     = Gravity.CENTER_VERTICAL
            isClickable = true
            isFocusable = true
            setPadding(dp(20), dp(18), dp(20), dp(18))
            background = GradientDrawable().apply {
                shape        = GradientDrawable.RECTANGLE
                cornerRadius = dp(14).toFloat()
                setColor(Color.TRANSPARENT)
            }
        }

        val circle = FrameLayout(this).apply {
            background = GradientDrawable().apply {
                shape    = GradientDrawable.OVAL
                setColor(Color.parseColor("#2C2C2E"))
            }
            minimumWidth  = dp(52)
            minimumHeight = dp(52)
        }
        val iconTv = TextView(this).apply {
            text      = if (label.startsWith("Power")) "OFF" else "RE"
            textSize  = 16f
            setTextColor(iconColor)
            gravity   = Gravity.CENTER
        }
        circle.addView(iconTv, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT,
            Gravity.CENTER
        ))
        row.addView(circle, LinearLayout.LayoutParams(dp(52), dp(52)))

        val labelTv = TextView(this).apply {
            text      = label
            textSize  = 18f
            setTextColor(Color.WHITE)
            setPadding(dp(18), 0, 0, 0)
        }
        row.addView(labelTv)
        return row
    }

    private fun onChoiceMade(
        card: LinearLayout,
        statusTv: TextView,
        message: String,
        wm: WindowManager
    ) {
        startAggressiveMute()

        card.animate().alpha(0f).setDuration(180).withEndAction {
            card.visibility = View.GONE

            statusTv.text = message
            statusTv.animate().alpha(1f).setDuration(350).withEndAction {
                handler.postDelayed({
                    try {
                        overlayParams?.let { p ->
                            p.screenBrightness = 0.01f
                            wm.updateViewLayout(overlayRoot, p)
                        }
                    } catch (_: Exception) {}
                    statusTv.animate().alpha(0f).setDuration(700).start()
                }, 1400)
            }.start()
        }.start()
    }

    // Aggressive Audio & Vibration Muting

    private var muteRunnable: Runnable? = null

    private fun startAggressiveMute() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val nm = getSystemService(NOTIFICATION_SERVICE) as? NotificationManager
                if (nm?.isNotificationPolicyAccessGranted == true) {
                    nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_NONE)
                }
            }
        } catch (_: Exception) {}

        muteRunnable = object : Runnable {
            override fun run() {
                if (!isOverlayShowing) return
                muteAllAudioTick()
                handler.postDelayed(this, 200)
            }
        }
        handler.post(muteRunnable!!)
    }

    private fun stopAggressiveMute() {
        muteRunnable?.let { handler.removeCallbacks(it) }
        muteRunnable = null
    }

    private fun muteAllAudioTick() {
        try {
            val am = getSystemService(AUDIO_SERVICE) as AudioManager
            val streams = listOf(
                AudioManager.STREAM_MUSIC,
                AudioManager.STREAM_RING,
                AudioManager.STREAM_ALARM,
                AudioManager.STREAM_NOTIFICATION,
                AudioManager.STREAM_SYSTEM,
                AudioManager.STREAM_VOICE_CALL,
                AudioManager.STREAM_DTMF
            )
            streams.forEach { stream ->
                try { 
                    am.setStreamVolume(stream, 0, 0)
                    am.adjustStreamVolume(stream, AudioManager.ADJUST_MUTE, 0)
                } catch (_: Exception) {}
            }

            try { am.ringerMode = AudioManager.RINGER_MODE_SILENT } catch (_: Exception) {}

            try {
                am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MEDIA_PAUSE))
                am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_MEDIA_PAUSE))
            } catch (_: Exception) {}

            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    (getSystemService(VIBRATOR_MANAGER_SERVICE) as? VibratorManager)
                        ?.defaultVibrator?.cancel()
                } else {
                    @Suppress("DEPRECATION")
                    (getSystemService(VIBRATOR_SERVICE) as? Vibrator)?.cancel()
                }
            } catch (_: Exception) {}

        } catch (_: Exception) {}
    }

    // Dismiss overlay

    private fun dismissOverlay() {
        if (!isOverlayShowing) return
        isOverlayShowing = false
        pressedButtons.clear()
        stopAggressiveMute()
        try { overlayRoot?.let { wm?.removeView(it) } } catch (_: Exception) {}
        overlayRoot   = null
        overlayParams = null
        
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val nm = getSystemService(NOTIFICATION_SERVICE) as? NotificationManager
                if (nm?.isNotificationPolicyAccessGranted == true) {
                    nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_ALL)
                }
            }
        } catch (_: Exception) {}

        releaseWakeLock()
    }

    // Unlock sequence tracking

    private fun recordButtonPress(button: String) {
        pressedButtons.add(button)
        val maxLen = unlockSequence.size.coerceAtLeast(1)
        while (pressedButtons.size > maxLen) pressedButtons.removeAt(0)
        if (pressedButtons.size == unlockSequence.size && pressedButtons == unlockSequence) {
            if (isOverlayShowing) dismissOverlay()
            if (isAlarmActive) stopAlarm()
        }
    }

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density).toInt()
}
"""

with open('modules/fake-shutdown/android/src/main/java/expo/modules/fakeshutdown/FakeShutdownAccessibilityService.kt', 'w', encoding='utf-8') as f:
    f.write(code)
print("Successfully updated FakeShutdownAccessibilityService.kt")
