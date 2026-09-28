package expo.modules.backgroundaudio

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Base64
import android.util.Log

class AudioRecordingService : Service() {

    companion object {
        var instance: AudioRecordingService? = null
            private set
        var chunkCallback: ((String) -> Unit)? = null

        private const val TAG = "AudioRecordingService"
        private const val CHANNEL_ID = "mobtrack_audio_service"
        private const val NOTIFICATION_ID = 1002

        private const val SAMPLE_RATE  = 16000
        private const val CHANNEL_CONFIG  = AudioFormat.CHANNEL_IN_MONO
        private const val AUDIO_FORMAT    = AudioFormat.ENCODING_PCM_16BIT
        private const val CHUNK_SAMPLES   = SAMPLE_RATE / 2   // 500 ms
        private const val CHUNK_BYTES     = CHUNK_SAMPLES * 2
    }

    @Volatile private var isRecording = false
    private var recordingThread: Thread? = null
    private var wakeLock: PowerManager.WakeLock? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        Log.d(TAG, "Service created")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        ensureNotificationChannel()
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        // Keep CPU awake even when screen is off
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "MobTrack:AudioService").also { it.acquire() }

        startRecordingLoop()
        Log.d(TAG, "Foreground service started — screen-off audio enabled")
        return START_STICKY
    }

    override fun onDestroy() {
        Log.d(TAG, "Service destroying")
        stopRecordingLoop()
        wakeLock?.let { if (it.isHeld) it.release() }
        instance = null
        chunkCallback = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(NotificationManager::class.java) ?: return
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return
        val ch = NotificationChannel(CHANNEL_ID, "MobTrack microphone session", NotificationManager.IMPORTANCE_LOW).apply {
            setShowBadge(false); enableLights(false); enableVibration(false); setSound(null, null)
        }
        nm.createNotificationChannel(ch)
    }

    private fun buildNotification(): Notification {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
                .setContentTitle("MobTrack microphone active")
                .setContentText("Audio is being shared with your linked dashboard")
                .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
                .setOngoing(true)
                .setCategory(Notification.CATEGORY_SERVICE)
                .build()
        } else {
            @Suppress("DEPRECATION")
            android.app.Notification.Builder(this)
                .setContentTitle("MobTrack microphone active")
                .setContentText("Audio is being shared with your linked dashboard")
                .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
                .setOngoing(true)
                .build()
        }
    }

    private fun startRecordingLoop() {
        if (isRecording) return
        isRecording = true
        val minBufSize = AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL_CONFIG, AUDIO_FORMAT)
        val bufferSize = maxOf(minBufSize, CHUNK_BYTES * 4)
        recordingThread = Thread {
            android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_URGENT_AUDIO)
            val recorder = AudioRecord(MediaRecorder.AudioSource.MIC, SAMPLE_RATE, CHANNEL_CONFIG, AUDIO_FORMAT, bufferSize)
            if (recorder.state != AudioRecord.STATE_INITIALIZED) {
                isRecording = false
            } else {
                recorder.startRecording()
                val buf = ByteArray(CHUNK_BYTES)
                var offset = 0
                while (isRecording) {
                    val read = recorder.read(buf, offset, CHUNK_BYTES - offset)
                    if (read < 0) break
                    offset += read
                    if (offset >= CHUNK_BYTES) {
                        val b64 = Base64.encodeToString(buf, 0, CHUNK_BYTES, Base64.NO_WRAP)
                        chunkCallback?.invoke(b64)
                        offset = 0
                    }
                }
                recorder.stop(); recorder.release()
            }
        }
        recordingThread?.isDaemon = true
        recordingThread?.start()
    }

    private fun stopRecordingLoop() {
        isRecording = false
        recordingThread?.interrupt()
        recordingThread = null
    }
}
