package expo.modules.smsgateway

import android.telephony.SmsManager
import android.util.Log

object SmsSender {
    private const val TAG = "SmsSender"

    fun sendSms(phoneNumber: String, message: String): Boolean {
        return try {
            @Suppress("DEPRECATION")
            val smsManager: SmsManager = SmsManager.getDefault()
            val parts = smsManager.divideMessage(message)
            if (parts.size > 1) {
                smsManager.sendMultipartTextMessage(phoneNumber, null, parts, null, null)
            } else {
                smsManager.sendTextMessage(phoneNumber, null, message, null, null)
            }
            Log.d(TAG, "Successfully sent SMS to $phoneNumber")
            true
        } catch (e: Exception) {
            Log.e(TAG, "Error sending SMS to $phoneNumber", e)
            false
        }
    }
}
