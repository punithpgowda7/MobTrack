package expo.modules.offlinegps

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.Tasks
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.*

class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val deviceId = inputData.getString("DEVICE_ID") ?: return@withContext Result.failure()
        val supabaseUrl = inputData.getString("SUPABASE_URL") ?: return@withContext Result.failure()
        val supabaseAnonKey = inputData.getString("SUPABASE_ANON_KEY") ?: return@withContext Result.failure()

        val dbHelper = DatabaseHelper(applicationContext)
        val breadcrumbs = dbHelper.getAllBreadcrumbs()
        
        var uploadSuccess = true

        if (breadcrumbs.isNotEmpty()) {
            val jsonArray = JSONArray()
            for (bc in breadcrumbs) {
                val obj = JSONObject().apply {
                    put("device_id", bc.deviceId ?: deviceId)
                    put("latitude", bc.latitude)
                    put("longitude", bc.longitude)
                    put("timestamp", bc.timestamp)
                }
                jsonArray.put(obj)
            }

            try {
                val url = URL("$supabaseUrl/rest/v1/offline_gps_history")
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("apikey", supabaseAnonKey)
                conn.setRequestProperty("Authorization", "Bearer $supabaseAnonKey")
                conn.setRequestProperty("Content-Type", "application/json")
                conn.setRequestProperty("Prefer", "return=minimal")
                conn.doOutput = true

                OutputStreamWriter(conn.outputStream).use { writer ->
                    writer.write(jsonArray.toString())
                    writer.flush()
                }

                val responseCode = conn.responseCode
                if (responseCode in 200..299) {
                    dbHelper.deleteBreadcrumbs(breadcrumbs.map { it.id })
                } else {
                    uploadSuccess = false
                }
            } catch (e: Exception) {
                e.printStackTrace()
                uploadSuccess = false
            }
        }

        // Upload current location
        try {
            val fusedLocationClient = LocationServices.getFusedLocationProviderClient(applicationContext)
            val location = Tasks.await(fusedLocationClient.getCurrentLocation(Priority.PRIORITY_BALANCED_POWER_ACCURACY, null))
            
            if (location != null) {
                val locJson = JSONObject().apply {
                    put("latitude", location.latitude)
                    put("longitude", location.longitude)
                    put("accuracy", location.accuracy)
                    put("timestamp", location.time)
                }
                
                val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
                sdf.timeZone = TimeZone.getTimeZone("UTC")
                val now = sdf.format(Date())

                val updateObj = JSONObject().apply {
                    put("last_known_location", locJson)
                    put("last_seen_at", now)
                    put("location_active", true)
                }

                val url = URL("$supabaseUrl/rest/v1/devices?id=eq.$deviceId")
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "PATCH"
                conn.setRequestProperty("apikey", supabaseAnonKey)
                conn.setRequestProperty("Authorization", "Bearer $supabaseAnonKey")
                conn.setRequestProperty("Content-Type", "application/json")
                conn.doOutput = true

                OutputStreamWriter(conn.outputStream).use { writer ->
                    writer.write(updateObj.toString())
                    writer.flush()
                }

                val currentResponse = conn.responseCode
                if (currentResponse !in 200..299) uploadSuccess = false
            }
        } catch (e: Exception) {
            e.printStackTrace()
            // Retry until both history and the current device location are acknowledged.
            uploadSuccess = false
        }

        if (uploadSuccess) {
            Result.success()
        } else {
            Result.retry()
        }
    }
}
