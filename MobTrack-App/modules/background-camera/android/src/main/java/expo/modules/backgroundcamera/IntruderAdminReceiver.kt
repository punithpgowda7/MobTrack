package expo.modules.backgroundcamera

import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PowerManager
import android.os.UserHandle
import android.util.Log

class IntruderAdminReceiver : DeviceAdminReceiver() {

    companion object {
        private const val TAG = "IntruderAdminReceiver"
        const val PREFS_NAME = "intruder_prefs"
        const val KEY_FAILED_ATTEMPTS = "failed_attempts_count"
        const val KEY_THRESHOLD = "failed_attempts_threshold"
        const val KEY_FEATURE_ENABLED = "intruder_selfie_enabled"
        const val DEFAULT_THRESHOLD = 3

        @Volatile
        private var lastProcessedFailedTimestamp = 0L

        fun getPrefs(context: Context): android.content.SharedPreferences {
            return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                try {
                    context.createDeviceProtectedStorageContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                } catch (_: Exception) {
                    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                }
            } else {
                context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            }
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        Log.w(TAG, "IntruderAdminReceiver onReceive: action=$action")

        if (action == ACTION_PASSWORD_FAILED) {
            processPasswordFailed(context)
        } else if (action == ACTION_PASSWORD_SUCCEEDED) {
            processPasswordSucceeded(context)
        }

        super.onReceive(context, intent)
    }

    @Deprecated("Deprecated in Java")
    override fun onPasswordFailed(context: Context, intent: Intent) {
        super.onPasswordFailed(context, intent)
        processPasswordFailed(context)
    }

    override fun onPasswordFailed(context: Context, intent: Intent, user: UserHandle) {
        super.onPasswordFailed(context, intent, user)
        processPasswordFailed(context)
    }

    @Deprecated("Deprecated in Java")
    override fun onPasswordSucceeded(context: Context, intent: Intent) {
        super.onPasswordSucceeded(context, intent)
        processPasswordSucceeded(context)
    }

    override fun onPasswordSucceeded(context: Context, intent: Intent, user: UserHandle) {
        super.onPasswordSucceeded(context, intent, user)
        processPasswordSucceeded(context)
    }

    override fun onEnabled(context: Context, intent: Intent) {
        super.onEnabled(context, intent)
        Log.d(TAG, "MobTrack Device Admin activated successfully")
    }

    override fun onDisabled(context: Context, intent: Intent) {
        super.onDisabled(context, intent)
        Log.w(TAG, "MobTrack Device Admin deactivated by user")
    }

    @Synchronized
    private fun processPasswordFailed(context: Context) {
        val now = System.currentTimeMillis()
        // Debounce within 500ms so onReceive + onPasswordFailed doesn't double-count
        if (now - lastProcessedFailedTimestamp < 500L) {
            return
        }
        lastProcessedFailedTimestamp = now

        val prefs = getPrefs(context)
        val isEnabled = prefs.getBoolean(KEY_FEATURE_ENABLED, true)
        if (!isEnabled) {
            Log.d(TAG, "processPasswordFailed: Intruder selfie feature is disabled by user setting")
            return
        }

        val currentCount = prefs.getInt(KEY_FAILED_ATTEMPTS, 0) + 1
        prefs.edit().putInt(KEY_FAILED_ATTEMPTS, currentCount).apply()

        // Also sync to standard prefs if different
        try {
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit().putInt(KEY_FAILED_ATTEMPTS, currentCount).apply()
        } catch (_: Exception) {}

        val threshold = prefs.getInt(KEY_THRESHOLD, DEFAULT_THRESHOLD).coerceAtLeast(1)
        val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager
        val systemFailedAttempts = try { dpm?.currentFailedPasswordAttempts ?: 0 } catch (_: Exception) { 0 }
        val effectiveCount = maxOf(currentCount, systemFailedAttempts)

        Log.w(TAG, "🚨 processPasswordFailed: Consecutive failed attempts = $currentCount (system=$systemFailedAttempts) / threshold=$threshold")

        if (effectiveCount >= threshold) {
            Log.w(TAG, "🚨 Threshold reached ($effectiveCount >= $threshold)! Triggering intruder capture...")
            triggerIntruderCapture(context)
        }
    }

    @Synchronized
    private fun processPasswordSucceeded(context: Context) {
        val prefs = getPrefs(context)
        prefs.edit().putInt(KEY_FAILED_ATTEMPTS, 0).apply()
        try {
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit().putInt(KEY_FAILED_ATTEMPTS, 0).apply()
        } catch (_: Exception) {}
        Log.d(TAG, "processPasswordSucceeded: Correct PIN/Password entered. Resetting failed attempt count to 0")
    }

    private fun triggerIntruderCapture(context: Context) {
        try {
            // Wake display and CPU so lockscreen activity can render immediately
            val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
            @Suppress("DEPRECATION")
            val wakeLock = pm?.newWakeLock(
                PowerManager.SCREEN_BRIGHT_WAKE_LOCK or
                PowerManager.ACQUIRE_CAUSES_WAKEUP or
                PowerManager.ON_AFTER_RELEASE,
                "MobTrack:IntruderCaptureTrigger"
            )
            wakeLock?.acquire(15000L)

            Log.w(TAG, "🚨 Triggering IntruderCaptureActivity.start(context)")
            IntruderCaptureActivity.start(context)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to launch IntruderCaptureActivity", e)
        }
    }
}
