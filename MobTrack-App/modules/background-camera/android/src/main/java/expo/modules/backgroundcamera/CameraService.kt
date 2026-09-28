package expo.modules.backgroundcamera

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageFormat
import android.graphics.Matrix
import android.graphics.Rect
import android.graphics.YuvImage
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.util.Base64
import android.util.Log
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.concurrent.Executors

class CameraService : Service(), LifecycleOwner {

    companion object {
        var instance: CameraService? = null
            private set

        private const val TAG = "CameraService"
        const val EXTRA_ACTIVATE_CAMERA = "mobtrack_activate_camera"
        private const val CHANNEL_ID = "mobtrack_camera_service"
        private const val NOTIFICATION_ID = 1001
    }

    private val lifecycleRegistry: LifecycleRegistry = LifecycleRegistry(this)
    private val mainHandler = Handler(Looper.getMainLooper())
    private val analysisExecutor = Executors.newSingleThreadExecutor()

    private var imageCapture: ImageCapture? = null
    private var imageAnalysis: ImageAnalysis? = null
    private var cameraProvider: ProcessCameraProvider? = null
    private var cameraReady = false
    private var cameraInitInProgress = false
    private var lastInitError: String? = null
    private var wakeLock: PowerManager.WakeLock? = null

    // Video streaming state
    private var isStreaming = false
    private var lastFrameTime = 0L
    private val frameIntervalMs = 100L // ~10 fps
    var onVideoFrame: ((String) -> Unit)? = null

    override fun getLifecycle(): Lifecycle = lifecycleRegistry

    override fun onCreate() {
        super.onCreate()
        instance = this
        lifecycleRegistry.markState(Lifecycle.State.INITIALIZED)
        Log.d(TAG, "Service created")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val activateCamera = intent?.getBooleanExtra(EXTRA_ACTIVATE_CAMERA, false) ?: false
        createNotificationChannel()
        val notification = buildNotification()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        if (activateCamera) {
            activateCamera { error ->
                if (error != null) Log.e(TAG, "Camera activation failed: $error")
            }
            Log.d(TAG, "Camera activated — background capture is available while this session remains active")
        } else {
            Log.d(TAG, "Foreground session service started — camera hardware remains off until explicitly activated")
        }
        // Restart the service automatically if Android terminates it under memory pressure.
        return START_STICKY
    }

    override fun onDestroy() {
        Log.d(TAG, "Service destroying")
        isStreaming = false
        cameraReady = false
        cameraInitInProgress = false
        onVideoFrame = null
        try { cameraProvider?.unbindAll() } catch (e: Exception) { Log.w(TAG, "Error unbinding camera", e) }
        mainHandler.removeCallbacksAndMessages(null)
        analysisExecutor.shutdown()
        lifecycleRegistry.markState(Lifecycle.State.DESTROYED)
        wakeLock?.let { if (it.isHeld) it.release() }
        instance = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    /**
     * Do not report the camera as active until CameraX has actually bound it.
     * This keeps the dashboard state aligned with the Android privacy indicator
     * and prevents a false "active" status when the device has no available
     * front camera or the camera is already in use by another app.
     */
    fun activateCamera(onReady: (String?) -> Unit) {
        mainHandler.post {
            if (cameraReady && imageCapture != null) {
                onReady(null)
                return@post
            }
            if (wakeLock?.isHeld != true) {
                val powerManager = getSystemService(POWER_SERVICE) as PowerManager
                wakeLock = powerManager.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK,
                    "MobTrack:CameraService"
                ).also { it.acquire() }
            }
            lifecycleRegistry.markState(Lifecycle.State.RESUMED)
            initCamera()
            waitForCameraReady(onReady, 0)
        }
    }

    private fun waitForCameraReady(onReady: (String?) -> Unit, attempt: Int) {
        if (cameraReady && imageCapture != null) {
            onReady(null)
            return
        }

        if (!cameraInitInProgress && lastInitError != null) {
            releaseCameraAfterFailedActivation()
            onReady(lastInitError ?: "Camera initialization failed")
            return
        }

        if (attempt >= 50) {
            val detail = lastInitError?.let { ": $it" } ?: ""
            releaseCameraAfterFailedActivation()
            onReady("Camera was not ready after 10 seconds$detail")
            return
        }

        mainHandler.postDelayed({ waitForCameraReady(onReady, attempt + 1) }, 200L)
    }

