package expo.modules.backgroundcamera

import android.content.Context
import android.util.Log
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

class IntruderUploadWorker(
    context: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(context, workerParams) {

    companion object {
        private const val TAG = "IntruderUploadWorker"
        private const val WORK_NAME = "IntruderPhotoUploadWork"

        fun enqueue(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()

            val uploadWorkRequest = OneTimeWorkRequestBuilder<IntruderUploadWorker>()
                .setConstraints(constraints)
                .build()

            WorkManager.getInstance(context).enqueueUniqueWork(
                WORK_NAME,
                ExistingWorkPolicy.KEEP,
                uploadWorkRequest
            )
            Log.d(TAG, "Enqueued IntruderUploadWorker with CONNECTED constraint")
        }
    }

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val context = applicationContext
        val prefs = context.getSharedPreferences("intruder_prefs", Context.MODE_PRIVATE)
        val queueJson = prefs.getString("pending_uploads", "[]") ?: "[]"

        try {
            val jsonArray = JSONArray(queueJson)
            if (jsonArray.length() == 0) {
                Log.d(TAG, "No pending intruder photos to upload")
                return@withContext Result.success()
            }

            Log.d(TAG, "Processing ${jsonArray.length()} pending intruder uploads...")
            val remainingList = JSONArray()

            for (i in 0 until jsonArray.length()) {
                val item = jsonArray.getJSONObject(i)
                val filePath = item.optString("filePath")
                val timestamp = item.optLong("timestamp")
                val file = File(filePath)

                if (file.exists() && file.length() > 0) {
                    val publicUrl = SupabaseUploadHelper.uploadPhotoSync(context, file)
                    if (publicUrl != null) {
                        Log.d(TAG, "Successfully uploaded queued intruder photo: $filePath -> $publicUrl")
                        // Update record in history as uploaded
                        updateHistoryRecord(context, filePath, publicUrl)
                    } else {
                        Log.w(TAG, "Failed to upload queued file: $filePath, will retry later")
                        remainingList.put(item)
                    }
                } else {
                    Log.w(TAG, "Queued photo file does not exist, dropping: $filePath")
                }
            }

            prefs.edit().putString("pending_uploads", remainingList.toString()).apply()

            if (remainingList.length() > 0) {
                Result.retry()
            } else {
                Result.success()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error in IntruderUploadWorker", e)
            Result.retry()
        }
    }

    private fun updateHistoryRecord(context: Context, filePath: String, publicUrl: String) {
        val prefs = context.getSharedPreferences("intruder_prefs", Context.MODE_PRIVATE)
        val historyJson = prefs.getString("capture_history", "[]") ?: "[]"
        try {
            val history = JSONArray(historyJson)
            for (i in 0 until history.length()) {
                val entry = history.getJSONObject(i)
                if (entry.optString("filePath") == filePath) {
                    entry.put("status", "UPLOADED")
                    entry.put("publicUrl", publicUrl)
                    break
                }
            }
            prefs.edit().putString("capture_history", history.toString()).apply()
        } catch (e: Exception) {
            Log.w(TAG, "Failed to update capture history record", e)
        }
    }
}
