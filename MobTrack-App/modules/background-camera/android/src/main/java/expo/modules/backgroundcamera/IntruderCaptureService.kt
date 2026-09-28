package expo.modules.backgroundcamera

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import android.view.Gravity
import android.view.WindowManager
import android.widget.FrameLayout
import androidx.core.app.NotificationCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry

/**
 * IntruderCaptureService — Persistent watcher service that maintains a foreground presence
 * and an invisible 1x1 SYSTEM_ALERT_WINDOW overlay on Android 14+.
 *
 * This service keeps the app process in the FOREGROUND state with camera capability, ensuring
 * that when onPasswordFailed fires on the lock screen, the app has full authorization to launch
 * the capture activity without being suppressed by Android's background execution limits.
 */
class IntruderCaptureService : Service(), LifecycleOwner {

    companion object {
        private const val TAG = "IntruderCaptureService"
        const val CHANNEL_ID = "mobtrack_intruder_channel"
        private const val NOTIFICATION_ID = 2002

        const val ACTION_CAPTURE = "expo.modules.backgroundcamera.ACTION_CAPTURE"
        const val ACTION_START_WATCHING = "expo.modules.backgroundcamera.ACTION_START_WATCHING"
        const val ACTION_STOP_WATCHING = "expo.modules.backgroundcamera.ACTION_STOP_WATCHING"

        @Volatile
        private var instance: IntruderCaptureService? = null

        fun signalCapture(context: Context) {
            Log.w(TAG, "signalCapture: triggering IntruderCaptureActivity")
            startWatching(context)
            IntruderCaptureActivity.start(context)
        }

        fun startWatching(context: Context) {
            val intent = Intent(context, IntruderCaptureService::class.java).apply {
                action = ACTION_START_WATCHING
            }
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to start watching service: ${e.message}")
            }
        }

        fun stopWatching(context: Context) {
            try {
                context.stopService(Intent(context, IntruderCaptureService::class.java))
            } catch (e: Exception) {
                Log.w(TAG, "Failed to stop watching service: ${e.message}")
            }
        }

        fun buildWorkerNotification(
            context: Context,
            channelId: String,
            notificationId: Int
        ): android.app.Notification {
            ensureChannel(context, channelId)
            return NotificationCompat.Builder(context, channelId)
                .setContentTitle("MobTrack Security Active")
                .setContentText("Monitoring device for unauthorized access")
                .setSmallIcon(android.R.drawable.ic_lock_lock)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build()
        }

        private fun ensureChannel(context: Context, channelId: String) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val channel = NotificationChannel(
                    channelId,
                    "Device Security Monitor",
                    NotificationManager.IMPORTANCE_LOW
                ).apply {
                    setShowBadge(false)
                    enableLights(false)
                    enableVibration(false)
                    setSound(null, null)
                }
                context.getSystemService(NotificationManager::class.java)
                    ?.createNotificationChannel(channel)
            }
        }
    }

    private val lifecycleRegistry = LifecycleRegistry(this)
    private val mainHandler = Handler(Looper.getMainLooper())
    private var wakeLock: PowerManager.WakeLock? = null
    private var overlayView: FrameLayout? = null
    private var windowManager: WindowManager? = null

    override fun getLifecycle(): Lifecycle = lifecycleRegistry

    override fun onCreate() {
        super.onCreate()
        instance = this
        lifecycleRegistry.handleLifecycleEvent(Lifecycle.Event.ON_CREATE)
        Log.d(TAG, "IntruderCaptureService created")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "onStartCommand: action=${intent?.action}")

        when (intent?.action) {
            ACTION_CAPTURE -> {
                IntruderCaptureActivity.start(this)
                return START_STICKY
            }
            ACTION_STOP_WATCHING -> {
                fullCleanupAndStop()
                return START_NOT_STICKY
            }
            else -> {
                ensureForeground()
                acquireWakeLock()
                if (lifecycleRegistry.currentState == Lifecycle.State.INITIALIZED ||
                    lifecycleRegistry.currentState == Lifecycle.State.CREATED) {
                    lifecycleRegistry.handleLifecycleEvent(Lifecycle.Event.ON_START)
                    lifecycleRegistry.handleLifecycleEvent(Lifecycle.Event.ON_RESUME)
                }
                addOverlayIfPermitted()
                return START_STICKY
            }
        }
    }

    private fun ensureForeground() {
        createNotificationChannel()
        val notification = buildNotification()
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA)
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        } catch (e: Exception) {
            Log.e(TAG, "startForeground failed: ${e.message}")
        }
    }

    // ── SYSTEM_ALERT_WINDOW overlay ──────────────────────────────────────────────────────
    // An active 1x1 transparent overlay keeps the app in a visible window layer on Android 14–17
    // satisfying modern background execution exemptions.
    private fun addOverlayIfPermitted() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
        if (!Settings.canDrawOverlays(this)) {
            Log.w(TAG, "SYSTEM_ALERT_WINDOW not granted — overlay skipped")
            return
        }
        if (overlayView != null) return

        try {
            val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
            windowManager = wm
            val view = FrameLayout(this)
            overlayView = view

            val layoutType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            } else {
                @Suppress("DEPRECATION")
                WindowManager.LayoutParams.TYPE_PHONE
            }

            val params = WindowManager.LayoutParams(
                1, 1,
                layoutType,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                        WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED,
                PixelFormat.TRANSLUCENT
            ).apply {
                gravity = Gravity.TOP or Gravity.START
                x = 0; y = 0
            }

            wm.addView(view, params)
            Log.d(TAG, "Overlay window added (1×1 transparent) for lockscreen background exemption")
        } catch (e: Exception) {
            Log.w(TAG, "Could not add overlay: ${e.message}")
            overlayView = null
            windowManager = null
        }
    }

    private fun removeOverlay() {
        try {
            overlayView?.let { windowManager?.removeView(it) }
        } catch (e: Exception) {
            Log.w(TAG, "Could not remove overlay: ${e.message}")
        } finally {
            overlayView = null
            windowManager = null
        }
    }

    private fun acquireWakeLock() {
        try {
            val pm = getSystemService(POWER_SERVICE) as PowerManager
            wakeLock = pm.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "MobTrack:IntruderCaptureService"
            ).also { it.acquire(3600000L) }
        } catch (e: Exception) {
            Log.w(TAG, "Could not acquire WakeLock: ${e.message}")
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Device Security Monitor",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Monitors for unauthorized device access attempts"
                setShowBadge(false)
                enableLights(false)
                enableVibration(false)
                setSound(null, null)
            }
            getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("MobTrack Security Active")
            .setContentText("Monitoring device for unauthorized access")
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun fullCleanupAndStop() {
        mainHandler.post {
            removeOverlay()
            lifecycleRegistry.handleLifecycleEvent(Lifecycle.Event.ON_DESTROY)
            wakeLock?.let { if (it.isHeld) it.release() }
            stopForeground(true)
            stopSelf()
        }
    }

    override fun onDestroy() {
        instance = null
        fullCleanupAndStop()
        super.onDestroy()
        Log.d(TAG, "IntruderCaptureService destroyed")
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
