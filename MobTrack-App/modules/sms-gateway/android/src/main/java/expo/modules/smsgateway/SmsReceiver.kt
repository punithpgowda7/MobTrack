package expo.modules.smsgateway

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.database.sqlite.SQLiteDatabase
import android.location.Location
import android.location.LocationManager
import android.os.BatteryManager
import android.provider.Telephony
import android.util.Log

class SmsReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Telephony.Sms.Intents.SMS_RECEIVED_ACTION) {
            val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
            for (sms in messages) {
                val body = sms.messageBody ?: continue
                val sender = sms.originatingAddress ?: ""
                Log.d(TAG, "Incoming SMS from $sender: $body")

                var pin = ""
                var reqDeviceId = ""
                var isTrigger = false

                // 1. Check for Trigger Request: "MT_REQ:<PIN>:<DEVICE_ID>", "MT_PATH:<PIN>:<DEVICE_ID>", "#track <PIN>", or "#path <PIN>"
                val lowerBody = body.trim().lowercase()
                if (body.startsWith("MT_REQ:") || body.startsWith("MT_PATH:")) {
                    val parts = body.split(":")
                    if (parts.size >= 2) {
                        pin = parts[1].trim()
                        reqDeviceId = if (parts.size >= 3) parts[2].trim() else ""
                        isTrigger = true
                    }
                } else if (lowerBody.startsWith("#track") || lowerBody.startsWith("#path")) {
                    val parts = body.trim().split(Regex("\\s+"))
                    if (parts.size >= 2) {
                        pin = parts[1].trim()
                        isTrigger = true
                    }
                }

                if (isTrigger) {
                    val prefs = context.getSharedPreferences("sms_gateway_prefs", Context.MODE_PRIVATE)
                    prefs.edit().putString("last_relay_sender", sender).apply()
                    val configuredPin = prefs.getString("security_pin", "1234")?.takeIf { it.isNotBlank() } ?: "1234"
                    Log.d(TAG, "Trigger SMS received from $sender. Received PIN: '$pin', Configured PIN: '$configuredPin'")

                    // Verify that the received PIN matches the configured security PIN exactly
                    if (pin.isNotEmpty() && pin == configuredPin) {
                        // Notify active JS module if running
                        SmsGatewayModule.handleTriggerSms(sender, pin, reqDeviceId)

                        // Switch OfflineGpsService into high-accuracy 10-second lost mode
                        try {
                            context.getSharedPreferences("mobtrack_device_state", Context.MODE_PRIVATE)
                                .edit().putBoolean("is_lost_mode", true).apply()
                            val lostIntent = Intent("expo.modules.offlinegps.ACTION_MODE_CHANGED").apply {
                                putExtra("is_lost_mode", true)
                                setPackage(context.packageName)
                            }
                            context.sendBroadcast(lostIntent)
                        } catch (e: Exception) {
                            Log.w(TAG, "Error triggering lost mode from SMS: ${e.message}")
                        }

                        // Automated Native Response: Runs asynchronously and replies with location & battery & path history
                        respondWithLocationAndBattery(context, sender, pin, reqDeviceId)
                    } else {
                        Log.w(TAG, "PIN mismatch ($pin != $configuredPin). Rejecting SMS trigger.")
                    }
                }
                // 2. Check for Telemetry Payload: "MT1:..."
                else if (body.startsWith("MT1:")) {
                    SmsGatewayModule.handleTelemetrySms(sender, body)
                }
            }
        }
    }

    private fun respondWithLocationAndBattery(context: Context, sender: String, pin: String, targetDeviceId: String) {
        val pendingResult = goAsync()
        Thread {
            try {
                // Get device ID from offline_gps_config or SharedPreferences
                val gpsPrefs = context.getSharedPreferences("offline_gps_config", Context.MODE_PRIVATE)
                val deviceId = if (targetDeviceId.isNotEmpty()) targetDeviceId else (gpsPrefs.getString("DEVICE_ID", "device") ?: "device")

                // 1. Battery level
                val batteryFilter = IntentFilter(Intent.ACTION_BATTERY_CHANGED)
                val batteryIntent = context.registerReceiver(null, batteryFilter)
                val level = batteryIntent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
                val scale = batteryIntent?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
                val batteryPct = if (level >= 0 && scale > 0) (level * 100 / scale) else 50

                // 2. Location from LocationManager
                var bestLat: Double? = null
                var bestLng: Double? = null
                var bestTime: Long = System.currentTimeMillis()

                try {
                    val lm = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
                    if (lm != null) {
                        val providers = listOf(
                            LocationManager.GPS_PROVIDER,
                            LocationManager.NETWORK_PROVIDER,
                            LocationManager.PASSIVE_PROVIDER
                        )
                        var bestLocation: Location? = null
                        for (provider in providers) {
                            try {
                                val loc = lm.getLastKnownLocation(provider)
                                if (loc != null) {
                                    if (bestLocation == null || loc.time > bestLocation.time) {
                                        bestLocation = loc
                                    }
                                }
                            } catch (e: SecurityException) {
                                Log.w(TAG, "SecurityException fetching location for $provider: ${e.message}")
                            }
                        }
                        if (bestLocation != null) {
                            bestLat = bestLocation.latitude
                            bestLng = bestLocation.longitude
                            bestTime = bestLocation.time
                        }
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error querying system location providers", e)
                }

                // 3. Fallback: check SQLite database OfflineGps.db if system provider had no fix
                // AND retrieve the last 2-3 breadcrumbs for Path History
                val pathSegments = mutableListOf<String>()
                try {
                    val dbFile = context.getDatabasePath("OfflineGps.db")
                    if (dbFile.exists()) {
                        val db = SQLiteDatabase.openDatabase(dbFile.path, null, SQLiteDatabase.OPEN_READONLY)
                        if (bestLat == null || bestLng == null) {
                            db.rawQuery("SELECT latitude, longitude, timestamp FROM breadcrumbs ORDER BY timestamp DESC LIMIT 1", null).use { cursor ->
                                if (cursor.moveToFirst()) {
                                    bestLat = cursor.getDouble(0)
                                    bestLng = cursor.getDouble(1)
                                    bestTime = cursor.getLong(2)
                                }
                            }
                        }

                        // Retrieve the latest 3 breadcrumbs for path history
                        val recentPoints = mutableListOf<Triple<Double, Double, Long>>()
                        db.rawQuery("SELECT latitude, longitude, timestamp FROM breadcrumbs ORDER BY timestamp DESC LIMIT 3", null).use { cursor ->
                            while (cursor.moveToNext()) {
                                recentPoints.add(Triple(cursor.getDouble(0), cursor.getDouble(1), cursor.getLong(2)))
                            }
                        }
                        db.close()

                        // Sort chronological (oldest to newest)
                        recentPoints.reverse()

                        // Compress path coordinates: skip battery, omit first 2 digits (integer degrees), format 4 decimals
                        for (pt in recentPoints) {
                            val pLat = pt.first
                            val pLng = pt.second
                            val pTime = pt.third
                            val latFrac = Math.abs(pLat) - Math.floor(Math.abs(pLat))
                            val lngFrac = Math.abs(pLng) - Math.floor(Math.abs(pLng))
                            val latFracStr = String.format(java.util.Locale.US, ".%04d", Math.round(latFrac * 10000).toInt())
                            val lngFracStr = String.format(java.util.Locale.US, ".%04d", Math.round(lngFrac * 10000).toInt())
                            val diffMin = Math.max(0L, (bestTime - pTime) / (60 * 1000L))
                            pathSegments.add("$latFracStr,$lngFracStr,$diffMin")
                        }
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error checking OfflineGps.db", e)
                }

                // 4. Format payload: MT1:<PIN>:<DEVICE_ID>:<LAT>,<LNG>:<BATTERY>:<TIMESTAMP>:<PATH_POINTS>
                val pathSuffix = if (pathSegments.isNotEmpty()) ":${pathSegments.joinToString(";")}" else ""
                val payload = if (bestLat != null && bestLng != null) {
                    val latStr = String.format(java.util.Locale.US, "%.5f", bestLat)
                    val lngStr = String.format(java.util.Locale.US, "%.5f", bestLng)
                    "MT1:$pin:$deviceId:$latStr,$lngStr:$batteryPct:$bestTime$pathSuffix"
                } else {
                    "MT1:$pin:$deviceId:NO_LOC:$batteryPct:$bestTime$pathSuffix"
                }

                Log.d(TAG, "Dispatching automated reply SMS to $sender: $payload")
                val sent = SmsSender.sendSms(sender, payload)
                Log.d(TAG, "Automated reply SMS sent result: $sent")
            } catch (e: Exception) {
                Log.e(TAG, "Exception in respondWithLocationAndBattery", e)
            } finally {
                pendingResult.finish()
            }
        }.start()
    }

    companion object {
        private const val TAG = "SmsReceiver"
    }
}
