package expo.modules.backgroundcamera

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * BootReceiver — restarts the IntruderCaptureService after device reboot.
 *
 * Without this, the persistent watcher service is gone after every reboot,
 * meaning onPasswordFailed would fire with no running service to capture images.
 */
class BootReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "BootReceiver"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        if (action != Intent.ACTION_BOOT_COMPLETED &&
            action != "android.intent.action.QUICKBOOT_POWERON") {
            return
        }

        Log.d(TAG, "Device booted — checking if IntruderCaptureService should restart")

        val prefs = context.getSharedPreferences(
            IntruderAdminReceiver.PREFS_NAME,
            Context.MODE_PRIVATE
        )
        val isEnabled = prefs.getBoolean(IntruderAdminReceiver.KEY_FEATURE_ENABLED, true)

        if (isEnabled) {
            Log.d(TAG, "Intruder detection was enabled — restarting IntruderCaptureService")
            IntruderCaptureService.startWatching(context)
        } else {
            Log.d(TAG, "Intruder detection is disabled — not restarting service")
        }

        // Restart LastGaspService background wake engine if device is configured
        val lastGaspPrefs = context.getSharedPreferences("MobTrackPrefs", Context.MODE_PRIVATE)
        val lastGaspEnabled = lastGaspPrefs.getBoolean("lastGaspEnabled", true)
        val deviceId = lastGaspPrefs.getString("deviceId", null)
        if (lastGaspEnabled && !deviceId.isNullOrEmpty()) {
            try {
                val serviceIntent = Intent().apply {
                    setClassName(context.packageName, "expo.modules.fakeshutdown.LastGaspService")
                }
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                    context.startForegroundService(serviceIntent)
                } else {
                    context.startService(serviceIntent)
                }
                Log.d(TAG, "Device booted — restarted LastGaspService background wake engine")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to start LastGaspService on boot: ${e.message}")
            }
        }
    }
}

