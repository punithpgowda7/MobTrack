package expo.modules.fakeshutdown

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.BatteryManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.telephony.SmsManager
import android.util.Log
import androidx.core.content.ContextCompat
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import org.json.JSONObject

class LastGaspReceiver : BroadcastReceiver() {
    companion object {
        const val TAG = "LastGaspReceiver"
        const val SUPABASE_URL = "https://bmqmdykqrnocjyqjjtzb.supabase.co/rest/v1/devices"
        const val SUPABASE_KEY = "sb_publishable_43VlpJVrEI8fzut89x0Isg_kq6G32CU"
        
        // ------------------------------------------------------------------
        // [ CUSTOM BATTERY LIMIT ] 
        // You can change this number to any percentage (e.g., 5 for 5%).
        // The Last Gasp feature will trigger when battery falls <= this limit.
        // ------------------------------------------------------------------
        const val CUSTOM_BATTERY_LIMIT = 5 

        fun evaluateManualTrigger(context: Context) {
            val prefs = context.getSharedPreferences("MobTrackPrefs", Context.MODE_PRIVATE)
            val isEnabled = prefs.getBoolean("lastGaspEnabled", false)
            if (!isEnabled) return

            val dynamicLimit = prefs.getInt("batteryLimit", 5)
            val isTriggered = prefs.getBoolean("is_last_gasp_triggered", false)

            val bm = context.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
            val currentPct = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)

            if (currentPct > dynamicLimit) {
                if (isTriggered) {
                    prefs.edit().putBoolean("is_last_gasp_triggered", false).apply()
                }
            } else if (currentPct <= dynamicLimit && !isTriggered) {
                prefs.edit().putBoolean("is_last_gasp_triggered", true).apply()
                Log.d(TAG, "LAST_GASP_TRIGGERED (Manual): Battery critically low ($currentPct%)")
                val instance = LastGaspReceiver()
                instance.handleLastGasp(context, currentPct)
            }
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        val prefs = context.getSharedPreferences("MobTrackPrefs", Context.MODE_PRIVATE)
        val isEnabled = prefs.getBoolean("lastGaspEnabled", false)
        if (!isEnabled) return
        
        val dynamicLimit = prefs.getInt("batteryLimit", 5)
        val isTriggered = prefs.getBoolean("is_last_gasp_triggered", false)

        var currentPct = -1

        if (intent.action == Intent.ACTION_BATTERY_CHANGED) {
            val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
            val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
            if (level != -1 && scale != -1) {
                currentPct = (level * 100) / scale
            }
        } else {
            // For custom manual trigger or ACTION_BATTERY_LOW, fetch battery manually
            val bm = context.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
            currentPct = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        }

        if (currentPct != -1) {
            if (currentPct > dynamicLimit) {
                // Battery is above the limit -> reset the trigger lock so it can fire again if it drops
                if (isTriggered) {
                    prefs.edit().putBoolean("is_last_gasp_triggered", false).apply()
                }
            } else if (currentPct <= dynamicLimit && !isTriggered) {
                // Battery is at/below limit and hasn't fired yet!
                prefs.edit().putBoolean("is_last_gasp_triggered", true).apply()
                Log.d(TAG, "LAST_GASP_TRIGGERED: Battery critically low ($currentPct%)")
                handleLastGasp(context, currentPct)
            }
        }
    }

    private fun handleLastGasp(context: Context, batteryPct: Int) {
        val prefs = context.getSharedPreferences("MobTrackPrefs", Context.MODE_PRIVATE)
        val trusteeNumber = prefs.getString("trusteeNumber", null)
        val deviceId = prefs.getString("deviceId", null)

        if (trusteeNumber.isNullOrEmpty() || deviceId.isNullOrEmpty()) {
            Log.e(TAG, "Trustee number or deviceId is missing. Cannot send Last Gasp.")
            return
        }

        // 1. Log Battery Percentage
        Log.d(TAG, "Battery percentage: $batteryPct")

        // 2. Request Location
        val locationManager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
            val isGpsEnabled = locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)
            val isNetworkEnabled = locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
            
            var locationObtained = false
            
            val locationListener = object : LocationListener {
                override fun onLocationChanged(location: Location) {
                    if (!locationObtained) {
                        locationObtained = true
                        locationManager.removeUpdates(this)
                        processEmergency(context, trusteeNumber, deviceId, batteryPct, location)
                    }
                }
                override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
                override fun onProviderEnabled(provider: String) {}
                override fun onProviderDisabled(provider: String) {}
            }

