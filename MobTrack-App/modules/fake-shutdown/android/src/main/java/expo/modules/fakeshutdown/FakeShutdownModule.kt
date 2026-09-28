package expo.modules.fakeshutdown

import android.content.Intent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.IntentFilter

import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.text.TextUtils
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class FakeShutdownModule : Module() {





    override fun definition() = ModuleDefinition {

        Name("FakeShutdown")

        
        AsyncFunction("startService") { sequence: List<String>, promise: Promise ->
            try {
                val ctx = appContext.reactContext
                    ?: throw Exception("React context unavailable")
                
                if (sequence.isNotEmpty()) {
                    val prefs = ctx.getSharedPreferences("MobTrackPrefs", Context.MODE_PRIVATE)
                    prefs.edit().putString("unlockSequence", sequence.joinToString(",")).apply()
                }

                val intent = Intent(ctx, FakeShutdownService::class.java).apply {
                    putStringArrayListExtra(FakeShutdownService.EXTRA_SEQUENCE, ArrayList(sequence))
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    ctx.startForegroundService(intent)
                } else {
                    ctx.startService(intent)
                }
                
                val broadcast = Intent(FakeShutdownAccessibilityService.ACTION_SHOW).apply {
                    putStringArrayListExtra(FakeShutdownAccessibilityService.EXTRA_SEQUENCE, ArrayList(sequence))
                    setPackage(ctx.packageName)
                }
                ctx.sendBroadcast(broadcast)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("ERR_START_SERVICE", e.message ?: "Failed to start", e)
            }
        }

        
        AsyncFunction("stopService") { promise: Promise ->
            try {
                val ctx = appContext.reactContext
                    ?: throw Exception("React context unavailable")
                ctx.stopService(Intent(ctx, FakeShutdownService::class.java))
                val broadcast = Intent(FakeShutdownAccessibilityService.ACTION_HIDE).apply {
                    setPackage(ctx.packageName)
                }
                ctx.sendBroadcast(broadcast)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("ERR_STOP_SERVICE", e.message ?: "Failed to stop", e)
            }
        }

        
        AsyncFunction("updateConfig") { sequence: List<String>, promise: Promise ->
            try {
                val ctx = appContext.reactContext
                    ?: throw Exception("React context unavailable")
                if (sequence.isNotEmpty()) {
                    val prefs = ctx.getSharedPreferences("MobTrackPrefs", Context.MODE_PRIVATE)
                    prefs.edit().putString("unlockSequence", sequence.joinToString(",")).apply()
                }
                val broadcast = Intent(FakeShutdownAccessibilityService.ACTION_UPDATE_SEQUENCE).apply {
                    putStringArrayListExtra(FakeShutdownAccessibilityService.EXTRA_SEQUENCE, ArrayList(sequence))
                    setPackage(ctx.packageName)
                }
                ctx.sendBroadcast(broadcast)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("ERR_UPDATE_CONFIG", e.message ?: "Failed to update", e)
            }
        }

        
        AsyncFunction("canDrawOverlays") { promise: Promise ->
            try {
                val ctx = appContext.reactContext
                    ?: throw Exception("React context unavailable")
                promise.resolve(Settings.canDrawOverlays(ctx))
            } catch (e: Exception) {
                promise.resolve(false)
            }
        }

        
        AsyncFunction("openOverlaySettings") { promise: Promise ->
            try {
                val ctx = appContext.reactContext
                    ?: throw Exception("React context unavailable")
                val intent = Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:${ctx.packageName}")
                ).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
                ctx.startActivity(intent)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("ERR_OPEN_SETTINGS", e.message ?: "Failed to open settings", e)
            }
        }

        
        AsyncFunction("isAccessibilityServiceEnabled") { promise: Promise ->
            try {
                val ctx = appContext.reactContext
                    ?: throw Exception("React context unavailable")
                val componentName = "${ctx.packageName}/expo.modules.fakeshutdown.FakeShutdownAccessibilityService"
                val enabledServices = Settings.Secure.getString(
                    ctx.contentResolver,
                    Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
                ) ?: ""
                val colonSplitter = TextUtils.SimpleStringSplitter(':')
                colonSplitter.setString(enabledServices)
                var found = false
                while (colonSplitter.hasNext()) {
                    if (colonSplitter.next().equals(componentName, ignoreCase = true)) {
                        found = true; break
                    }
                }
                promise.resolve(found)
            } catch (e: Exception) {
                promise.resolve(false)
            }
        }

        
        AsyncFunction("openAccessibilitySettings") { promise: Promise ->
            try {
                val ctx = appContext.reactContext
                    ?: throw Exception("React context unavailable")
                val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                ctx.startActivity(intent)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("ERR_OPEN_ACC_SETTINGS", e.message ?: "Failed", e)
            }
        }
        
        AsyncFunction("hasDndPermission") { promise: Promise ->
            try {
                val ctx = appContext.reactContext ?: throw Exception("React context unavailable")
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    val nm = ctx.getSystemService(android.content.Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
                    promise.resolve(nm.isNotificationPolicyAccessGranted)
                } else {
                    promise.resolve(true)
                }
            } catch (e: Exception) {
                promise.resolve(false)
            }
        }

        
        AsyncFunction("openDndSettings") { promise: Promise ->
            try {
                val ctx = appContext.reactContext ?: throw Exception("React context unavailable")
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    val intent = Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    ctx.startActivity(intent)
                }
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("ERR_OPEN_DND", e.message ?: "Failed", e)
            }
        }
    
        
        AsyncFunction("startSimMonitor") { promise: Promise ->
            try {
                // No-op: SIM monitoring is now fully integrated inside the FakeShutdownAccessibilityService.
                // It runs automatically when the fake shutdown feature is enabled via startService (ACTION_SHOW).
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("ERR_SIM_START", e.message ?: "Failed", e)
            }
        }

        AsyncFunction("stopSimMonitor") { promise: Promise ->
            try {
                // No-op for the same reason.
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("ERR_SIM_STOP", e.message ?: "Failed", e)
            }
        }

        AsyncFunction("startAlarm") { promise: Promise ->
            try {
                val ctx = appContext.reactContext ?: throw Exception("React context unavailable")
                val broadcast = Intent(FakeShutdownAccessibilityService.ACTION_START_ALARM).apply {
                    setPackage(ctx.packageName)
                }
                ctx.sendBroadcast(broadcast)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("ERR_ALARM_START", e.message ?: "Failed", e)
            }
        }

        AsyncFunction("stopAlarm") { promise: Promise ->
            try {
                val ctx = appContext.reactContext ?: throw Exception("React context unavailable")
                val broadcast = Intent(FakeShutdownAccessibilityService.ACTION_STOP_ALARM).apply {
                    setPackage(ctx.packageName)
                }
                ctx.sendBroadcast(broadcast)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("ERR_ALARM_STOP", e.message ?: "Failed", e)
            }
        }

        /**
         * Enable the Fake Factory Reset overlay trigger.
         * After this, holding Power + Volume Up for 3 seconds shows the fake recovery screen.
         */
        AsyncFunction("enableFactoryReset") { promise: Promise ->
            try {
                val ctx = appContext.reactContext ?: throw Exception("React context unavailable")
                // PERSIST to SharedPreferences so it survives service restarts
                ctx.getSharedPreferences("MobTrackPrefs", Context.MODE_PRIVATE)
                    .edit().putBoolean("fakeFactoryResetEnabled", true).apply()
                val broadcast = Intent(FakeShutdownAccessibilityService.ACTION_ENABLE_FACTORY_RESET).apply {
                    setPackage(ctx.packageName)
                }
                ctx.sendBroadcast(broadcast)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("ERR_ENABLE_FACTORY_RESET", e.message ?: "Failed", e)
            }
        }

        /**
         * Disable the Fake Factory Reset overlay trigger.
         * The Power + Volume Up combo will no longer show the fake recovery screen.
         * If the recovery overlay is currently showing, it will be dismissed.
         */
        AsyncFunction("disableFactoryReset") { promise: Promise ->
            try {
                val ctx = appContext.reactContext ?: throw Exception("React context unavailable")
                // PERSIST to SharedPreferences
                ctx.getSharedPreferences("MobTrackPrefs", Context.MODE_PRIVATE)
                    .edit().putBoolean("fakeFactoryResetEnabled", false).apply()
                val broadcast = Intent(FakeShutdownAccessibilityService.ACTION_DISABLE_FACTORY_RESET).apply {
                    setPackage(ctx.packageName)
                }
                ctx.sendBroadcast(broadcast)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("ERR_DISABLE_FACTORY_RESET", e.message ?: "Failed", e)
            }
        }

        AsyncFunction("saveLastGaspPrefs") { trusteeNumber: String, deviceId: String, batteryLimit: Int, imeiNumber: String, promise: Promise ->
            try {
                val ctx = appContext.reactContext ?: throw Exception("React context unavailable")
                val prefs = ctx.getSharedPreferences("MobTrackPrefs", android.content.Context.MODE_PRIVATE)
                val oldLimit = prefs.getInt("batteryLimit", -1)
                
                prefs.edit()
                    .putString("trusteeNumber", trusteeNumber)
                    .putString("deviceId", deviceId)
                    .putInt("batteryLimit", batteryLimit)
                    .putString("registeredImei", imeiNumber)
                    .apply()

                if (oldLimit != batteryLimit) {
                    // Reset the trigger lock if they changed the limit
                    prefs.edit().putBoolean("is_last_gasp_triggered", false).apply()
                    // Manually force a check right now (no dependency on accessibility service being active)
                    LastGaspReceiver.evaluateManualTrigger(ctx)
                }

                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("ERR_SAVE_PREFS", e.message ?: "Failed", e)
            }
        }

        AsyncFunction("startLastGaspService") { promise: Promise ->
            try {
                val ctx = appContext.reactContext ?: throw Exception("React context unavailable")
                ctx.getSharedPreferences("MobTrackPrefs", Context.MODE_PRIVATE)
                    .edit().putBoolean("lastGaspEnabled", true).apply()
                val serviceIntent = Intent(ctx, LastGaspService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    ctx.startForegroundService(serviceIntent)
                } else {
                    ctx.startService(serviceIntent)
                }
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("ERR_START_LAST_GASP", e.message ?: "Failed", e)
            }
        }

        AsyncFunction("stopLastGaspService") { promise: Promise ->
            try {
                val ctx = appContext.reactContext ?: throw Exception("React context unavailable")
                ctx.getSharedPreferences("MobTrackPrefs", Context.MODE_PRIVATE)
                    .edit().putBoolean("lastGaspEnabled", false).apply()
                val serviceIntent = Intent(ctx, LastGaspService::class.java)
                ctx.stopService(serviceIntent)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("ERR_STOP_LAST_GASP", e.message ?: "Failed", e)
            }
        }
    }
}