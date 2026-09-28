package expo.modules.offlinegps

import android.content.Context
import android.content.Intent
import android.os.Build
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class OfflineGpsModule : Module() {

    override fun definition() = ModuleDefinition {

        Name("OfflineGps")

        AsyncFunction("startOfflineTracking") { deviceId: String, supabaseUrl: String, supabaseAnonKey: String, promise: Promise ->
            try {
                val ctx = appContext.reactContext
                    ?: throw Exception("React context unavailable")
                
                val intent = Intent(ctx, OfflineGpsService::class.java).apply {
                    putExtra("DEVICE_ID", deviceId)
                    putExtra("SUPABASE_URL", supabaseUrl)
                    putExtra("SUPABASE_ANON_KEY", supabaseAnonKey)
                }
                
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    ctx.startForegroundService(intent)
                } else {
                    ctx.startService(intent)
                }
                
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("ERR_START_OFFLINE_GPS", e.message ?: "Failed to start", e)
            }
        }

        AsyncFunction("stopOfflineTracking") { promise: Promise ->
            try {
                val ctx = appContext.reactContext
                    ?: throw Exception("React context unavailable")
                ctx.stopService(Intent(ctx, OfflineGpsService::class.java))
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("ERR_STOP_OFFLINE_GPS", e.message ?: "Failed to stop", e)
            }
        }

        AsyncFunction("setLostMode") { isLost: Boolean, promise: Promise ->
            try {
                val ctx = appContext.reactContext
                    ?: throw Exception("React context unavailable")
                OfflineGpsService.setLostMode(ctx, isLost)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("ERR_SET_LOST_MODE", e.message ?: "Failed to set lost mode", e)
            }
        }

        AsyncFunction("isHighAccuracyActive") { promise: Promise ->
            val ctx = appContext.reactContext
            val prefs = ctx?.getSharedPreferences(OfflineGpsService.PREFS_DEVICE_STATE, Context.MODE_PRIVATE)
            val isLost = prefs?.getBoolean(OfflineGpsService.EXTRA_LOST_MODE, false) ?: false
            val isFake = prefs?.getBoolean(OfflineGpsService.EXTRA_FAKE_SHUTDOWN, false) ?: false
            promise.resolve(isLost || isFake)
        }
    }
}
