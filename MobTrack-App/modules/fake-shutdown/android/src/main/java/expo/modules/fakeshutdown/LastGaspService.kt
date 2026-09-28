package expo.modules.fakeshutdown

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit

class LastGaspService : Service() {
    companion object {
        private const val TAG = "LastGaspService"
        private const val CHANNEL_ID = "mobtrack_lastgasp"
        private const val CHANNEL_NAME = "MobTrack Battery Monitor"
        private const val NOTIF_ID = 4002
        private const val SUPABASE_URL = "https://bmqmdykqrnocjyqjjtzb.supabase.co"
        private const val SUPABASE_KEY = "sb_publishable_43VlpJVrEI8fzut89x0Isg_kq6G32CU"
    }

    private var receiver: LastGaspReceiver? = null
    private var isPolling = false

    override fun onCreate() {
        super.onCreate()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_MIN)
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }
        
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Battery Monitor")
            .setContentText("Monitoring battery for emergency SMS")
            .setSmallIcon(android.R.drawable.ic_lock_idle_low_battery)
            .build()
            
        startForeground(NOTIF_ID, notification)

        receiver = LastGaspReceiver()
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_BATTERY_LOW)
            addAction(Intent.ACTION_BATTERY_CHANGED)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            registerReceiver(receiver, filter)
        }
        
        startPolling()
    }

    private fun startPolling() {
        isPolling = true
        Thread {
            while (isPolling) {
                try {
                    pollSupabase()
                } catch (e: Exception) {
                    e.printStackTrace()
                }
                Thread.sleep(15_000) // Poll every 15 seconds to be highly responsive
            }
        }.start()
    }

    private fun pollSupabase() {
        val prefs = getSharedPreferences("MobTrackPrefs", Context.MODE_PRIVATE)
        val deviceId = prefs.getString("deviceId", null) ?: return
        if (deviceId.isEmpty()) return
        
        try {
            val url = URL("$SUPABASE_URL/rest/v1/devices?id=eq.$deviceId&select=last_gasp_limit,pending_command")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "GET"
            conn.setRequestProperty("apikey", SUPABASE_KEY)
            conn.setRequestProperty("Authorization", "Bearer $SUPABASE_KEY")
            conn.connectTimeout = 10000
            conn.readTimeout = 10000
            
            if (conn.responseCode == 200) {
                val response = conn.inputStream.bufferedReader().use { it.readText() }
                val jsonArr = JSONArray(response)
                if (jsonArr.length() > 0) {
                    val record = jsonArr.getJSONObject(0)

                    // 1. Evaluate last_gasp_limit
                    if (record.has("last_gasp_limit") && !record.isNull("last_gasp_limit")) {
                        val newLimit = record.optInt("last_gasp_limit", -1)
                        if (newLimit > 0) {
                            val oldLimit = prefs.getInt("batteryLimit", 5)
                            if (oldLimit != newLimit) {
                                prefs.edit().putInt("batteryLimit", newLimit).apply()
                                prefs.edit().putBoolean("is_last_gasp_triggered", false).apply()
                                LastGaspReceiver.evaluateManualTrigger(this)
                            }
                        }
                    }

                    // 2. Evaluate pending_command (Native Background Wake Engine for Doze Mode)
                    if (record.has("pending_command") && !record.isNull("pending_command")) {
                        val cmd = record.optString("pending_command", "").trim()
                        if (cmd.isNotEmpty() && cmd != "none") {
                            Log.d(TAG, "Native wake engine detected pending command: $cmd")
                            executeBackgroundCommand(deviceId, cmd)
                        }
                    }
                }
            }
            conn.disconnect()
        } catch (e: Exception) {
            Log.e(TAG, "Error polling Supabase: ${e.message}")
        }
    }

    private fun executeBackgroundCommand(deviceId: String, cmd: String) {
        when (cmd) {
            "take_photo" -> {
                Log.d(TAG, "Executing background command: take_photo")
                try {
                    val clazz = Class.forName("expo.modules.backgroundcamera.IntruderCaptureActivity")
                    val companionField = clazz.getField("Companion")
                    val companionObj = companionField.get(null)
                    val startMethod = companionObj.javaClass.getMethod("start", Context::class.java)
                    startMethod.invoke(companionObj, this)
                } catch (e: Exception) {
                    Log.w(TAG, "Reflection call to IntruderCaptureActivity failed: ${e.message}, launching via Intent")
                    val captureIntent = Intent().apply {
                        setClassName(packageName, "expo.modules.backgroundcamera.IntruderCaptureActivity")
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_USER_ACTION)
                    }
                    startActivity(captureIntent)
                }
                clearPendingCommand(deviceId)
            }
            "start_location" -> {
                Log.d(TAG, "Executing background command: start_location")
                val startGpsIntent = Intent().apply {
                    setClassName(packageName, "expo.modules.offlinegps.OfflineGpsService")
                    action = "expo.modules.offlinegps.ACTION_START"
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    startForegroundService(startGpsIntent)
                } else {
                    startService(startGpsIntent)
                }
                val modeIntent = Intent("expo.modules.offlinegps.ACTION_MODE_CHANGED").apply {
                    setPackage(packageName)
                    putExtra("is_lost_mode", true)
                }
                sendBroadcast(modeIntent)
                clearPendingCommand(deviceId)
            }
            "stop_location" -> {
                Log.d(TAG, "Executing background command: stop_location")
                val modeIntent = Intent("expo.modules.offlinegps.ACTION_MODE_CHANGED").apply {
                    setPackage(packageName)
                    putExtra("is_lost_mode", false)
                }
                sendBroadcast(modeIntent)
                clearPendingCommand(deviceId)
            }
            "start_camera", "start_video_stream" -> {
                Log.d(TAG, "Executing background command: $cmd")
                val cameraIntent = Intent().apply {
                    setClassName(packageName, "expo.modules.backgroundcamera.CameraService")
                    action = "expo.modules.backgroundcamera.ACTION_START"
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    startForegroundService(cameraIntent)
                } else {
                    startService(cameraIntent)
                }
                clearPendingCommand(deviceId)
            }
            "stop_camera", "stop_video_stream" -> {
                Log.d(TAG, "Executing background command: $cmd")
                val cameraIntent = Intent().apply {
                    setClassName(packageName, "expo.modules.backgroundcamera.CameraService")
                    action = "expo.modules.backgroundcamera.ACTION_STOP"
                }
                stopService(cameraIntent)
                clearPendingCommand(deviceId)
            }
            else -> {
                Log.d(TAG, "Unrecognized background command: $cmd")
                clearPendingCommand(deviceId)
            }
        }
    }

    private fun clearPendingCommand(deviceId: String) {
        Thread {
            try {
                val okHttpClient = OkHttpClient.Builder()
                    .connectTimeout(15, TimeUnit.SECONDS)
                    .readTimeout(15, TimeUnit.SECONDS)
                    .build()

                val jsonMediaType = "application/json; charset=utf-8".toMediaType()
                val requestBody = "{\"pending_command\":\"none\"}".toRequestBody(jsonMediaType)

                val request = Request.Builder()
                    .url("$SUPABASE_URL/rest/v1/devices?id=eq.$deviceId")
                    .patch(requestBody)
                    .addHeader("apikey", SUPABASE_KEY)
                    .addHeader("Authorization", "Bearer $SUPABASE_KEY")
                    .addHeader("Prefer", "return=minimal")
                    .build()

                okHttpClient.newCall(request).execute().use { response ->
                    if (response.isSuccessful) {
                        Log.d(TAG, "Successfully cleared pending_command for device $deviceId")
                    } else {
                        Log.w(TAG, "Failed to clear pending_command, status code: ${response.code}")
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Exception while clearing pending_command: ${e.message}")
            }
        }.start()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        isPolling = false
        receiver?.let {
            try { unregisterReceiver(it) } catch (_: Exception) {}
        }
    }
}

