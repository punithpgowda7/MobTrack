package expo.modules.backgroundcamera

import android.app.ActivityOptions
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import android.view.Gravity
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.resume

/**
 * IntruderCaptureActivity — Transparent, non-obtrusive Activity displayed over the lock screen.
 *
 * ─── WHY AN ACTIVITY INSTEAD OF A SERVICE OVERLAY? ──────────────────────────────────────
 * On Android 14+ (including Android 15, 16, and 17 on Google Pixel), Android's CameraService
 * strictly enforces that background services cannot access camera sensors while the device is locked.
 *
 * By launching a transparent Activity with `setShowWhenLocked(true)` and `setTurnScreenOn(true)`:
 * 1. The Activity is promoted to PROCESS_STATE_TOP directly above Keyguard.
 * 2. CameraService grants full, unrestricted camera hardware access.
 * 3. The 1x1 PreviewView (COMPATIBLE / TextureView mode) allows CameraX 3A (Auto Exposure /
 *    Auto Focus) to converge instantly without punching holes in the lock screen.
 * 4. The Activity captures 3 burst shots at 1-second intervals, uploads them, and calls finish().
 * 5. Window flags ensure touches pass through to the lock screen, so the user/intruder
 *    experiences zero UI disruption or lag.
 */
class IntruderCaptureActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "IntruderCaptureActivity"
        const val CHANNEL_ID = "mobtrack_intruder_capture"
        private const val NOTIFICATION_ID = 2004

        private const val BURST_COUNT = 3
        private const val BURST_DELAY_MS = 1000L

        fun ensureChannel(context: Context) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val channel = NotificationChannel(
                    CHANNEL_ID,
                    "Security Verification",
                    NotificationManager.IMPORTANCE_HIGH
                ).apply {
                    description = "Security capture alerts"
                    setShowBadge(false)
                    enableLights(false)
                    enableVibration(false)
                    lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
                }
                context.getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
            }
        }

        /**
         * Launch the capture activity over the lockscreen.
         * Employs multiple launch vectors for maximum reliability across Android 14–17:
         * 1. Screen WakeLock (wakes display and turns on screen)
         * 2. PendingIntent with ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED
         * 3. Direct startActivity with FLAG_ACTIVITY_NEW_TASK
         * 4. FullScreenIntent notification fallback for Keyguard presentation
         */
        fun start(context: Context) {
            Log.w(TAG, "🚨 Requesting IntruderCaptureActivity launch over lock screen")
            val appContext = context.applicationContext
            ensureChannel(appContext)

            // 1. Wake screen up so Keyguard window is active
            try {
                val pm = appContext.getSystemService(Context.POWER_SERVICE) as? PowerManager
                @Suppress("DEPRECATION")
                val wakeLock = pm?.newWakeLock(
                    PowerManager.SCREEN_BRIGHT_WAKE_LOCK or
                    PowerManager.ACQUIRE_CAUSES_WAKEUP or
                    PowerManager.ON_AFTER_RELEASE,
                    "MobTrack:IntruderLaunchWakeLock"
                )
                wakeLock?.acquire(12000L)
            } catch (e: Exception) {
                Log.w(TAG, "Launch wakeLock error: ${e.message}")
            }

            // 2. Build Intent with necessary task flags
            val intent = Intent(appContext, IntruderCaptureActivity::class.java).apply {
                addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
                )
                putExtra("trigger_time", System.currentTimeMillis())
            }

            // 3. Build ActivityOptions with background activity start allowance (Android 14+)
            val options = ActivityOptions.makeBasic()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                options.setPendingIntentBackgroundActivityStartMode(
                    ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED
                )
            }
            val optionsBundle = options.toBundle()

            val pendingIntent = PendingIntent.getActivity(
                appContext,
                NOTIFICATION_ID,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
            )

            // 4. Send via PendingIntent with MODE_BACKGROUND_ACTIVITY_START_ALLOWED
            try {
                pendingIntent.send(appContext, 0, null, null, null, null, optionsBundle)
                Log.d(TAG, "pendingIntent.send executed")
            } catch (e: Exception) {
                Log.w(TAG, "pendingIntent.send failed: ${e.message}")
            }

            // 5. Direct startActivity fallback
            try {
                appContext.startActivity(intent, optionsBundle)
                Log.d(TAG, "Direct appContext.startActivity executed")
            } catch (e: Exception) {
                Log.w(TAG, "Direct appContext.startActivity failed: ${e.message}")
            }

            // 6. High-priority full-screen intent notification fallback
            try {
                val notification = NotificationCompat.Builder(appContext, CHANNEL_ID)
                    .setSmallIcon(android.R.drawable.ic_lock_lock)
                    .setContentTitle("Security Check")
                    .setContentText("Verifying access...")
                    .setPriority(NotificationCompat.PRIORITY_MAX)
                    .setCategory(NotificationCompat.CATEGORY_ALARM)
                    .setFullScreenIntent(pendingIntent, true)
                    .setAutoCancel(true)
                    .setOngoing(false)
                    .build()

                val nm = appContext.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
                nm?.notify(NOTIFICATION_ID, notification)
            } catch (e: Exception) {
                Log.w(TAG, "Notification post failed: ${e.message}")
            }
        }
    }

    private var wakeLock: PowerManager.WakeLock? = null
    private val activityScope = CoroutineScope(Dispatchers.Main)
    private val cameraExecutor = Executors.newSingleThreadExecutor()
    private val isFinished = AtomicBoolean(false)
    private var cameraProvider: ProcessCameraProvider? = null
    private var previewView: PreviewView? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        // Must configure lockscreen flags before and during onCreate
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        }
        @Suppress("DEPRECATION")
        window.addFlags(
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
            WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
            WindowManager.LayoutParams.FLAG_ALLOW_LOCK_WHILE_SCREEN_ON
        )

        super.onCreate(savedInstanceState)
        isFinished.set(false)

        Log.d(TAG, "IntruderCaptureActivity onCreate - configuring transparent window over Keyguard")

        // 1. Window styling: 1x1 pixel, transparent, non-blocking touch pass-through
        window.setBackgroundDrawableResource(android.R.color.transparent)
        window.attributes = window.attributes.apply {
            alpha = 0.01f
            dimAmount = 0.0f
            width = 1
            height = 1
            gravity = Gravity.TOP or Gravity.START
            flags = flags or
                    WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
        }

        // 2. Disable activity transition animations
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            overrideActivityTransition(OVERRIDE_TRANSITION_OPEN, 0, 0)
            overrideActivityTransition(OVERRIDE_TRANSITION_CLOSE, 0, 0)
        } else {
            @Suppress("DEPRECATION")
            overridePendingTransition(0, 0)
        }

        // 3. Acquire Activity WakeLock
        acquireWakeLock()

        // 4. Setup 1x1 PreviewView (COMPATIBLE mode uses TextureView for guaranteed 3A convergence)
        val root = FrameLayout(this).apply {
            layoutParams = ViewGroup.LayoutParams(1, 1)
            setBackgroundColor(android.graphics.Color.TRANSPARENT)
        }
        val preview = PreviewView(this).apply {
            layoutParams = FrameLayout.LayoutParams(1, 1)
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
            alpha = 0.01f
        }
        previewView = preview
        root.addView(preview)
        setContentView(root)

        // 5. Safety watchdog: force finish after 12s if anything stalls
        Handler(Looper.getMainLooper()).postDelayed({
            if (!isFinished.get()) {
                Log.w(TAG, "Safety watchdog triggered after 12s — finishing activity")
                finishAndCleanup()
            }
        }, 12000L)

        // 6. Bind CameraX and capture
        initializeCamera(preview)
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        Log.d(TAG, "onNewIntent received")
        if (isFinished.get()) {
            isFinished.set(false)
            previewView?.let { initializeCamera(it) }
        }
    }

    private fun acquireWakeLock() {
        try {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            @Suppress("DEPRECATION")
            wakeLock = pm.newWakeLock(
                PowerManager.SCREEN_BRIGHT_WAKE_LOCK or
                PowerManager.ACQUIRE_CAUSES_WAKEUP or
                PowerManager.ON_AFTER_RELEASE,
                "MobTrack:IntruderCaptureActivity"
            ).also { it.acquire(15000L) }
        } catch (e: Exception) {
            Log.w(TAG, "WakeLock acquisition failed: ${e.message}")
        }
    }

    private fun initializeCamera(pv: PreviewView) {
        val future = ProcessCameraProvider.getInstance(this)
        future.addListener({
            try {
                val provider = future.get()
                cameraProvider = provider
                try { provider.unbindAll() } catch (_: Exception) {}

                val selector = if (provider.hasCamera(CameraSelector.DEFAULT_FRONT_CAMERA)) {
                    CameraSelector.DEFAULT_FRONT_CAMERA
                } else {
                    CameraSelector.DEFAULT_BACK_CAMERA
                }

                val preview = Preview.Builder().build()
                preview.setSurfaceProvider(pv.surfaceProvider)

                val imageCapture = ImageCapture.Builder()
                    .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                    .setFlashMode(ImageCapture.FLASH_MODE_OFF)
                    .build()

                // Bind to this Activity's lifecycle — recognized by Android as PROCESS_STATE_TOP!
                provider.bindToLifecycle(this, selector, preview, imageCapture)
                Log.d(TAG, "CameraX successfully bound to IntruderCaptureActivity")

                startBurstCapture(imageCapture)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to bind CameraX in IntruderCaptureActivity: ${e.message}", e)
                finishAndCleanup()
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun startBurstCapture(imageCapture: ImageCapture) {
        activityScope.launch {
            val storageDir = File(filesDir, "intruder_photos").apply { mkdirs() }
            var successCount = 0

            Log.w(TAG, "📸 Starting $BURST_COUNT-shot silent intruder capture...")
            // Allow 350ms for CameraX 3A auto-exposure to converge on front camera sensor
            delay(350L)

            for (shot in 1..BURST_COUNT) {
                val ts = SupabaseUploadHelper.formatTimestamp(System.currentTimeMillis())
                val photoFile = File(storageDir, "intruder_${ts}_shot${shot}.jpg")

                val success = withTimeoutOrNull(3500L) {
                    captureOneShot(imageCapture, photoFile)
                } ?: false

                if (success) {
                    successCount++
                    Log.d(TAG, "Intruder photo $shot/$BURST_COUNT saved: ${photoFile.name}")
                    CoroutineScope(Dispatchers.IO).launch {
                        recordAndUploadPhoto(photoFile)
                    }
                } else {
                    Log.w(TAG, "Intruder photo $shot/$BURST_COUNT failed to capture or timed out")
                }

                if (shot < BURST_COUNT) {
                    delay(BURST_DELAY_MS)
                }
            }

            Log.d(TAG, "Intruder burst finished ($successCount/$BURST_COUNT captured). Exiting.")
            try {
                val nm = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
                nm?.cancel(NOTIFICATION_ID)
            } catch (_: Exception) {}
            finishAndCleanup()
        }
    }

    private suspend fun captureOneShot(imageCapture: ImageCapture, outputFile: File): Boolean {
        return suspendCancellableCoroutine { cont ->
            val options = ImageCapture.OutputFileOptions.Builder(outputFile).build()
            imageCapture.takePicture(
                options,
                cameraExecutor,
                object : ImageCapture.OnImageSavedCallback {
                    override fun onImageSaved(results: ImageCapture.OutputFileResults) {
                        if (cont.isActive) cont.resume(true)
                    }

                    override fun onError(exception: ImageCaptureException) {
                        Log.e(TAG, "takePicture failed: ${exception.message}", exception)
                        if (cont.isActive) cont.resume(false)
                    }
                }
            )
        }
    }

    private fun recordAndUploadPhoto(photoFile: File) {
        val timestamp = System.currentTimeMillis()
        val prefs = getSharedPreferences("intruder_prefs", Context.MODE_PRIVATE)

        try {
            val history = JSONArray(prefs.getString("capture_history", "[]") ?: "[]")
            history.put(JSONObject().apply {
                put("filePath", photoFile.absolutePath)
                put("timestamp", timestamp)
                put("status", "SAVED_LOCAL")
            })
            prefs.edit().putString("capture_history", history.toString()).apply()

            // Also mirror to device protected storage if available
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                try {
                    val dePrefs = createDeviceProtectedStorageContext().getSharedPreferences("intruder_prefs", Context.MODE_PRIVATE)
                    dePrefs.edit().putString("capture_history", history.toString()).apply()
                } catch (_: Exception) {}
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to record local history: ${e.message}")
        }

        if (SupabaseUploadHelper.isOnline(this)) {
            val uploadedPath = SupabaseUploadHelper.uploadPhotoSync(this, photoFile, "intruder")
            if (uploadedPath != null) {
                Log.d(TAG, "Successfully uploaded intruder photo: $uploadedPath")
                updateHistoryStatus(photoFile.absolutePath, "UPLOADED", uploadedPath)
            } else {
                Log.w(TAG, "Direct upload failed, queuing for retry")
                queueForOfflineUpload(photoFile, timestamp)
            }
        } else {
            Log.d(TAG, "Device is offline — queuing photo for background upload")
            queueForOfflineUpload(photoFile, timestamp)
        }
    }

    private fun updateHistoryStatus(localPath: String, status: String, storagePath: String?) {
        try {
            val prefs = getSharedPreferences("intruder_prefs", Context.MODE_PRIVATE)
            val history = JSONArray(prefs.getString("capture_history", "[]") ?: "[]")
            for (i in 0 until history.length()) {
                val item = history.getJSONObject(i)
                if (item.optString("filePath") == localPath) {
                    item.put("status", status)
                    if (storagePath != null) item.put("storagePath", storagePath)
                    break
                }
            }
            prefs.edit().putString("capture_history", history.toString()).apply()
        } catch (e: Exception) {
            Log.w(TAG, "Failed to update history status: ${e.message}")
        }
    }

    private fun queueForOfflineUpload(photoFile: File, timestamp: Long) {
        try {
            val prefs = getSharedPreferences("intruder_prefs", Context.MODE_PRIVATE)
            val queue = JSONArray(prefs.getString("pending_uploads", "[]") ?: "[]")
            queue.put(JSONObject().apply {
                put("filePath", photoFile.absolutePath)
                put("timestamp", timestamp)
            })
            prefs.edit().putString("pending_uploads", queue.toString()).apply()
            IntruderUploadWorker.enqueue(applicationContext)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to queue offline upload: ${e.message}")
        }
    }

    private fun finishAndCleanup() {
        if (isFinished.getAndSet(true)) return
        Log.d(TAG, "finishAndCleanup")

        try {
            cameraProvider?.unbindAll()
        } catch (e: Exception) {
            Log.w(TAG, "Error unbinding CameraX: ${e.message}")
        }

        try { cameraExecutor.shutdown() } catch (_: Exception) {}
        try { activityScope.cancel() } catch (_: Exception) {}
        try { wakeLock?.let { if (it.isHeld) it.release() } } catch (_: Exception) {}

        finish()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            overrideActivityTransition(OVERRIDE_TRANSITION_CLOSE, 0, 0)
        } else {
            @Suppress("DEPRECATION")
            overridePendingTransition(0, 0)
        }
    }

    override fun onDestroy() {
        isFinished.set(true)
        try { activityScope.cancel() } catch (_: Exception) {}
        try { cameraProvider?.unbindAll() } catch (_: Exception) {}
        try { cameraExecutor.shutdown() } catch (_: Exception) {}
        try { wakeLock?.let { if (it.isHeld) it.release() } } catch (_: Exception) {}
        super.onDestroy()
        Log.d(TAG, "IntruderCaptureActivity onDestroy")
    }
}
