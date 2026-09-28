package expo.modules.smsgateway

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import android.util.Log

class SmsGatewayModule : Module() {

    override fun definition() = ModuleDefinition {
        Name("SmsGateway")

        Events("onSmsTriggerReceived", "onSmsTelemetryReceived")

        Function("sendSms") { phoneNumber: String, message: String ->
            SmsSender.sendSms(phoneNumber, message)
        }

        Function("setSecurityPin") { pin: String ->
            configuredPin = pin
            Log.d("SmsGatewayModule", "Security PIN configured: $pin")
        }
    }

    companion object {
        private var configuredPin: String = ""
        private var instance: SmsGatewayModule? = null

        fun handleTriggerSms(senderNumber: String, pin: String, deviceId: String) {
            Log.d("SmsGatewayModule", "Handling trigger SMS. Received PIN: $pin, Configured PIN: $configuredPin")
            
            // Verify security PIN (or allow if pin matches configured)
            if (configuredPin.isEmpty() || pin == configuredPin) {
                instance?.sendEvent(
                    "onSmsTriggerReceived",
                    mapOf(
                        "senderNumber" to senderNumber,
                        "pin" to pin,
                        "deviceId" to deviceId
                    )
                )
            } else {
                Log.w("SmsGatewayModule", "PIN mismatch. Rejecting SMS trigger.")
            }
        }

        fun handleTelemetrySms(senderNumber: String, payload: String) {
            instance?.sendEvent(
                "onSmsTelemetryReceived",
                mapOf(
                    "senderNumber" to senderNumber,
                    "payload" to payload
                )
            )
        }
    }

    init {
        instance = this
    }
}
