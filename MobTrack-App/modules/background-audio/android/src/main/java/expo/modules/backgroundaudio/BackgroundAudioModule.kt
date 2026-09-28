package expo.modules.backgroundaudio

import android.content.Context
import android.content.Intent
import android.Manifest
import android.content.pm.PackageManager
import android.os.BatteryManager
import android.os.Build
import android.provider.Settings
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class BackgroundAudioModule : Module() {

    private val chunkListener: (String) -> Unit = { base64 ->
        sendEvent("onAudioChunk", mapOf("data" to base64))
    }

    override fun definition() = ModuleDefinition {

        Name("BackgroundAudio")
        Events("onAudioChunk")

        // ── startRecording ──────────────────────────────────────────────────
        Function("startRecording") {
            val ctx = appContext.reactContext ?: throw Exception("React context unavailable")
            AudioRecordingService.chunkCallback = chunkListener
            val intent = Intent(ctx, AudioRecordingService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(intent)
            else ctx.startService(intent)
        }

        // ── stopRecording ───────────────────────────────────────────────────
        Function("stopRecording") {
            val ctx = appContext.reactContext ?: throw Exception("React context unavailable")
            AudioRecordingService.chunkCallback = null
            ctx.stopService(Intent(ctx, AudioRecordingService::class.java))
        }

        // ── getDeviceInfo ───────────────────────────────────────────────────
        // Returns a best-effort IMEI plus Android ID and live battery info.
        // Android 10+ normally blocks IMEI for ordinary third-party apps.
        AsyncFunction("getDeviceInfo") { promise: Promise ->
            try {
                val ctx = appContext.reactContext
                    ?: throw Exception("React context unavailable")

                // Unique, stable device identifier (no IMEI permission required)
                val androidId = Settings.Secure.getString(
                    ctx.contentResolver,
                    Settings.Secure.ANDROID_ID
                ) ?: "unknown"

                val imei = if (
                    ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_PHONE_STATE) ==
                    PackageManager.PERMISSION_GRANTED
                ) {
                    try {
                        val telephony = ctx.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) telephony.imei else telephony.deviceId
                    } catch (_: SecurityException) {
                        null
                    } catch (_: Exception) {
                        null
                    }
                } else null

                // Battery level and charging state (no permission needed on API 21+)
                val bm = ctx.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
                val batteryLevel = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
                val isCharging = bm.isCharging

                val manufacturer = android.os.Build.MANUFACTURER
                val model = android.os.Build.MODEL

                promise.resolve(
                    mapOf(
                        "imei"         to imei,
                        "androidId"    to androidId,
                        "batteryLevel" to batteryLevel,
                        "isCharging"   to isCharging,
                        "manufacturer" to manufacturer,
                        "model"        to model
                    )
                )
            } catch (e: Exception) {
                promise.reject("ERR_DEVICE_INFO", e.message ?: "Failed to get device info", e)
            }
        }
    }
}