    private fun releaseCameraAfterFailedActivation() {
        cameraReady = false
        cameraInitInProgress = false
        imageCapture = null
        try { cameraProvider?.unbindAll() } catch (e: Exception) { Log.w(TAG, "Error releasing failed camera", e) }
        lifecycleRegistry.markState(Lifecycle.State.STARTED)
        wakeLock?.let { if (it.isHeld) it.release() }
    }

    fun deactivateCamera(onComplete: () -> Unit) {
        mainHandler.post {
            isStreaming = false
            cameraReady = false
            cameraInitInProgress = false
            imageCapture = null
            imageAnalysis = null
            try { cameraProvider?.unbindAll() } catch (e: Exception) { Log.w(TAG, "Error releasing camera", e) }
            lifecycleRegistry.markState(Lifecycle.State.STARTED)
            wakeLock?.let { if (it.isHeld) it.release() }
            Log.d(TAG, "Camera deactivated — foreground session remains visible")
            onComplete()
        }
    }

    /**
     * Start live video streaming.
     * Activates camera (if not already active) and sets up ImageAnalysis
     * to emit JPEG frames via the onVideoFrame callback at ~10fps.
     */
    fun startVideoStream(onReady: (String?) -> Unit) {
        mainHandler.post {
            isStreaming = true
            if (wakeLock?.isHeld != true) {
                val powerManager = getSystemService(POWER_SERVICE) as PowerManager
                wakeLock = powerManager.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK,
                    "MobTrack:VideoStream"
                ).also { it.acquire() }
            }
            lifecycleRegistry.markState(Lifecycle.State.RESUMED)
            initCameraWithAnalysis()
            waitForCameraReady(onReady, 0)
        }
    }

    /**
     * Stop live video streaming.
     */
    fun stopVideoStream(onComplete: () -> Unit) {
        mainHandler.post {
            isStreaming = false
            Log.d(TAG, "Video stream stopped")
            onComplete()
        }
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // Anti-theft persistence: Swiping the app away from recents must NOT kill
        // the camera service. The service remains active in the foreground so the owner
        // can capture photos or stream video remotely if the device is stolen.
        Log.d(TAG, "App task removed from recents — keeping anti-theft camera service active")
        super.onTaskRemoved(rootIntent)
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "MobTrack remote session",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows when your authorized remote device session is active"
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
            .setContentTitle("MobTrack remote session active")
            .setContentText("Camera access is available for your linked dashboard")
            .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun initCamera() {
        if (cameraReady || cameraInitInProgress) return
        cameraInitInProgress = true
        lastInitError = null
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
                lastInitError = e.message
            } finally {
                cameraInitInProgress = false
            }
        }, ContextCompat.getMainExecutor(this))
    }

    /**
     * Initialize camera with both ImageCapture (for still photos) and
     * ImageAnalysis (for live streaming). Binds both use cases to the lifecycle.
     */
    private fun initCameraWithAnalysis() {
        if (cameraReady || cameraInitInProgress) return
        cameraInitInProgress = true
        lastInitError = null

        val cameraProviderFuture = ProcessCameraProvider.getInstance(this)
        cameraProviderFuture.addListener({
            try {
                cameraProvider = cameraProviderFuture.get()

                imageCapture = ImageCapture.Builder()
                    .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                    .setTargetRotation(android.view.Surface.ROTATION_0)
                    .build()

                imageAnalysis = ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build().also { analysis ->
                        analysis.setAnalyzer(analysisExecutor) { imageProxy ->
                            processFrame(imageProxy)
                        }
                    }

                cameraProvider?.unbindAll()
                cameraProvider?.bindToLifecycle(
                    this@CameraService,
                    CameraSelector.DEFAULT_FRONT_CAMERA,
                    imageCapture,
                    imageAnalysis
                )
                cameraReady = true
                Log.d(TAG, "CameraX initialized with ImageAnalysis — front camera bound for live stream")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to initialize CameraX with analysis", e)
                cameraReady = false
                lastInitError = e.message
            } finally {
                cameraInitInProgress = false
            }
        }, ContextCompat.getMainExecutor(this))
    }

    /**
     * Process each camera frame from ImageAnalysis.
     * Converts YUV to JPEG, base64 encodes it, and emits via callback at ~10fps.
     */
    private fun processFrame(imageProxy: ImageProxy) {
        try {
            if (!isStreaming) {
                imageProxy.close()
                return
            }

            val now = System.currentTimeMillis()
            if (now - lastFrameTime < frameIntervalMs) {
                imageProxy.close()
                return
            }
            lastFrameTime = now

            val base64Frame = imageProxyToBase64Jpeg(imageProxy)
            if (base64Frame != null) {
                onVideoFrame?.invoke(base64Frame)
            }
        } finally {
            imageProxy.close()
        }
    }

    /**
     * Convert an ImageProxy (YUV_420_888) to a base64-encoded JPEG string.
     */
    private fun imageProxyToBase64Jpeg(imageProxy: ImageProxy): String? {
        return try {
            val yBuffer = imageProxy.planes[0].buffer
            val uBuffer = imageProxy.planes[1].buffer
            val vBuffer = imageProxy.planes[2].buffer

            val ySize = yBuffer.remaining()
            val uSize = uBuffer.remaining()
            val vSize = vBuffer.remaining()

            val nv21 = ByteArray(ySize + uSize + vSize)
            yBuffer.get(nv21, 0, ySize)
            vBuffer.get(nv21, ySize, vSize)
            uBuffer.get(nv21, ySize + vSize, uSize)

            val yuvImage = YuvImage(nv21, ImageFormat.NV21, imageProxy.width, imageProxy.height, null)
            val out = ByteArrayOutputStream()
            // Compress at ~60% quality for balance between quality and bandwidth
            yuvImage.compressToJpeg(Rect(0, 0, imageProxy.width, imageProxy.height), 60, out)

            // Rotate the image to match device orientation (front camera is typically rotated)
            val jpegBytes = out.toByteArray()
            val bitmap = BitmapFactory.decodeByteArray(jpegBytes, 0, jpegBytes.size)
            val matrix = Matrix().apply {
                postRotate(imageProxy.imageInfo.rotationDegrees.toFloat())
                // Mirror front camera horizontally so it feels natural
                postScale(-1f, 1f, bitmap.width / 2f, bitmap.height / 2f)
            }
            val rotatedBitmap = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
            bitmap.recycle()

            val finalOut = ByteArrayOutputStream()
            rotatedBitmap.compress(Bitmap.CompressFormat.JPEG, 60, finalOut)
            rotatedBitmap.recycle()

            Base64.encodeToString(finalOut.toByteArray(), Base64.NO_WRAP)
        } catch (e: Exception) {
            Log.w(TAG, "Frame processing error: ${e.message}")
            null
        }
    }

    fun capturePhoto(callback: (String?, String?) -> Unit) {
        // Realtime can deliver the first request immediately after startService().
        // Queue it briefly instead of reporting a false failure while CameraX
        // is still binding in the foreground service.
        mainHandler.post { captureWhenReady(callback, 0) }
    }

    private fun captureWhenReady(callback: (String?, String?) -> Unit, attempt: Int) {
        val capture = imageCapture
        if (!cameraReady || capture == null) {
            if (!cameraInitInProgress && attempt == 0) initCamera()
            if (attempt >= 50) {
                val detail = lastInitError?.let { ": $it" } ?: ""
                Log.w(TAG, "capturePhoto timed out waiting for camera")
                callback(null, "Camera was not ready after 10 seconds$detail")
            } else {
                mainHandler.postDelayed({ captureWhenReady(callback, attempt + 1) }, 200L)
            }
            return
        }

        val outputFile = File(cacheDir, "capture_${System.currentTimeMillis()}.jpg")
        val outputOptions = ImageCapture.OutputFileOptions.Builder(outputFile).build()
        Log.d(TAG, "Taking photo...")
        capture.takePicture(outputOptions, ContextCompat.getMainExecutor(this),
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
                    outputFile.delete()
                    // Rebind once if Android closed the camera during a
                    // visibility/doze transition before reporting failure.
                    if (attempt < 2) {
                        Log.w(TAG, "Camera capture failed; rebinding and retrying", exc)
                        cameraReady = false
                        try { cameraProvider?.unbindAll() } catch (e: Exception) { Log.w(TAG, "Error rebinding camera", e) }
                        initCamera()
                        mainHandler.postDelayed({ captureWhenReady(callback, attempt + 1) }, 400L)
                    } else {
                        callback(null, "Capture failed: ${exc.message ?: exc.imageCaptureError}")
                    }
                }
            })
    }
}
