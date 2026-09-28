package expo.modules.fakeshutdown

import android.accessibilityservice.AccessibilityService
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
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
import android.provider.Settings
import android.speech.tts.TextToSpeech
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager
import android.view.Gravity
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.util.Locale

/**
 * FakeShutdownAccessibilityService
 *
 * Provides:
 *  1. Realistic "Fake Power Off / Restart" overlay intercepting power menu.
 *  2. 100% OFFLINE SIM Card Removal Alarm.
 *  3. [NEW] Fake Factory Reset Overlay — triggered by holding Power+VolUp for 3 seconds.
 *     Shows pixel-perfect fake Android Recovery screen. Freezes phone visually.
 *     Mutes all audio, enables DND, maximises brightness.
 *     Exit only via configured secret button sequence.
 */
class FakeShutdownAccessibilityService : AccessibilityService() {

    companion object {
        private const val PKG = "expo.modules.fakeshutdown"
        const val ACTION_SHOW                    = "$PKG.SHOW"
        const val ACTION_HIDE                    = "$PKG.HIDE"
        const val ACTION_UPDATE_SEQUENCE         = "$PKG.UPDATE_SEQUENCE"
        const val ACTION_START_ALARM             = "$PKG.START_ALARM"
        const val ACTION_STOP_ALARM              = "$PKG.STOP_ALARM"
        const val ACTION_ENABLE_FACTORY_RESET    = "$PKG.ENABLE_FACTORY_RESET"
        const val ACTION_DISABLE_FACTORY_RESET   = "$PKG.DISABLE_FACTORY_RESET"
        const val EXTRA_SEQUENCE                 = "unlockSequence"
    }

    private val handler = Handler(Looper.getMainLooper())
    private var wm: WindowManager? = null
    private var overlayRoot: FrameLayout? = null
    private var overlayParams: WindowManager.LayoutParams? = null
    private var recoveryOverlayRoot: FrameLayout? = null
    private var wakeLock: PowerManager.WakeLock? = null

    @Volatile private var featureEnabled           = false
    @Volatile private var isOverlayShowing         = false
    @Volatile private var isRecoveryOverlayShowing = false
    @Volatile private var factoryResetEnabled      = false   // controlled by in-app toggle
    @Volatile private var isAlarmActive            = false
    @Volatile private var unlockSequence: List<String> = listOf("volUp", "volDown")
    private val pressedButtons = mutableListOf<String>()

    // Recovery Menu State
    enum class RecoveryState {
        MAIN_MENU,
        WIPE_CONFIRM,
        RESETTING,
        BLANK_SCREEN
    }
    private var currentRecoveryState = RecoveryState.MAIN_MENU
    private var recoverySelectedIndex = 0
    private val recoveryMenuRows = mutableListOf<LinearLayout>()
    private val recoveryMenuTextViews = mutableListOf<TextView>()

    // TTS and Alarm Sound
    private var tts: TextToSpeech? = null
    private var isTtsReady = false
    private var alarmRingtone: Ringtone? = null
    private var alarmRunnable: Runnable? = null

    // Offline SIM Monitoring
    @Volatile private var monitorStartTime = 0L
    @Volatile private var consecutiveAbsentCount = 0

    // ── Factory Reset Vol Up Tracker ────────────────────────────────────────
    // KEYCODE_POWER is NOT delivered to onKeyEvent() on Android 9+.
    //   and checks if volUpDownTime > 0 (Vol Up is ALSO held)   recovery screen.
    @Volatile private var volUpDownTime = 0L         // epoch ms, 0 = not held
    private var volUpHoldRunnable: Runnable? = null  // fires after 3s of sustained hold

    // ── Mute runnable ─────────────────────────────────────────────────────────
    private var muteRunnable: Runnable? = null

    // ── Saved state for restore ───────────────────────────────────────────────
    private var savedBrightness = -1

    // Config receiver
    private val lastGaspReceiver = LastGaspReceiver()

