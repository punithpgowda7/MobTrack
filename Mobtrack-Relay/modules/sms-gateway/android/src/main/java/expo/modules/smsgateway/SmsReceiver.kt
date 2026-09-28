package expo.modules.smsgateway

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.util.Log
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

class SmsReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Telephony.Sms.Intents.SMS_RECEIVED_ACTION) {
            val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
            for (sms in messages) {
                val body = sms.messageBody ?: continue
                val sender = sms.originatingAddress ?: ""
                Log.d(TAG, "Incoming SMS from $sender: $body")

                // 1. Check for Trigger Request: "MT_REQ:<PIN>:<DEVICE_ID>" or "#track <PIN>"
                if (body.startsWith("MT_REQ:")) {
                    val parts = body.split(":")
                    if (parts.size >= 2) {
                        val pin = parts[1]
                        val deviceId = if (parts.size >= 3) parts[2] else ""
                        SmsGatewayModule.handleTriggerSms(sender, pin, deviceId)
                    }
                } else if (body.lowercase().startsWith("#track ")) {
                    val parts = body.split(" ")
                    if (parts.size >= 2) {
                        val pin = parts[1]
                        val deviceId = ""
                        SmsGatewayModule.handleTriggerSms(sender, pin, deviceId)
                    }
                }

                // 2. Check for Telemetry Payload: "MT1:...", "MTP:..." or coordinates reply
                else if (body.startsWith("MT1:") || body.startsWith("MTP:") || body.lowercase().startsWith("#track_res") || (body.contains(",") && (body.contains("%") || body.contains(";")))) {
                    // Notify active JS module for UI logs if running
                    SmsGatewayModule.handleTelemetrySms(sender, body)

                    // Resilient Native Push: Pushes directly to Supabase over HTTP even if React Native JS runtime is asleep
                    pushTelemetryDirectlyToSupabase(context, sender, body)
                }
            }
        }
    }

    private fun pushTelemetryDirectlyToSupabase(context: Context, sender: String, payload: String) {
        val pendingResult = goAsync()
        thread(name = "RelayNativeTelemetryThread") {
            try {
                var lat: Double? = null
                var lng: Double? = null
                var battery: Int? = null
                var targetDeviceId = ""
                var msgTime = System.currentTimeMillis()
                var rawPathPointsStr = ""

                if (payload.startsWith("MT1:")) {
                    val body = payload.substring(4)
                    val parts = body.split(":")
                    if (parts.size >= 3) {
                        targetDeviceId = parts[1]
                        if (parts[2].isNotEmpty() && parts[2] != "NO_LOC") {
                            val coords = parts[2].split(",")
                            if (coords.size >= 2) {
                                lat = coords[0].toDoubleOrNull()
                                lng = coords[1].toDoubleOrNull()
                            }
                        }
                        if (parts.size >= 4 && parts[3].isNotEmpty()) {
                            battery = parts[3].toIntOrNull()
                        }
                        if (parts.size >= 5 && parts[4].isNotEmpty()) {
                            val t = parts[4].toLongOrNull()
                            if (t != null && t > 0) msgTime = t
                        }
                        if (parts.size >= 6) {
                            rawPathPointsStr = parts.drop(5).joinToString(":")
                        }
                    }
                } else if (payload.startsWith("MTP:")) {
                    val body = payload.substring(4)
                    val parts = body.split(":")
                    if (parts.size >= 3) {
                        targetDeviceId = parts[1]
                        rawPathPointsStr = parts.drop(2).joinToString(":")
                    }
                } else {
                    val coordRegex = Regex("(-?\\d+\\.\\d+)\\s*,\\s*(-?\\d+\\.\\d+)")
                    val match = coordRegex.find(payload)
                    if (match != null) {
                        lat = match.groupValues[1].toDoubleOrNull()
                        lng = match.groupValues[2].toDoubleOrNull()
                    }
                    val batRegex = Regex("(\\d+)%")
                    val batMatch = batRegex.find(payload)
                    if (batMatch != null) {
                        battery = batMatch.groupValues[1].toIntOrNull()
                    }
                }

                val cleanSender = sender.replace("\\s+".toRegex(), "").replace("^\\+91".toRegex(), "")
                val supabaseUrl = "https://bmqmdykqrnocjyqjjtzb.supabase.co"
                val supabaseKey = "sb_publishable_43VlpJVrEI8fzut89x0Isg_kq6G32CU"

                // 1. If targetDeviceId is missing or generic, resolve from Supabase devices
                if (targetDeviceId.isEmpty() || targetDeviceId == "device" || targetDeviceId == "unknown_device") {
                    try {
                        val queryUrl = URL("$supabaseUrl/rest/v1/devices?or=(mobile_number.eq.$sender,mobile_number.eq.%2B91$cleanSender,mobile_number.eq.$cleanSender)&select=id")
                        val conn = queryUrl.openConnection() as HttpURLConnection
                        conn.requestMethod = "GET"
                        conn.setRequestProperty("apikey", supabaseKey)
                        conn.setRequestProperty("Authorization", "Bearer $supabaseKey")
                        if (conn.responseCode == 200) {
                            val resp = conn.inputStream.bufferedReader().use { it.readText() }
                            val idRegex = Regex("\"id\":\\s*\"([^\"]+)\"")
                            val idMatch = idRegex.find(resp)
                            if (idMatch != null) {
                                targetDeviceId = idMatch.groupValues[1]
                            }
                        }
                        conn.disconnect()
                    } catch (e: Exception) {
                        Log.w(TAG, "Error resolving device id natively: ${e.message}")
                    }
                }

                // 2. Parse path history points if present
                val baseLatInt = lat?.let { Math.floor(Math.abs(it)).toInt() * if (it < 0) -1 else 1 } ?: 12
                val baseLngInt = lng?.let { Math.floor(Math.abs(it)).toInt() * if (it < 0) -1 else 1 } ?: 77

                if (rawPathPointsStr.isNotEmpty() && targetDeviceId.isNotEmpty() && targetDeviceId != "device") {
                    try {
                        val items = rawPathPointsStr.split(";")
                        val jsonArr = org.json.JSONArray()
                        for (item in items) {
                            val trimmed = item.trim()
                            if (trimmed.isEmpty()) continue
                            val pParts = trimmed.split(",")
                            if (pParts.size >= 2) {
                                var ptLat = pParts[0].toDoubleOrNull()
                                var ptLng = pParts[1].toDoubleOrNull()
                                val diffMin = if (pParts.size >= 3) pParts[2].toIntOrNull() ?: 0 else 0
                                if (ptLat != null && ptLng != null) {
                                    if (Math.abs(ptLat) < 1.0) {
                                        ptLat = (if (baseLatInt >= 0) 1 else -1) * (Math.abs(baseLatInt) + Math.abs(ptLat))
                                    }
                                    if (Math.abs(ptLng) < 1.0) {
                                        ptLng = (if (baseLngInt >= 0) 1 else -1) * (Math.abs(baseLngInt) + Math.abs(ptLng))
                                    }
                                    val ptTime = msgTime - (diffMin * 60 * 1000L)
                                    val ptObj = org.json.JSONObject().apply {
                                        put("device_id", targetDeviceId)
                                        put("latitude", ptLat)
                                        put("longitude", ptLng)
                                        put("timestamp", ptTime)
                                    }
                                    jsonArr.put(ptObj)
                                }
                            }
                        }

                        if (jsonArr.length() > 0) {
                            val pathUrl = URL("$supabaseUrl/rest/v1/offline_gps_history")
                            val conn = pathUrl.openConnection() as HttpURLConnection
                            conn.requestMethod = "POST"
                            conn.setRequestProperty("apikey", supabaseKey)
                            conn.setRequestProperty("Authorization", "Bearer $supabaseKey")
                            conn.setRequestProperty("Content-Type", "application/json")
                            conn.doOutput = true
                            conn.outputStream.bufferedWriter().use { it.write(jsonArr.toString()) }
                            Log.d(TAG, "Native path sync response: ${conn.responseCode}")
                            conn.disconnect()
                        }
                    } catch (e: Exception) {
                        Log.w(TAG, "Error posting path points natively: ${e.message}")
                    }
                }

                // 3. Update devices table with fresh location & battery
                if (lat != null && lng != null) {
                    try {
                        val updateFilter = if (targetDeviceId.isNotEmpty() && targetDeviceId != "device" && targetDeviceId != "unknown_device") {
                            "id=eq.$targetDeviceId"
                        } else {
                            "or=(mobile_number.eq.$sender,mobile_number.eq.%2B91$cleanSender,mobile_number.eq.$cleanSender)"
                        }

                        val devUrl = URL("$supabaseUrl/rest/v1/devices?$updateFilter")
                        val conn = devUrl.openConnection() as HttpURLConnection
                        conn.requestMethod = "POST"
                        conn.setRequestProperty("X-HTTP-Method-Override", "PATCH")
                        conn.setRequestProperty("apikey", supabaseKey)
                        conn.setRequestProperty("Authorization", "Bearer $supabaseKey")
                        conn.setRequestProperty("Content-Type", "application/json")
                        conn.doOutput = true

                        val devPayload = org.json.JSONObject().apply {
                            val locObj = org.json.JSONObject().apply {
                                put("latitude", lat)
                                put("longitude", lng)
                                put("accuracy", 10)
                                put("timestamp", msgTime)
                            }
                            put("last_known_location", locObj)
                            put("battery_level", battery ?: 50)
                            val sdf = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US)
                            sdf.timeZone = java.util.TimeZone.getTimeZone("UTC")
                            put("last_seen_at", sdf.format(java.util.Date()))
                            put("location_active", true)
                        }

                        conn.outputStream.bufferedWriter().use { it.write(devPayload.toString()) }
                        Log.d(TAG, "Native device update response: ${conn.responseCode}")
                        conn.disconnect()
                    } catch (e: Exception) {
                        Log.e(TAG, "Error updating device natively: ${e.message}")
                    }
                }

                // 4. Mark sms_requests as completed for this target device
                try {
                    val reqFilter = if (targetDeviceId.isNotEmpty() && targetDeviceId != "device" && targetDeviceId != "unknown_device") {
                        "status=eq.sent&or=(target_device_id.eq.$targetDeviceId,target_phone_number.eq.$sender,target_phone_number.eq.%2B91$cleanSender,target_phone_number.eq.$cleanSender)"
                    } else {
                        "status=eq.sent&or=(target_phone_number.eq.$sender,target_phone_number.eq.%2B91$cleanSender,target_phone_number.eq.$cleanSender)"
                    }

                    val reqUrl = URL("$supabaseUrl/rest/v1/sms_requests?$reqFilter")
                    val conn = reqUrl.openConnection() as HttpURLConnection
                    conn.requestMethod = "POST"
                    conn.setRequestProperty("X-HTTP-Method-Override", "PATCH")
                    conn.setRequestProperty("apikey", supabaseKey)
                    conn.setRequestProperty("Authorization", "Bearer $supabaseKey")
                    conn.setRequestProperty("Content-Type", "application/json")
                    conn.doOutput = true

                    val reqPayload = org.json.JSONObject().apply {
                        put("status", "completed")
                        val sdf = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US)
                        sdf.timeZone = java.util.TimeZone.getTimeZone("UTC")
                        put("updated_at", sdf.format(java.util.Date()))
                    }

                    conn.outputStream.bufferedWriter().use { it.write(reqPayload.toString()) }
                    Log.d(TAG, "Native request completion response: ${conn.responseCode}")
                    conn.disconnect()
                } catch (e: Exception) {
                    Log.e(TAG, "Error marking sms_requests completed natively: ${e.message}")
                }

            } catch (e: Exception) {
                Log.e(TAG, "Error in native telemetry processing: ${e.message}", e)
            } finally {
                pendingResult.finish()
            }
        }
    }

    companion object {
        private const val TAG = "SmsReceiver"
    }
}
