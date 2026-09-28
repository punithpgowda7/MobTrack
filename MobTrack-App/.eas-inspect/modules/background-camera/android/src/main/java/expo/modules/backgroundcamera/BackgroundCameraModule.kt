package expo.modules.backgroundcamera

import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise

class BackgroundCameraModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("BackgroundCamera")

        AsyncFunction("startService") { promise: Promise ->
            try {
                val context = appContext.reactContext
                    ?: throw Exception("React context not available")

                val intent = Intent(context, CameraService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("ERR_START_SERVICE", e.message ?: "Failed to start service", e)
            }
        }

        AsyncFunction("stopService") { promise: Promise ->
            try {
                val context = appContext.reactContext
                    ?: throw Exception("React context not available")

                context.stopService(Intent(context, CameraService::class.java))
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("ERR_STOP_SERVICE", e.message ?: "Failed to stop service", e)
            }
        }

        AsyncFunction("capturePhoto") { promise: Promise ->
            val service = CameraService.instance
            if (service == null) {
                promise.reject(
                    "ERR_NO_SERVICE",
                    "Camera service not running. Call startService() first.",
                    null
                )
            } else {
                service.capturePhoto { base64, error ->
                    if (error != null) {
                        promise.reject("ERR_CAPTURE", error, null)
                    } else if (base64 != null) {
                        promise.resolve(base64)
                    } else {
                        promise.reject("ERR_UNKNOWN", "Unknown capture error", null)
                    }
                }
            }
        }
    }
}
