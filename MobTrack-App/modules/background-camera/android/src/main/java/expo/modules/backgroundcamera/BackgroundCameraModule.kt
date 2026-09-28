package expo.modules.backgroundcamera

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import org.json.JSONArray
import org.json.JSONObject

class BackgroundCameraModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("BackgroundCamera")

        // Event emitted for each live video frame (base64 JPEG string)
        Events("onVideoFrame")

        AsyncFunction("startService") { activateCamera: Boolean, promise: Promise ->
            try {
                val context = appContext.reactContext
                    ?: throw Exception("React context not available")

                val intent = Intent(context, CameraService::class.java)
                intent.putExtra(CameraService.EXTRA_ACTIVATE_CAMERA, activateCamera)
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

        AsyncFunction("activateCamera") { promise: Promise ->
            try {
                val service = CameraService.instance
                    ?: throw Exception("MobTrack session service is not running. Start the authorized session first.")
                service.activateCamera { error ->
                    if (error == null) {
                        promise.resolve(true)
                    } else {
                        promise.reject("ERR_ACTIVATE_CAMERA", error, null)
                    }
                }
            } catch (e: Exception) {
                promise.reject("ERR_ACTIVATE_CAMERA", e.message ?: "Failed to activate camera", e)
            }
        }

        AsyncFunction("deactivateCamera") { promise: Promise ->
            try {
                // Stopping is idempotent: acknowledge it even if Android has
                // already ended the foreground service.
                CameraService.instance?.deactivateCamera { promise.resolve(true) }
                    ?: promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("ERR_DEACTIVATE_CAMERA", e.message ?: "Failed to deactivate camera", e)
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

        AsyncFunction("startVideoStream") { promise: Promise ->
            try {
                val service = CameraService.instance
                    ?: throw Exception("MobTrack session service is not running. Start the authorized session first.")

                // Wire the frame callback to send module events
                service.onVideoFrame = { base64Frame ->
                    sendEvent("onVideoFrame", mapOf("data" to base64Frame))
                }

                service.startVideoStream { error ->
                    if (error == null) {
                        promise.resolve(true)
                    } else {
                        promise.reject("ERR_START_STREAM", error, null)
                    }
                }
            } catch (e: Exception) {
                promise.reject("ERR_START_STREAM", e.message ?: "Failed to start video stream", e)
            }
        }

        AsyncFunction("stopVideoStream") { promise: Promise ->
            try {
                val service = CameraService.instance
                if (service != null) {
                    service.onVideoFrame = null
                    service.stopVideoStream { promise.resolve(true) }
                } else {
                    promise.resolve(true)
                }
            } catch (e: Exception) {
                promise.reject("ERR_STOP_STREAM", e.message ?: "Failed to stop video stream", e)
            }
        }

        // ── Case 8: Intruder Selfie & Device Admin Bridge Methods ──────────────

        AsyncFunction("isDeviceAdminActive") { promise: Promise ->
            try {
                val context = appContext.reactContext
                    ?: throw Exception("React context not available")
                val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
                val adminComponent = ComponentName(context, IntruderAdminReceiver::class.java)
                val isActive = dpm.isAdminActive(adminComponent)
                promise.resolve(isActive)
            } catch (e: Exception) {
                promise.reject("ERR_DEVICE_ADMIN_CHECK", e.message ?: "Error checking device admin", e)
            }
        }

        AsyncFunction("requestDeviceAdmin") { promise: Promise ->
            try {
                val activity = appContext.currentActivity
                    ?: throw Exception("Activity not available")
                val adminComponent = ComponentName(activity, IntruderAdminReceiver::class.java)
                val intent = Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN).apply {
                    putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, adminComponent)
                    putExtra(
                        DevicePolicyManager.EXTRA_ADD_EXPLANATION,
                        "MobTrack requires Device Administrator permission to monitor failed lock screen attempts and capture intruder selfies."
                    )
                }
                activity.startActivity(intent)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("ERR_REQUEST_DEVICE_ADMIN", e.message ?: "Error requesting device admin", e)
            }
        }

        AsyncFunction("syncDeviceId") { deviceId: String, promise: Promise ->
            try {
                val context = appContext.reactContext
                    ?: throw Exception("React context not available")
                val prefs = context.getSharedPreferences(IntruderAdminReceiver.PREFS_NAME, Context.MODE_PRIVATE)
                prefs.edit().putString("device_id", deviceId).apply()
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("ERR_SYNC_DEVICE_ID", e.message ?: "Error syncing device ID", e)
            }
        }

        AsyncFunction("getIntruderConfig") { promise: Promise ->
            try {
                val context = appContext.reactContext
                    ?: throw Exception("React context not available")
                val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
                val adminComponent = ComponentName(context, IntruderAdminReceiver::class.java)
                val isAdminActive = dpm.isAdminActive(adminComponent)

                val prefs = context.getSharedPreferences(IntruderAdminReceiver.PREFS_NAME, Context.MODE_PRIVATE)
                val isEnabled = prefs.getBoolean(IntruderAdminReceiver.KEY_FEATURE_ENABLED, true)
                val threshold = prefs.getInt(IntruderAdminReceiver.KEY_THRESHOLD, IntruderAdminReceiver.DEFAULT_THRESHOLD)
                val failedCount = prefs.getInt(IntruderAdminReceiver.KEY_FAILED_ATTEMPTS, 0)

                promise.resolve(
                    mapOf(
                        "isAdminActive" to isAdminActive,
                        "enabled" to isEnabled,
                        "threshold" to threshold,
                        "failedAttempts" to failedCount
                    )
                )
            } catch (e: Exception) {
                promise.reject("ERR_GET_INTRUDER_CONFIG", e.message ?: "Error reading intruder config", e)
            }
        }

        AsyncFunction("setIntruderConfig") { enabled: Boolean, threshold: Int, promise: Promise ->
            try {
                val context = appContext.reactContext
                    ?: throw Exception("React context not available")
                val prefs = context.getSharedPreferences(IntruderAdminReceiver.PREFS_NAME, Context.MODE_PRIVATE)
                prefs.edit()
                    .putBoolean(IntruderAdminReceiver.KEY_FEATURE_ENABLED, enabled)
                    .putInt(IntruderAdminReceiver.KEY_THRESHOLD, threshold)
                    .apply()

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                    try {
                        val deContext = context.createDeviceProtectedStorageContext()
                        deContext.getSharedPreferences(IntruderAdminReceiver.PREFS_NAME, Context.MODE_PRIVATE)
                            .edit()
                            .putBoolean(IntruderAdminReceiver.KEY_FEATURE_ENABLED, enabled)
                            .putInt(IntruderAdminReceiver.KEY_THRESHOLD, threshold)
                            .apply()
                    } catch (e: Exception) {
                        Log.w("BackgroundCameraModule", "Error syncing to DE storage: ${e.message}")
                    }
                }

                // Start or stop the persistent camera watcher service based on enabled state.
                // The service must be RUNNING before onPasswordFailed fires on Android 14+.
                if (enabled) {
                    IntruderCaptureService.startWatching(context)
                    Log.d("BackgroundCameraModule", "Started IntruderCaptureService watcher")
                } else {
                    IntruderCaptureService.stopWatching(context)
                    Log.d("BackgroundCameraModule", "Stopped IntruderCaptureService watcher")
                }

                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("ERR_SET_INTRUDER_CONFIG", e.message ?: "Error setting intruder config", e)
            }
        }

        AsyncFunction("getIntruderPhotos") { promise: Promise ->
            try {
                val context = appContext.reactContext
                    ?: throw Exception("React context not available")
                val prefs = context.getSharedPreferences(IntruderAdminReceiver.PREFS_NAME, Context.MODE_PRIVATE)
                val historyJson = prefs.getString("capture_history", "[]") ?: "[]"
                val jsonArray = JSONArray(historyJson)
                val list = mutableListOf<Map<String, Any?>>()

                for (i in (jsonArray.length() - 1) downTo 0) {
                    val obj = jsonArray.getJSONObject(i)
                    list.add(
                        mapOf(
                            "filePath" to obj.optString("filePath"),
                            "timestamp" to obj.optLong("timestamp"),
                            "status" to obj.optString("status"),
                            "publicUrl" to if (obj.has("publicUrl")) obj.getString("publicUrl") else null
                        )
                    )
                }
                promise.resolve(list)
            } catch (e: Exception) {
                promise.reject("ERR_GET_PHOTOS", e.message ?: "Error retrieving intruder photos", e)
            }
        }

        AsyncFunction("canDrawOverlays") { promise: Promise ->
            try {
                val ctx = appContext.reactContext ?: throw Exception("React context unavailable")
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    promise.resolve(Settings.canDrawOverlays(ctx))
                } else {
                    promise.resolve(true)
                }
            } catch (e: Exception) {
                promise.resolve(false)
            }
        }

        AsyncFunction("openOverlaySettings") { promise: Promise ->
            try {
                val ctx = appContext.reactContext ?: throw Exception("React context unavailable")
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    val intent = Intent(
                        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:${ctx.packageName}")
                    ).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
                    ctx.startActivity(intent)
                }
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("ERR_OVERLAY_SETTINGS", e.message ?: "Failed to open overlay settings", e)
            }
        }

        AsyncFunction("openAppSettings") { promise: Promise ->
            try {
                val ctx = appContext.reactContext ?: throw Exception("React context unavailable")
                val intent = Intent(
                    Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:${ctx.packageName}")
                ).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
                ctx.startActivity(intent)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("ERR_APP_SETTINGS", e.message ?: "Failed to open app settings", e)
            }
        }

        AsyncFunction("triggerIntruderTestCapture") { promise: Promise ->
            try {
                val context = appContext.reactContext
                    ?: throw Exception("React context not available")
                IntruderCaptureActivity.start(context)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("ERR_TEST_CAPTURE", e.message ?: "Error triggering test capture", e)
            }
        }
    }
}

