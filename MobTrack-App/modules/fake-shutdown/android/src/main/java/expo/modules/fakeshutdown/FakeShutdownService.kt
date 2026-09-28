package expo.modules.fakeshutdown

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * FakeShutdownService v2 — Foreground notification service only.
 *
 * The actual power-key interception and overlay logic has been moved to
 * FakeShutdownAccessibilityService. This service exists solely to:
 *   1. Show the persistent foreground notification (required by Android).
 *   2. Forward the unlock-sequence config to the accessibility service via broadcast.
 *   3. Stop the accessibility overlay when the feature is disabled.
 */
class FakeShutdownService : Service() {

    companion object {
        const val EXTRA_SEQUENCE = "unlockSequence"
        private const val CHANNEL_ID   = "mobtrack_fakeshutdown"
        private const val CHANNEL_NAME = "MobTrack Security"
        private const val NOTIF_ID     = 4001
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(NOTIF_ID, buildNotification())
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Forward unlock sequence to the accessibility service and persist to prefs
        intent?.getStringArrayListExtra(EXTRA_SEQUENCE)?.let { seq ->
            if (seq.isNotEmpty()) {
                val prefs = getSharedPreferences("MobTrackPrefs", Context.MODE_PRIVATE)
                prefs.edit().putString("unlockSequence", seq.joinToString(",")).apply()
                val broadcast = Intent(FakeShutdownAccessibilityService.ACTION_SHOW).apply {
                    putStringArrayListExtra(FakeShutdownAccessibilityService.EXTRA_SEQUENCE, seq)
                    setPackage(packageName)
                }
                sendBroadcast(broadcast)
            }
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        
        // Tell accessibility service to stop showing overlay
        val broadcast = Intent(FakeShutdownAccessibilityService.ACTION_HIDE).apply {
            setPackage(packageName)
        }
        try { sendBroadcast(broadcast) } catch (_: Exception) {}
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(
                CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_MIN
            ).apply {
                description = "Keeps device security features active"
                setShowBadge(false)
                setSound(null, null)
            }
            (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(ch)
        }
    }

    private fun buildNotification() =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("MobTrack Security")
            .setContentText("Device protection active")
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setSilent(true)
            .build()
}
