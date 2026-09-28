package expo.modules.backgroundcamera

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.util.Log
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit

object SupabaseUploadHelper {
    private const val TAG = "SupabaseUploadHelper"

    const val SUPABASE_URL = "https://bmqmdykqrnocjyqjjtzb.supabase.co"
    const val SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJtcW1keWtxcm5vY2p5cWpqdHpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0NzM0MTUsImV4cCI6MjEwMjA0OTQxNX0.F6s5c0Tw9UY0FeAjwdlKf2MUuRqnkRrCQW7q5_f-g_A"
    const val BUCKET_NAME = "device_media"

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    fun isOnline(context: Context): Boolean {
        val connectivityManager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            ?: return false

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val network = connectivityManager.activeNetwork ?: return false
            val capabilities = connectivityManager.getNetworkCapabilities(network) ?: return false
            return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
                   capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
        } else {
            @Suppress("DEPRECATION")
            val networkInfo = connectivityManager.activeNetworkInfo
            @Suppress("DEPRECATION")
            return networkInfo != null && networkInfo.isConnected
        }
    }

    /**
     * Format a timestamp as a human-readable filename-safe string.
     * Example: 2026-09-02_21-15-30
     */
    fun formatTimestamp(timestampMs: Long): String {
        val sdf = SimpleDateFormat("yyyy-MM-dd_HH-mm-ss", Locale.getDefault())
        sdf.timeZone = TimeZone.getDefault()
        return sdf.format(Date(timestampMs))
    }

    /**
     * Upload photo file to private device_media/{deviceId}/ bucket and update device row.
     * Also inserts a row into photo_captures table.
     * Returns the storage file path on success, or null on error.
     */
    fun uploadPhotoSync(context: Context, photoFile: File, type: String = "intruder"): String? {
        if (!photoFile.exists() || photoFile.length() == 0L) {
            Log.e(TAG, "Photo file does not exist or is empty: ${photoFile.absolutePath}")
            return null
        }

        val prefs = context.getSharedPreferences("intruder_prefs", Context.MODE_PRIVATE)
        val rawDeviceId = prefs.getString("device_id", null)
        val deviceId = if (!rawDeviceId.isNullOrEmpty()) rawDeviceId else "default_device"

        val fileName = photoFile.name
        val filePath = "$deviceId/$fileName"
        val storageUrl = "$SUPABASE_URL/storage/v1/object/$BUCKET_NAME/$filePath"

        try {
            val requestBody = photoFile.asRequestBody("image/jpeg".toMediaType())
            val uploadRequest = Request.Builder()
                .url(storageUrl)
                .addHeader("apikey", SUPABASE_ANON_KEY)
                .addHeader("Authorization", "Bearer $SUPABASE_ANON_KEY")
                .addHeader("Content-Type", "image/jpeg")
                .addHeader("x-upsert", "true")
                .post(requestBody)
                .build()

            val response = client.newCall(uploadRequest).execute()
            val responseBody = response.body?.string()

            if (!response.isSuccessful) {
                Log.e(TAG, "Storage upload failed: code=${response.code}, body=$responseBody")
                return null
            }

            Log.d(TAG, "Photo uploaded successfully to: $filePath")

            // Insert row into photo_captures table
            val capturedAt = extractCapturedAt(fileName)
            insertPhotoCaptureRow(deviceId, filePath, type, capturedAt)

            // Update device row with latest photo path
            updateDevicePhotoUrl(deviceId, filePath)

            return filePath
        } catch (e: Exception) {
            Log.e(TAG, "Exception uploading photo to Supabase", e)
            return null
        }
    }

    /**
     * Extract a captured_at ISO timestamp from the filename.
     * Filename format: intruder_2026-09-02_21-15-30_shot1.jpg or on_demand_2026-09-02_21-15-30.jpg
     * Falls back to current time if parsing fails.
     */
    private fun extractCapturedAt(fileName: String): String {
        return try {
            // Match pattern YYYY-MM-DD_HH-mm-ss
            val regex = Regex("""(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})""")
            val match = regex.find(fileName)
            if (match != null) {
                val datePart = match.groupValues[1]
                val timePart = match.groupValues[2].replace('-', ':')
                "${datePart}T${timePart}+05:30"
            } else {
                // Fallback: current time
                val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.getDefault())
                sdf.format(Date())
            }
        } catch (e: Exception) {
            val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.getDefault())
            sdf.format(Date())
        }
    }

    private fun insertPhotoCaptureRow(deviceId: String, filePath: String, type: String, capturedAt: String) {
        try {
            val restUrl = "$SUPABASE_URL/rest/v1/photo_captures"
            val jsonBody = """{"device_id":"$deviceId","file_path":"$filePath","type":"$type","captured_at":"$capturedAt"}"""
            val requestBody = jsonBody.toRequestBody("application/json".toMediaType())

            val insertRequest = Request.Builder()
                .url(restUrl)
                .addHeader("apikey", SUPABASE_ANON_KEY)
                .addHeader("Authorization", "Bearer $SUPABASE_ANON_KEY")
                .addHeader("Content-Type", "application/json")
                .addHeader("Prefer", "return=minimal")
                .post(requestBody)
                .build()

            val response = client.newCall(insertRequest).execute()
            if (!response.isSuccessful) {
                Log.e(TAG, "photo_captures insert failed: code=${response.code}, body=${response.body?.string()}")
            } else {
                Log.d(TAG, "photo_captures row inserted for $filePath")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to insert into photo_captures", e)
        }
    }

    private fun updateDevicePhotoUrl(deviceId: String, filePath: String) {
        try {
            val restUrl = "$SUPABASE_URL/rest/v1/devices?id=eq.$deviceId"
            val jsonBody = """{"latest_photo_url":"$filePath"}"""
            val requestBody = jsonBody.toRequestBody("application/json".toMediaType())

            val updateRequest = Request.Builder()
                .url(restUrl)
                .addHeader("apikey", SUPABASE_ANON_KEY)
                .addHeader("Authorization", "Bearer $SUPABASE_ANON_KEY")
                .addHeader("Content-Type", "application/json")
                .addHeader("Prefer", "return=minimal")
                .patch(requestBody)
                .build()

            val response = client.newCall(updateRequest).execute()
            if (!response.isSuccessful) {
                Log.e(TAG, "Device table update failed: code=${response.code}, body=${response.body?.string()}")
            } else {
                Log.d(TAG, "Device table updated with latest_photo_url=$filePath")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to update device table in Supabase", e)
        }
    }
}