    private val configReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: Intent) {
            val prefs = ctx.getSharedPreferences("MobTrackPrefs", Context.MODE_PRIVATE)
            when (intent.action) {
                ACTION_SHOW -> {
                    featureEnabled = true
                    prefs.edit().putBoolean("featureEnabled", true).apply()
                    monitorStartTime = System.currentTimeMillis()
                    consecutiveAbsentCount = 0
                    intent.getStringArrayListExtra(EXTRA_SEQUENCE)?.let { seq ->
                        if (seq.isNotEmpty()) {
                            unlockSequence = seq.toList()
                            pressedButtons.clear()
                            prefs.edit().putString("unlockSequence", seq.joinToString(",")).apply()
                        }
                    }
                }
                ACTION_HIDE -> {
                    featureEnabled = false
                    prefs.edit().putBoolean("featureEnabled", false).apply()
                    handler.post {
                        dismissOverlay()
                        dismissRecoveryOverlay()
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
                            prefs.edit().putString("unlockSequence", seq.joinToString(",")).apply()
                        }
                    }
                }
                ACTION_ENABLE_FACTORY_RESET -> {
                    factoryResetEnabled = true
                    prefs.edit().putBoolean("fakeFactoryResetEnabled", true).apply()
                }
                ACTION_DISABLE_FACTORY_RESET -> {
                    factoryResetEnabled = false
                    prefs.edit().putBoolean("fakeFactoryResetEnabled", false).apply()
                    // If the recovery overlay is currently showing, dismiss it
                    handler.post { dismissRecoveryOverlay() }
                }
            }
        }
    }

    // Service lifecycle

    override fun onCreate() {
        super.onCreate()
        val prefs = getSharedPreferences("MobTrackPrefs", Context.MODE_PRIVATE)
        prefs.getString("unlockSequence", null)?.let { saved ->
            val list = saved.split(",").filter { it.isNotBlank() }
            if (list.isNotEmpty()) {
                unlockSequence = list
            }
        }
    }

    override fun onServiceConnected() {
        wm = getSystemService(WINDOW_SERVICE) as WindowManager

        // ── RESTORE PERSISTED STATE ──
        // Android may kill and restart this service at any time.
        // Without this, factoryResetEnabled resets to false and the feature is dead.
        val prefs = getSharedPreferences("MobTrackPrefs", Context.MODE_PRIVATE)
        factoryResetEnabled = prefs.getBoolean("fakeFactoryResetEnabled", false)
        featureEnabled = prefs.getBoolean("featureEnabled", false)
        prefs.getString("unlockSequence", null)?.let { saved ->
            val list = saved.split(",").filter { it.isNotBlank() }
            if (list.isNotEmpty()) {
                unlockSequence = list
            }
        }

        val filter = IntentFilter().apply {
            addAction(ACTION_SHOW)
            addAction(ACTION_HIDE)
            addAction(ACTION_START_ALARM)
            addAction(ACTION_STOP_ALARM)
            addAction(ACTION_UPDATE_SEQUENCE)
            addAction(ACTION_ENABLE_FACTORY_RESET)
            addAction(ACTION_DISABLE_FACTORY_RESET)
        }
        val batteryFilter = IntentFilter().apply {
            addAction(Intent.ACTION_BATTERY_LOW)
            addAction(Intent.ACTION_BATTERY_CHANGED)
            addAction("expo.modules.fakeshutdown.CHECK_LAST_GASP")
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(configReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
            registerReceiver(lastGaspReceiver, batteryFilter, Context.RECEIVER_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            registerReceiver(configReceiver, filter)
            @Suppress("UnspecifiedRegisterReceiverFlag")
            registerReceiver(lastGaspReceiver, batteryFilter)
        }

        initTts()
        startOfflineSimMonitor()
        registerScreenshotObserver()
        registerScreenOffReceiver()
    }

    // ── Screen-Off Receiver ──────────────────────────────────────────────────
    // Power button cannot be consumed by accessibility services. Android turns
    // the screen off regardless. This receiver catches that event and instantly
    // re-acquires the wake lock (ACQUIRE_CAUSES_WAKEUP) to force the screen
    // back on, making the power button appear to do nothing while the recovery
    // or shutdown overlay is active.
    private var screenOffReceiver: BroadcastReceiver? = null

    private fun registerScreenOffReceiver() {
        if (screenOffReceiver != null) return
        screenOffReceiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, intent: Intent) {
                if (intent.action == Intent.ACTION_SCREEN_OFF) {
                    if (isRecoveryOverlayShowing || isOverlayShowing) {
                        // Force the screen right back on
                        acquireWakeLock()
                        
                        if (isRecoveryOverlayShowing) {
                            recordButtonPress("power")
                            
                            // Ignore if this screen off might have been caused by taking a screenshot (Power + VolDown)
                            if (System.currentTimeMillis() - volUpDownTime < 1000) return

                            if (currentRecoveryState == RecoveryState.MAIN_MENU) {
                                if (recoverySelectedIndex == 4) { // "Wipe data/factory reset"
                                    currentRecoveryState = RecoveryState.WIPE_CONFIRM
                                    recoverySelectedIndex = 0
                                    handler.post { showWipeConfirmScreen() }
                                }
                            } else if (currentRecoveryState == RecoveryState.WIPE_CONFIRM) {
                                if (recoverySelectedIndex == 0) { // "Cancel"
                                    currentRecoveryState = RecoveryState.MAIN_MENU
                                    recoverySelectedIndex = 4
                                    handler.post { showMainRecoveryScreen() }
                                } else if (recoverySelectedIndex == 1) { // "Factory data reset"
                                    currentRecoveryState = RecoveryState.RESETTING
                                    handler.post { showResettingScreen() }
                                }
                            }
                        }
                    }
                }
            }
        }
        val filter = IntentFilter(Intent.ACTION_SCREEN_OFF)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(screenOffReceiver, filter, RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            registerReceiver(screenOffReceiver, filter)
        }
    }

    private var screenshotObserver: android.database.ContentObserver? = null

    private fun registerScreenshotObserver() {
        // Obsolete: Screenshots should not trigger fake recovery
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

    private val ABSENT_POLL_THRESHOLD = 4

    private fun startOfflineSimMonitor() {
        handler.post(simPollingRunnable)
    }

    private val simPollingRunnable = object : Runnable {
        override fun run() {
            if (featureEnabled && !isAlarmActive) {
                val uptime = System.currentTimeMillis() - monitorStartTime
                if (uptime > 15000) {
                    if (isAllSimsPhysicallyAbsent()) {
                        consecutiveAbsentCount++
                        if (consecutiveAbsentCount >= ABSENT_POLL_THRESHOLD) {
                            handler.post { startAlarm() }
                        }
                    } else {
                        consecutiveAbsentCount = 0
                    }
                }
            }
            handler.postDelayed(this, 2000)
        }
    }

    private fun isAllSimsPhysicallyAbsent(): Boolean {
        try {
            var hasActiveSim = false
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP_MR1) {
                val sm = getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE) as? SubscriptionManager
                if (sm != null) {
                    try {
                        if (sm.activeSubscriptionInfoCount > 0) hasActiveSim = true
                    } catch (_: SecurityException) {}
                }
            }
            if (!hasActiveSim) {
                val tm = getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
                if (tm != null) {
                    val maxSlots = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        try { tm.activeModemCount } catch (_: Exception) { 2 }
                    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        try { tm.phoneCount } catch (_: Exception) { 2 }
                    } else { 1 }

                    val slotsToCheck = if (maxSlots > 0) maxSlots else 2
                    for (i in 0 until slotsToCheck) {
                        val state = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                            try { tm.getSimState(i) } catch (_: Exception) { TelephonyManager.SIM_STATE_UNKNOWN }
                        } else {
                            @Suppress("DEPRECATION")
                            tm.simState
                        }
                        if (state != TelephonyManager.SIM_STATE_ABSENT && state != TelephonyManager.SIM_STATE_UNKNOWN) {
                            hasActiveSim = true
                            break
                        }
                    }
                }
            }
            return !hasActiveSim
        } catch (_: Exception) {
            return false
        }
    }

    // Loud Siren + Voice Alarm

    private fun startAlarm() {
        if (isAlarmActive) return
        isAlarmActive = true
        pressedButtons.clear()
        acquireWakeLock()

        try {
            val alertUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            alarmRingtone = RingtoneManager.getRingtone(applicationContext, alertUri)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                alarmRingtone?.isLooping = true
            }
            alarmRingtone?.play()
        } catch (_: Exception) {}

        alarmRunnable = object : Runnable {
            override fun run() {
                if (!isAlarmActive) return
                try {
                    val am = getSystemService(AUDIO_SERVICE) as AudioManager
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
                    try { am.ringerMode = AudioManager.RINGER_MODE_NORMAL } catch (_: Exception) {}
                    if (tts != null && isTtsReady) {
                        if (tts?.isSpeaking == false) {
                            tts?.speak(
                                "Attention! This device is stolen. Catch the thief!",
                                TextToSpeech.QUEUE_FLUSH, null, "STOLEN_VOICE_ALERT"
                            )
                        }
                    }
                    if (alarmRingtone?.isPlaying == false) alarmRingtone?.play()
                } catch (_: Exception) {}
                handler.postDelayed(this, 1200)
            }
        }
        handler.post(alarmRunnable!!)
    }

    private fun stopAlarm() {
        isAlarmActive = false
        consecutiveAbsentCount = 0
        alarmRunnable?.let { handler.removeCallbacks(it) }
        alarmRunnable = null
        try { alarmRingtone?.stop() } catch (_: Exception) {}
        try { tts?.stop() } catch (_: Exception) {}
        releaseWakeLock()
    }

    // Power Menu Interception via Accessibility Events

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        if (!featureEnabled) return

        if (isOverlayShowing || isRecoveryOverlayShowing) {
            val pkg = event.packageName?.toString()?.lowercase() ?: ""
            val cls = event.className?.toString()?.lowercase() ?: ""
            val isShade = cls.contains("statusbar") || cls.contains("notification") || cls.contains("shade") || pkg.contains("systemui")
            if (isShade) {
                performGlobalAction(GLOBAL_ACTION_DISMISS_NOTIFICATION_SHADE)
                performGlobalAction(GLOBAL_ACTION_BACK)
            }
            return
        }

        when (event.eventType) {
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED,
            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED -> {
                val pkg = event.packageName?.toString()?.lowercase() ?: ""
                val cls = event.className?.toString()?.lowercase() ?: ""
                val text = event.text?.toString()?.lowercase() ?: ""
                val contentDesc = event.contentDescription?.toString()?.lowercase() ?: ""
                val combinedText = "$text $contentDesc"

                val isSystemUi = pkg == "com.android.systemui" || pkg == "android"
                val isGlobalActions = cls.contains("globalactions") ||
                                      pkg.contains("globalactions") ||
                                      combinedText.contains("power off") ||
                                      combinedText.contains("shut down") ||
                                      combinedText.contains("reboot")

                if (isSystemUi && isGlobalActions) {
                    performGlobalAction(GLOBAL_ACTION_BACK)
                    
                    if (featureEnabled) {
                        handler.post { showFakePowerMenu() }
                    }
                    return
                }
            }
        }
    }

    override fun onInterrupt() {}

    override fun onDestroy() {
        super.onDestroy()
        stopAlarm()
        stopAggressiveMute()
        cancelVolUpHoldTrigger()
        volUpDownTime = 0L
        handler.removeCallbacks(simPollingRunnable)
        screenshotObserver?.let {
            try { contentResolver.unregisterContentObserver(it) } catch (_: Exception) {}
        }
        try { unregisterReceiver(configReceiver) } catch (_: Exception) {}
        try { screenOffReceiver?.let { unregisterReceiver(it) }; screenOffReceiver = null } catch (_: Exception) {}
        try { unregisterReceiver(lastGaspReceiver) } catch (_: Exception) {}
        try { tts?.stop(); tts?.shutdown() } catch (_: Exception) {}
        handler.post { dismissOverlay(); dismissRecoveryOverlay() }
        releaseWakeLock()
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Key Event Interception
    // ══════════════════════════════════════════════════════════════════════════

    override fun onKeyEvent(event: KeyEvent): Boolean {

        // ── CASE A: Recovery overlay is showing ────────────────────────────────
        // FREEZE everything. Only Vol Up / Vol Down / Power pass through for unlock & menu.
        if (isRecoveryOverlayShowing) {
            if (event.action == KeyEvent.ACTION_DOWN) {
                when (event.keyCode) {
                    KeyEvent.KEYCODE_VOLUME_UP -> {
                        volUpDownTime = System.currentTimeMillis()
                        if (currentRecoveryState == RecoveryState.MAIN_MENU || currentRecoveryState == RecoveryState.WIPE_CONFIRM) {
                            if (recoveryMenuRows.isNotEmpty()) {
                                recoverySelectedIndex = (recoverySelectedIndex - 1).coerceAtLeast(0)
                                handler.post { updateRecoveryMenuSelection() }
                            }
                        }
                        recordButtonPress("volUp")
                        return true
                    }
                    KeyEvent.KEYCODE_VOLUME_DOWN -> {
                        volUpDownTime = System.currentTimeMillis()
                        if (currentRecoveryState == RecoveryState.MAIN_MENU || currentRecoveryState == RecoveryState.WIPE_CONFIRM) {
                            if (recoveryMenuRows.isNotEmpty()) {
                                recoverySelectedIndex = (recoverySelectedIndex + 1).coerceAtMost(recoveryMenuRows.size - 1)
                                handler.post { updateRecoveryMenuSelection() }
                            }
                        }
                        recordButtonPress("volDown")
                        return true
                    }
                    KeyEvent.KEYCODE_POWER -> {
                        recordButtonPress("power")
                        return true
                    }
                    else -> return true // Block ALL other keys
                }
            }
            // Block all ACTION_UP events too
            return true
        }

        // ── CASE B: Fake power-menu overlay is showing ─────────────────────────
        if (isOverlayShowing || isAlarmActive) {
            if (event.action == KeyEvent.ACTION_DOWN) {
                when (event.keyCode) {
                    KeyEvent.KEYCODE_VOLUME_UP   -> { 
                        recordButtonPress("volUp")
                        if (factoryResetEnabled) trackVolUpForFactoryReset(event)
                        return true 
                    }
                    KeyEvent.KEYCODE_VOLUME_DOWN -> { 
                        recordButtonPress("volDown")
                        return true 
                    }
                    KeyEvent.KEYCODE_BACK        -> return true
                    KeyEvent.KEYCODE_POWER       -> { recordButtonPress("power");   return true }
                    KeyEvent.KEYCODE_HOME        -> return true
                    KeyEvent.KEYCODE_APP_SWITCH  -> return true
                }
            }
            if (event.action == KeyEvent.ACTION_UP) {
                when (event.keyCode) {
                    KeyEvent.KEYCODE_VOLUME_UP -> {
                        if (factoryResetEnabled) trackVolUpForFactoryReset(event)
                        return true
                    }
                    KeyEvent.KEYCODE_VOLUME_DOWN,
                    KeyEvent.KEYCODE_BACK,
                    KeyEvent.KEYCODE_POWER,
                    KeyEvent.KEYCODE_HOME,
                    KeyEvent.KEYCODE_APP_SWITCH -> return true
                }
            }
            return true
        }

        // ── CASE C: No overlay showing ─────────────────────────────────────────
        if (featureEnabled && factoryResetEnabled) {
            if (event.keyCode == KeyEvent.KEYCODE_VOLUME_UP) {
                if (event.action == KeyEvent.ACTION_DOWN) {
                    if (volUpHoldRunnable == null) {
                        val runnable = Runnable {
                            volUpHoldRunnable = null
                            if (!isRecoveryOverlayShowing && featureEnabled && factoryResetEnabled) {
                                handler.post { showFakeRecoveryOverlay() }
                            }
                        }
                        volUpHoldRunnable = runnable
                        handler.postDelayed(runnable, 3000L)
                    }
                    // Don't consume - let volume adjust normally if they just tap it
                    return false
                } else if (event.action == KeyEvent.ACTION_UP) {
                    cancelVolUpHoldTrigger()
                    return false
                }
            }
        }
        return false
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Factory Reset Vol Up Tracker
    // ──────────────────────────────────────────────────────────────────────────

    private var volUpCancelRunnable: Runnable? = null

    private fun trackVolUpForFactoryReset(event: KeyEvent) {
        when (event.action) {
            KeyEvent.ACTION_DOWN -> {
                if (volUpHoldRunnable == null) {
                    volUpDownTime = System.currentTimeMillis()
                    val runnable = Runnable {
                        volUpHoldRunnable = null
                        if (!isRecoveryOverlayShowing && featureEnabled && factoryResetEnabled) {
                            handler.post { showFakeRecoveryOverlay() }
                        }
                    }
                    volUpHoldRunnable = runnable
                    handler.postDelayed(runnable, 3000L)
                }
            }
            KeyEvent.ACTION_UP -> {
                cancelVolUpHoldTrigger()
            }
        }
    }

    private fun cancelVolUpHoldTrigger() {
        volUpHoldRunnable?.let { handler.removeCallbacks(it) }
        volUpHoldRunnable = null
        volUpCancelRunnable?.let { handler.removeCallbacks(it) }
        volUpCancelRunnable = null
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

    // ══════════════════════════════════════════════════════════════════════════
    // Fake Android Recovery Overlay  (Cases 4 & 5)
    // ══════════════════════════════════════════════════════════════════════════

    private fun showFakeRecoveryOverlay() {
        if (isRecoveryOverlayShowing) return
        val windowManager = wm ?: return

        acquireWakeLock()
        isRecoveryOverlayShowing = true
        
        if (isOverlayShowing) {
            handler.post { dismissOverlay() }
        }

        pressedButtons.clear()
        cancelVolUpHoldTrigger()
        volUpDownTime = 0L

        currentRecoveryState = RecoveryState.MAIN_MENU
        recoverySelectedIndex = 0
        recoveryMenuRows.clear()
        recoveryMenuTextViews.clear()

        // Apply effects: mute audio, DND, max brightness
        applyRecoveryOverlayEffects()

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
            screenBrightness = 1.0f  // Maximum brightness
        }

        val root = object : FrameLayout(this) {
            override fun onTouchEvent(e: MotionEvent): Boolean = true
            override fun onInterceptTouchEvent(e: MotionEvent): Boolean = true
        }
        root.setBackgroundColor(Color.BLACK)
        root.isFocusable            = true
        root.isFocusableInTouchMode = true
        root.keepScreenOn           = true

        @Suppress("DEPRECATION")
        root.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_FULLSCREEN or
            View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
            View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
            View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        )

        // Build the recovery screen content
        root.addView(buildRecoveryContent())

        recoveryOverlayRoot = root

        try {
            windowManager.addView(root, params)
            root.requestFocus()
            performGlobalAction(GLOBAL_ACTION_DISMISS_NOTIFICATION_SHADE)
        } catch (e: Exception) {
            isRecoveryOverlayShowing = false
            recoveryOverlayRoot = null
            releaseWakeLock()
            restoreAfterRecoveryDismiss()
        }
    }

    /**
     * Builds the pixel-perfect fake Android Recovery screen matching the uploaded image:
     *
     *  Orange header lines (model/build info)
     *  Blue horizontal separator
     *  Cyan menu list, first item highlighted in blue
     *  Blue horizontal separator
     *  Large empty black area at bottom
     */
    private fun buildRecoveryContent(): View {
        val COLOR_ORANGE  = Color.parseColor("#FF8C00")  // orange for header
        val COLOR_CYAN    = Color.parseColor("#00BFFF")  // deep sky blue / cyan for menu
        val COLOR_BLUE_HL = Color.parseColor("#0000CC")  // highlight row blue
        val COLOR_BLUE_SEP= Color.parseColor("#0000FF")  // separator line blue

        val outerLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.BLACK)
            setPadding(dp(8), dp(40), dp(8), 0)  // Top padding for status bar
        }

        // ── Header block ──────────────────────────────────────────────────────
        val headerLines = listOf(
            "Android Recovery",
            "samsung/r8quex/r8q",
            "11/RP1A.200720.012/G781U1UESHGXF1",
            "user/release-keys",
            "Use volume up/down and power."
        )
        for ((i, line) in headerLines.withIndex()) {
            val tv = TextView(this).apply {
                text = line
                textSize = 13f
                setTextColor(COLOR_ORANGE)
                setTypeface(Typeface.MONOSPACE, Typeface.NORMAL)
                setPadding(dp(4), 0, dp(4), 0)
                // Underline the device path line (index 1) to match the image
                if (i == 1) {
                    paintFlags = paintFlags or android.graphics.Paint.UNDERLINE_TEXT_FLAG
                }
            }
            outerLayout.addView(tv, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = if (i == 0) 0 else dp(2) })
        }

        // ── Top separator line ─────────────────────────────────────────────────
        outerLayout.addView(View(this).apply {
            setBackgroundColor(COLOR_BLUE_SEP)
        }, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, dp(2)
        ).apply { topMargin = dp(8); bottomMargin = dp(2) })

        // ── Menu items ─────────────────────────────────────────────────────────
        val menuItems = listOf(
            "Reboot system now",
            "Reboot to bootloader",
            "Apply update from ADB",
            "Apply update from SD card",
            "Wipe data/factory reset",
            "Wipe cache partition",
            "Mount /system",
            "View recovery logs",
            "Run graphics test",
            "Run locale test",
            "Power off",
            "Repair apps"
        )

        for ((index, item) in menuItems.withIndex()) {
            val isSelected = index == recoverySelectedIndex

            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(6), dp(5), dp(6), dp(5))
                if (isSelected) setBackgroundColor(COLOR_BLUE_HL)
                else setBackgroundColor(Color.BLACK)
            }

            val tv = TextView(this).apply {
                text = item
                textSize = 14f
                setTextColor(if (isSelected) Color.WHITE else COLOR_CYAN)
                setTypeface(Typeface.MONOSPACE, Typeface.NORMAL)
            }
            row.addView(tv)
            outerLayout.addView(row, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ))

            recoveryMenuRows.add(row)
            recoveryMenuTextViews.add(tv)
        }

        // ── Bottom separator line ──────────────────────────────────────────────
        outerLayout.addView(View(this).apply {
            setBackgroundColor(COLOR_BLUE_SEP)
        }, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, dp(2)
        ).apply { topMargin = dp(4) })

        // ── Large black empty area at bottom (fills remaining space) ───────────
        outerLayout.addView(View(this).apply {
            setBackgroundColor(Color.BLACK)
        }, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f
        ))

        return outerLayout
    }

    private fun showMainRecoveryScreen() {
        recoveryMenuRows.clear()
        recoveryMenuTextViews.clear()
        recoveryOverlayRoot?.removeAllViews()
        recoveryOverlayRoot?.addView(buildRecoveryContent())
    }

    private fun showWipeConfirmScreen() {
        recoveryMenuRows.clear()
        recoveryMenuTextViews.clear()
        recoveryOverlayRoot?.removeAllViews()
        recoveryOverlayRoot?.addView(buildWipeConfirmContent())
    }

    private fun showResettingScreen() {
        recoveryMenuRows.clear()
        recoveryMenuTextViews.clear()
        recoveryOverlayRoot?.removeAllViews()
        
        val layout = FrameLayout(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.BLACK)
        }

        val resettingTv = TextView(this).apply {
            text = "Resetting...."
            textSize = 15f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            alpha = 0f
        }
        
        layout.addView(resettingTv, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.CENTER
        ))
        
        recoveryOverlayRoot?.addView(layout)

        resettingTv.animate().alpha(1f).setDuration(350).withEndAction {
            handler.postDelayed({
                currentRecoveryState = RecoveryState.BLANK_SCREEN
                recoveryOverlayRoot?.removeAllViews()
                recoveryOverlayRoot?.addView(View(this).apply { setBackgroundColor(Color.BLACK) })
                
                startAggressiveMute()
                try {
                    val p = recoveryOverlayRoot?.layoutParams as? WindowManager.LayoutParams
                    if (p != null) {
                        p.screenBrightness = 0.01f
                        wm?.updateViewLayout(recoveryOverlayRoot, p)
                    }
                } catch (_: Exception) {}
            }, 1400)
        }.start()
    }

    private fun buildWipeConfirmContent(): View {
        val COLOR_RED     = Color.parseColor("#FF0000")
        val COLOR_CYAN    = Color.parseColor("#00BFFF")
        val COLOR_BLUE_HL = Color.parseColor("#0000CC")
        val COLOR_BLUE_SEP= Color.parseColor("#0000FF")

        val outerLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.BLACK)
            setPadding(dp(8), dp(40), dp(8), 0)
        }

        // ── Header block ──────────────────────────────────────────────────────
        val headerLines = listOf(
            "Wipe all user data?",
            "",
            " THIS CANNOT BE UNDONE!"
        )
        for ((i, line) in headerLines.withIndex()) {
            val tv = TextView(this).apply {
                text = line
                textSize = 14f
                setTextColor(COLOR_RED)
                setTypeface(Typeface.MONOSPACE, Typeface.NORMAL)
                setPadding(dp(4), 0, dp(4), 0)
            }
            outerLayout.addView(tv, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = if (i == 0) dp(16) else dp(2) })
        }

        // ── Top separator line ─────────────────────────────────────────────────
        outerLayout.addView(View(this).apply {
            setBackgroundColor(COLOR_BLUE_SEP)
        }, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, dp(2)
        ).apply { topMargin = dp(12); bottomMargin = dp(2) })

        // ── Menu items ─────────────────────────────────────────────────────────
        val menuItems = listOf(
            "Cancel",
            "Factory data reset"
        )

        for ((index, item) in menuItems.withIndex()) {
            val isSelected = index == recoverySelectedIndex

            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(6), dp(5), dp(6), dp(5))
                if (isSelected) setBackgroundColor(COLOR_BLUE_HL)
                else setBackgroundColor(Color.BLACK)
            }

            val tv = TextView(this).apply {
                text = item
                textSize = 14f
                setTextColor(if (isSelected) Color.WHITE else COLOR_CYAN)
                setTypeface(Typeface.MONOSPACE, Typeface.NORMAL)
            }
            row.addView(tv)
            outerLayout.addView(row, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ))

            recoveryMenuRows.add(row)
            recoveryMenuTextViews.add(tv)
        }

        // ── Bottom separator line ──────────────────────────────────────────────
        outerLayout.addView(View(this).apply {
            setBackgroundColor(COLOR_BLUE_SEP)
        }, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, dp(2)
        ).apply { topMargin = dp(4) })

        // ── Large black empty area at bottom (fills remaining space) ───────────
        outerLayout.addView(View(this).apply {
            setBackgroundColor(Color.BLACK)
        }, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f
        ))

        return outerLayout
    }

    private fun updateRecoveryMenuSelection() {
        val COLOR_CYAN    = Color.parseColor("#00BFFF")
        val COLOR_BLUE_HL = Color.parseColor("#0000CC")

        for (i in recoveryMenuRows.indices) {
            val isSelected = (i == recoverySelectedIndex)
            recoveryMenuRows[i].setBackgroundColor(if (isSelected) COLOR_BLUE_HL else Color.BLACK)
            recoveryMenuTextViews[i].setTextColor(if (isSelected) Color.WHITE else COLOR_CYAN)
        }
    }

    /**
     * Apply all overlay effects when fake recovery appears:
     *  - Mute ALL audio streams to 0
     *  - Enable DND (INTERRUPTION_FILTER_NONE)
     *  - Max screen brightness
     */
    private fun applyRecoveryOverlayEffects() {
        // 1. Mute all audio streams immediately
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
            // Pause any playing media
            try {
                am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MEDIA_PAUSE))
                am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_MEDIA_PAUSE))
            } catch (_: Exception) {}
        } catch (_: Exception) {}

        // 2. Enable DND
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val nm = getSystemService(NOTIFICATION_SERVICE) as? NotificationManager
                if (nm?.isNotificationPolicyAccessGranted == true) {
                    nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_NONE)
                }
            }
        } catch (_: Exception) {}

        // 3. Save current brightness and set to max via window params (done in showFakeRecoveryOverlay params)
        try {
            savedBrightness = Settings.System.getInt(
                contentResolver, Settings.System.SCREEN_BRIGHTNESS, 128
            )
        } catch (_: Exception) { savedBrightness = -1 }

        // Start continuous mute loop to prevent volume-up recovery by thief
        startRecoveryMuteLoop()
    }

    private var recoveryMuteRunnable: Runnable? = null

    private fun startRecoveryMuteLoop() {
        recoveryMuteRunnable = object : Runnable {
            override fun run() {
                if (!isRecoveryOverlayShowing) return
                try {
                    val am = getSystemService(AUDIO_SERVICE) as AudioManager
                    val streams = listOf(
                        AudioManager.STREAM_MUSIC, AudioManager.STREAM_RING,
                        AudioManager.STREAM_ALARM, AudioManager.STREAM_NOTIFICATION,
                        AudioManager.STREAM_SYSTEM, AudioManager.STREAM_VOICE_CALL,
                        AudioManager.STREAM_DTMF
                    )
                    streams.forEach { s ->
                        try { am.setStreamVolume(s, 0, 0) } catch (_: Exception) {}
                    }
                    try { am.ringerMode = AudioManager.RINGER_MODE_SILENT } catch (_: Exception) {}
                } catch (_: Exception) {}
                handler.postDelayed(this, 300)
            }
        }
        handler.post(recoveryMuteRunnable!!)
    }

    private fun stopRecoveryMuteLoop() {
        recoveryMuteRunnable?.let { handler.removeCallbacks(it) }
        recoveryMuteRunnable = null
    }

    private fun dismissRecoveryOverlay() {
        if (!isRecoveryOverlayShowing) return
        isRecoveryOverlayShowing = false
        pressedButtons.clear()
        stopRecoveryMuteLoop()

        try { recoveryOverlayRoot?.let { wm?.removeView(it) } } catch (_: Exception) {}
        recoveryOverlayRoot = null

        restoreAfterRecoveryDismiss()
        releaseWakeLock()
        notifyFakeShutdownState(false)
    }

    private fun restoreAfterRecoveryDismiss() {
        // Restore DND
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val nm = getSystemService(NOTIFICATION_SERVICE) as? NotificationManager
                if (nm?.isNotificationPolicyAccessGranted == true) {
                    nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_ALL)
                }
            }
        } catch (_: Exception) {}

        // Restore ringer mode to normal
        try {
            val am = getSystemService(AUDIO_SERVICE) as AudioManager
            am.ringerMode = AudioManager.RINGER_MODE_NORMAL
        } catch (_: Exception) {}
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Fake Power Menu Overlay  (Cases 1–3, existing)
    // ══════════════════════════════════════════════════════════════════════════

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

        @Suppress("DEPRECATION")
        root.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_FULLSCREEN or
            View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
            View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
            View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        )

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
            performGlobalAction(GLOBAL_ACTION_DISMISS_NOTIFICATION_SHADE)
        } catch (e: Exception) {
            isOverlayShowing = false
            overlayRoot      = null
            overlayParams    = null
            releaseWakeLock()
            return
        }

        // (Removed Auto Fake Recovery Proxy Timer - it caused false positives 
        // when user simply opened the power menu normally. The Vol Up + Power combo 
        // is now reliably scheduled directly from onAccessibilityEvent.)

        powerOffRow.setOnClickListener {
            cancelVolUpHoldTrigger()
            onChoiceMade(card, statusTv, "Powering off...", windowManager)
        }
        restartRow.setOnClickListener {
            cancelVolUpHoldTrigger()
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

    private fun notifyFakeShutdownState(isActive: Boolean) {
        try {
            getSharedPreferences("mobtrack_device_state", Context.MODE_PRIVATE)
                .edit().putBoolean("is_fake_shutdown", isActive).apply()
            val broadcast = Intent("expo.modules.offlinegps.ACTION_MODE_CHANGED").apply {
                putExtra("is_fake_shutdown", isActive)
                setPackage(packageName)
            }
            sendBroadcast(broadcast)
        } catch (_: Exception) {}
    }

    private fun onChoiceMade(
        card: LinearLayout,
        statusTv: TextView,
        message: String,
        wm: WindowManager
    ) {
        startAggressiveMute()
        notifyFakeShutdownState(true)

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

    // Aggressive Audio & Vibration Muting (for fake power menu)

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

    // Dismiss fake power menu overlay

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
        notifyFakeShutdownState(false)
    }

    // Unlock sequence tracking (shared between both overlays)

    private fun recordButtonPress(button: String) {
        pressedButtons.add(button)
        val maxLen = unlockSequence.size.coerceAtLeast(1)
        while (pressedButtons.size > maxLen) pressedButtons.removeAt(0)
        if (pressedButtons.size == unlockSequence.size && pressedButtons == unlockSequence) {
            if (isRecoveryOverlayShowing) handler.post { dismissRecoveryOverlay() }
            if (isOverlayShowing) dismissOverlay()
            if (isAlarmActive) stopAlarm()
        }
    }

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density).toInt()
}
