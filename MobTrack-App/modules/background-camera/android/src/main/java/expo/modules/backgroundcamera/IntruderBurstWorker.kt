package expo.modules.backgroundcamera

import android.content.Context
import android.content.pm.ServiceInfo
import android.graphics.PixelFormat
import android.os.Build
import android.util.Log
import android.view.Gravity
import android.view.WindowManager
import android.widget.FrameLayout
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * IntruderBurstWorker — WorkManager expedited worker for Android 14–17 compatibility.
 *
 * Key Android 14+ fixes applied here:
 *
 * 1. WorkManager expedited job (not direct foreground service) — avoids the
 *    background-start restriction when triggered from DeviceAdminReceiver.
 *
 * 2. SYSTEM_ALERT_WINDOW overlay trick — on Android 14/15, CameraX requires
 *    a visible window surface to bind to a LifecycleOwner from the background.
 *    We inflate a 1×1 transparent overlay (invisible to user), bind camera to it,
 *    then destroy it after capture. This bypasses the "no UI context" restriction.
 *
 * 3. PARTIAL_WAKE_LOCK — keeps CPU awake while screen is off.
 *
 * Behaviour: Takes 3 photos with 1-second delay between each, on every
 * failed PIN attempt at or beyond the configured threshold.
 */
class IntruderBurstWorker(
    private val appContext: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams), LifecycleOwner {

    companion object {
        private const val TAG = "IntruderBurstWorker"
        private const val WORK_NAME = "IntruderBurstCaptureWork"
        private const val BURST_COUNT = 3
        private const val BURST_DELAY_MS = 1000L
        private const val NOTIFICATION_ID = 2003
        private const val CHANNEL_ID = "mobtrack_intruder_channel"

        fun enqueue(context: Context) {
            val workRequest = OneTimeWorkRequestBuilder<IntruderBurstWorker>()
                .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                .build()

            // REPLACE: each failed attempt beyond threshold triggers an immediate burst capture
            WorkManager.getInstance(context).enqueueUniqueWork(
                WORK_NAME,
                ExistingWorkPolicy.REPLACE,
                workRequest
            )
            Log.d(TAG, "Enqueued IntruderBurstWorker (expedited)")
        }
    }

    private val lifecycleRegistry = LifecycleRegistry(this)
    private val cameraExecutor = Executors.newSingleThreadExecutor()

    // The 1×1 overlay window — needed on Android 14+ to give CameraX a window surface
    private var overlayView: FrameLayout? = null
    private var windowManager: WindowManager? = null

    override fun getLifecycle(): Lifecycle = lifecycleRegistry

    override suspend fun getForegroundInfo(): ForegroundInfo {
        val notification = IntruderCaptureService.buildWorkerNotification(
            appContext, CHANNEL_ID, NOTIFICATION_ID
        )
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ForegroundInfo(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA)
        } else {
            ForegroundInfo(NOTIFICATION_ID, notification)
        }
    }

    override suspend fun doWork(): Result = withContext(Dispatchers.Main) {
        Log.d(TAG, "IntruderBurstWorker started — capturing $BURST_COUNT photos")
        // Advance lifecycle in correct order: INITIALIZED → CREATED → STARTED → RESUMED
        lifecycleRegistry.handleLifecycleEvent(androidx.lifecycle.Lifecycle.Event.ON_CREATE)
        lifecycleRegistry.handleLifecycleEvent(androidx.lifecycle.Lifecycle.Event.ON_START)

        // ── 1. Wake lock to prevent CPU sleep while screen is off ────────────
        var wakeLock: android.os.PowerManager.WakeLock? = null
        try {
            val pm = appContext.getSystemService(Context.POWER_SERVICE) as? android.os.PowerManager
            wakeLock = pm?.newWakeLock(
                android.os.PowerManager.PARTIAL_WAKE_LOCK,
                "MobTrack:IntruderBurstWorker"
            )?.apply { acquire(60000L) } // 60s max
        } catch (e: Exception) {
            Log.w(TAG, "Could not acquire WakeLock: ${e.message}")
        }

        // ── 2. Set foreground notification ───────────────────────────────────
        try {
            setForeground(getForegroundInfo())
        } catch (e: Exception) {
            Log.w(TAG, "setForeground failed: ${e.message}")
        }

        // ── 3. SYSTEM_ALERT_WINDOW overlay (Android 14+ camera bypass) ──────
        val hasOverlayPermission = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            android.provider.Settings.canDrawOverlays(appContext)
        } else true

        if (hasOverlayPermission) {
            try {
                val wm = appContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager
                windowManager = wm
                val view = FrameLayout(appContext)
                overlayView = view

                val layoutType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                } else {
                    @Suppress("DEPRECATION")
                    WindowManager.LayoutParams.TYPE_PHONE
                }

                val params = WindowManager.LayoutParams(
                    1, 1, // 1×1 pixel — invisible to user
                    layoutType,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                    WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                    PixelFormat.TRANSLUCENT
                ).apply {
                    gravity = Gravity.TOP or Gravity.START
                    x = 0; y = 0
                }

                wm.addView(view, params)
                Log.d(TAG, "Overlay window added for Android 14+ camera access")
                delay(200L) // Let the window attach before camera binds
            } catch (e: Exception) {
                Log.w(TAG, "Could not add overlay window: ${e.message}")
                overlayView = null
                windowManager = null
            }
        } else {
            Log.w(TAG, "SYSTEM_ALERT_WINDOW not granted — camera may fail on Android 14+")
        }

        lifecycleRegistry.handleLifecycleEvent(androidx.lifecycle.Lifecycle.Event.ON_RESUME)

        val storageDir = File(appContext.filesDir, "intruder_photos").apply { mkdirs() }
        var capturedCount = 0

        try {
            // ── 4. Bind CameraX ──────────────────────────────────────────────
            val cameraProvider = suspendCancellableCoroutine<ProcessCameraProvider> { cont ->
                val future = ProcessCameraProvider.getInstance(appContext)
                future.addListener({
                    try { cont.resume(future.get()) }
                    catch (e: Exception) { cont.resumeWithException(e) }
                }, ContextCompat.getMainExecutor(appContext))
            }

            val imageCapture = ImageCapture.Builder()
                .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                .setFlashMode(ImageCapture.FLASH_MODE_OFF)
                .build()

            cameraProvider.unbindAll()
            val cameraSelector = if (cameraProvider.hasCamera(CameraSelector.DEFAULT_FRONT_CAMERA))
                CameraSelector.DEFAULT_FRONT_CAMERA
            else
                CameraSelector.DEFAULT_BACK_CAMERA

            cameraProvider.bindToLifecycle(this@IntruderBurstWorker, cameraSelector, imageCapture)
            Log.d(TAG, "CameraX bound for burst capture")

            // Brief delay for sensor auto-exposure to stabilise
            delay(500L)

            // ── 5. Capture burst ─────────────────────────────────────────────
            for (shot in 1..BURST_COUNT) {
                val ts = SupabaseUploadHelper.formatTimestamp(System.currentTimeMillis())
                val photoFile = File(storageDir, "intruder_${ts}_shot${shot}.jpg")

                val captured = capturePhotoToFile(imageCapture, photoFile)
                if (captured) {
                    capturedCount++
                    Log.d(TAG, "Shot $shot/$BURST_COUNT captured: ${photoFile.name}")
                    recordAndUpload(photoFile)
                } else {
                    Log.w(TAG, "Shot $shot/$BURST_COUNT failed")
                }

                if (shot < BURST_COUNT) delay(BURST_DELAY_MS)
            }

            cameraProvider.unbindAll()

        } catch (e: Exception) {
            Log.e(TAG, "Burst capture error: ${e.message}", e)
        } finally {
            lifecycleRegistry.handleLifecycleEvent(androidx.lifecycle.Lifecycle.Event.ON_DESTROY)
            cameraExecutor.shutdown()
            removeOverlay()
            wakeLock?.let { if (it.isHeld) it.release() }
        }

        Log.d(TAG, "IntruderBurstWorker done — $capturedCount/$BURST_COUNT photos captured")
        Result.success()
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

    /** Suspending wrapper around CameraX takePicture. Returns true on success. */
    private suspend fun capturePhotoToFile(imageCapture: ImageCapture, outputFile: File): Boolean =
        suspendCancellableCoroutine { cont ->
            val outputOptions = ImageCapture.OutputFileOptions.Builder(outputFile).build()
            imageCapture.takePicture(
                outputOptions,
                cameraExecutor,
                object : ImageCapture.OnImageSavedCallback {
                    override fun onImageSaved(result: ImageCapture.OutputFileResults) {
                        cont.resume(true)
                    }
                    override fun onError(exc: ImageCaptureException) {
                        Log.e(TAG, "takePicture error: ${exc.message}")
                        cont.resume(false)
                    }
                }
            )
        }

    private fun recordAndUpload(photoFile: File) {
        val timestamp = System.currentTimeMillis()
        val prefs = appContext.getSharedPreferences("intruder_prefs", Context.MODE_PRIVATE)

        // Record in local history
        try {
            val history = JSONArray(prefs.getString("capture_history", "[]") ?: "[]")
            history.put(JSONObject().apply {
                put("filePath", photoFile.absolutePath)
                put("timestamp", timestamp)
                put("status", "SAVED_LOCAL")
            })
            prefs.edit().putString("capture_history", history.toString()).apply()
        } catch (e: Exception) {
            Log.w(TAG, "Failed to record capture history", e)
        }

        // Upload on IO thread with dedicated WakeLock to ensure upload finishes even if device sleeps
        CoroutineScope(Dispatchers.IO).launch {
            var uploadWakeLock: android.os.PowerManager.WakeLock? = null
            try {
                val pm = appContext.getSystemService(Context.POWER_SERVICE) as? android.os.PowerManager
                uploadWakeLock = pm?.newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK, "MobTrack:UploadWakeLock")
                uploadWakeLock?.acquire(30000L)

                if (SupabaseUploadHelper.isOnline(appContext)) {
                    val filePath = SupabaseUploadHelper.uploadPhotoSync(appContext, photoFile, "intruder")
                    if (filePath != null) {
                        updateHistoryStatus(photoFile.absolutePath, "UPLOADED", filePath)
                        Log.d(TAG, "Upload success: $filePath")
                    } else {
                        Log.w(TAG, "Upload failed, queuing for retry")
                        queueForOfflineUpload(photoFile, timestamp)
                    }
                } else {
                    Log.d(TAG, "Offline — queuing photo for later upload")
                    queueForOfflineUpload(photoFile, timestamp)
                }
            } finally {
                uploadWakeLock?.let { if (it.isHeld) it.release() }
            }
        }
    }

    private fun updateHistoryStatus(localPath: String, status: String, filePath: String?) {
        try {
            val prefs = appContext.getSharedPreferences("intruder_prefs", Context.MODE_PRIVATE)
            val history = JSONArray(prefs.getString("capture_history", "[]") ?: "[]")
            for (i in 0 until history.length()) {
                val item = history.getJSONObject(i)
                if (item.optString("filePath") == localPath) {
                    item.put("status", status)
                    if (filePath != null) item.put("storagePath", filePath)
                    break
                }
            }
            prefs.edit().putString("capture_history", history.toString()).apply()
        } catch (e: Exception) {
            Log.w(TAG, "Failed to update history status", e)
        }
    }

    private fun queueForOfflineUpload(photoFile: File, timestamp: Long) {
        try {
            val prefs = appContext.getSharedPreferences("intruder_prefs", Context.MODE_PRIVATE)
            val queue = JSONArray(prefs.getString("pending_uploads", "[]") ?: "[]")
            queue.put(JSONObject().apply {
                put("filePath", photoFile.absolutePath)
                put("timestamp", timestamp)
            })
            prefs.edit().putString("pending_uploads", queue.toString()).apply()
            IntruderUploadWorker.enqueue(appContext)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to queue for offline upload", e)
        }
    }
}