            // Try to get last known location first for speed
            val lastLocation = locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER) 
                ?: locationManager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)

            if (lastLocation != null) {
                locationObtained = true
                processEmergency(context, trusteeNumber, deviceId, batteryPct, lastLocation)
            } else if (isGpsEnabled || isNetworkEnabled) {
                val provider = if (isGpsEnabled) LocationManager.GPS_PROVIDER else LocationManager.NETWORK_PROVIDER
                Log.d(TAG, "Requesting fresh location from $provider")
                locationManager.requestSingleUpdate(provider, locationListener, Looper.getMainLooper())
                
                // Timeout after 15 seconds
                Handler(Looper.getMainLooper()).postDelayed({
                    if (!locationObtained) {
                        locationObtained = true
                        locationManager.removeUpdates(locationListener)
                        Log.e(TAG, "Location request timed out.")
                        processEmergency(context, trusteeNumber, deviceId, batteryPct, null)
                    }
                }, 15000)
            } else {
                Log.e(TAG, "No location providers available.")
                processEmergency(context, trusteeNumber, deviceId, batteryPct, null)
            }
        } else {
            Log.e(TAG, "Location permission unavailable")
            processEmergency(context, trusteeNumber, deviceId, batteryPct, null)
        }
    }

    private fun processEmergency(context: Context, trusteeNumber: String, deviceId: String, batteryPct: Int, location: Location?) {
        val lat = location?.latitude ?: 0.0
        val lng = location?.longitude ?: 0.0
        
        Log.d(TAG, "Location obtained: $lat, $lng")

                // 3. Send SMS
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED) {
            try {
                Log.d(TAG, "SMS sending started")
                val smsManager = SmsManager.getDefault()
                val locStr = if (lat != 0.0 && lng != 0.0) "$lat,$lng" else "unknown"
                
                // Read the IMEI that was entered on the website and synced down via App.tsx
                val prefs = context.getSharedPreferences("MobTrackPrefs", Context.MODE_PRIVATE)
                val imei = prefs.getString("registeredImei", "Unknown")

                val message = "MobTrack EMERGENCY: Phone battery is critical ($batteryPct%). IMEI: $imei. Last known location: https://maps.google.com/?q=$locStr"
                
                val parts = smsManager.divideMessage(message)
                smsManager.sendMultipartTextMessage(trusteeNumber, null, parts, null, null)
                Log.d(TAG, "SMS sent successfully to $trusteeNumber")
            } catch (e: Exception) {
                Log.e(TAG, "SMS failed: ${e.message}")
            }
        } else {
            Log.e(TAG, "SMS permission denied")
        }

        // 4. Update Database
        thread {
            try {
                Log.d(TAG, "Database update started")
                val json = JSONObject().apply {
                    put("battery_level", batteryPct)
                    if (lat != 0.0 && lng != 0.0) {
                        val locObj = JSONObject().apply {
                            put("latitude", lat)
                            put("longitude", lng)
                        }
                        put("last_known_location", locObj)
                    }
                    put("last_event", "LAST_GASP")
                }

                val fullUrl = "$SUPABASE_URL?id=eq.$deviceId"
                val jsonString = json.toString()
                var updated = false

                // Primary: OkHttp (native RFC-compliant PATCH on all Android versions)
                try {
                    val client = OkHttpClient.Builder()
                        .connectTimeout(15, TimeUnit.SECONDS)
                        .writeTimeout(15, TimeUnit.SECONDS)
                        .readTimeout(15, TimeUnit.SECONDS)
                        .build()

                    val mediaType = "application/json; charset=utf-8".toMediaType()
                    val body = jsonString.toRequestBody(mediaType)
                    val request = Request.Builder()
                        .url(fullUrl)
                        .patch(body)
                        .addHeader("Content-Type", "application/json")
                        .addHeader("apikey", SUPABASE_KEY)
                        .addHeader("Authorization", "Bearer $SUPABASE_KEY")
                        .build()

                    client.newCall(request).execute().use { response ->
                        if (response.isSuccessful) {
                            Log.d(TAG, "Database update successful (via OkHttp)")
                            updated = true
                        } else {
                            Log.e(TAG, "Database update failed: ${response.code}")
                        }
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "OkHttp PATCH failed, falling back to HttpURLConnection: ${e.message}")
                }

                // Fallback: HttpURLConnection with reflection-based PATCH method setting
                if (!updated) {
                    try {
                        val url = URL(fullUrl)
                        val conn = url.openConnection() as HttpURLConnection
                        setPatchedRequestMethod(conn, "PATCH")
                        conn.setRequestProperty("Content-Type", "application/json")
                        conn.setRequestProperty("apikey", SUPABASE_KEY)
                        conn.setRequestProperty("Authorization", "Bearer $SUPABASE_KEY")
                        conn.connectTimeout = 15000
                        conn.readTimeout = 15000
                        conn.doOutput = true

                        val os = OutputStreamWriter(conn.outputStream)
                        os.write(jsonString)
                        os.flush()
                        os.close()

                        val responseCode = conn.responseCode
                        if (responseCode in 200..299) {
                            Log.d(TAG, "Database update successful (via HttpURLConnection)")
                        } else {
                            Log.e(TAG, "Database update failed: $responseCode")
                        }
                        conn.disconnect()
                    } catch (e: Exception) {
                        Log.e(TAG, "Database update fallback failed: ${e.message}")
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Database update failed: ${e.message}")
            }
        }
    }

    private fun setPatchedRequestMethod(conn: HttpURLConnection, method: String) {
        try {
            conn.requestMethod = method
        } catch (_: java.net.ProtocolException) {
            try {
                var target: Any = conn
                try {
                    val delegateField = conn.javaClass.getDeclaredField("delegate")
                    delegateField.isAccessible = true
                    delegateField.get(conn)?.let { target = it }
                } catch (_: Exception) {}

                var clazz: Class<*>? = target.javaClass
                while (clazz != null) {
                    try {
                        val methodField = clazz.getDeclaredField("method")
                        methodField.isAccessible = true
                        methodField.set(target, method)
                        return
                    } catch (_: NoSuchFieldException) {
                        clazz = clazz.superclass
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Reflection for HTTP method failed: ${e.message}")
            }
        }
    }
}
