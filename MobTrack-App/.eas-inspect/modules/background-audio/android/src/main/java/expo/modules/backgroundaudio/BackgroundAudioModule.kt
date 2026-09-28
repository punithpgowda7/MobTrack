package expo.modules.backgroundaudio

import android.content.Context
import android.content.Intent
import android.os.BatteryManager
import android.os.Build
import android.provider.Settings
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
        // Returns Android ID (unique device identifier) + live battery info.
        // No special permissions needed for either.
        AsyncFunction("getDeviceInfo") { promise: Promise ->
            try {
                val ctx = appContext.reactContext
                    ?: throw Exception("React context unavailable")

                // Unique, stable device identifier (no IMEI permission required)
                val androidId = Settings.Secure.getString(
                    ctx.contentResolver,
                    Settings.Secure.ANDROID_ID
                ) ?: "unknown"

                // Battery level and charging state (no permission needed on API 21+)
                val bm = ctx.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
                val batteryLevel = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
                val isCharging = bm.isCharging

                promise.resolve(
                    mapOf(
                        "androidId"    to androidId,
                        "batteryLevel" to batteryLevel,
                        "isCharging"   to isCharging
                    )
                )
            } catch (e: Exception) {
                promise.reject("ERR_DEVICE_INFO", e.message ?: "Failed to get device info", e)
            }
        }
    }
}
