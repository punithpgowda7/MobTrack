package expo.modules.offlinegps

import android.app.*
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.Sensor
import android.hardware.SensorManager
import android.hardware.TriggerEvent
import android.hardware.TriggerEventListener
import android.location.Location
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.work.*
import com.google.android.gms.location.*
import java.util.concurrent.TimeUnit

class OfflineGpsService : Service() {

    companion object {
        private const val TAG = "OfflineGpsService"
        const val CHANNEL_ID = "OfflineGpsServiceChannel"
        const val NOTIFICATION_ID = 199

        const val ACTION_MODE_CHANGED = "expo.modules.offlinegps.ACTION_MODE_CHANGED"
        const val EXTRA_LOST_MODE = "is_lost_mode"
        const val EXTRA_FAKE_SHUTDOWN = "is_fake_shutdown"
        const val PREFS_DEVICE_STATE = "mobtrack_device_state"

        // Standby / Adaptive tracking parameters (low battery drain)
        private const val STANDBY_INTERVAL_MS = 60 * 1000L          // 60 seconds
        private const val STANDBY_MIN_INTERVAL_MS = 30 * 1000L      // 30 seconds
        private const val STANDBY_MIN_DISTANCE_M = 25f              // 25 meters adaptive displacement
        private const val STANDBY_MAX_DELAY_MS = 120 * 1000L        // 2 minutes batching allows Doze/deep sleep

        // Emergency / Lost Mode / Fake Shutdown tracking parameters (high fidelity)
        private const val EMERGENCY_INTERVAL_MS = 10 * 1000L        // 10 seconds
        private const val EMERGENCY_MIN_INTERVAL_MS = 5 * 1000L     // 5 seconds
        private const val EMERGENCY_MIN_DISTANCE_M = 0f             // 0 meters (every point recorded)
        private const val EMERGENCY_MAX_DELAY_MS = 0L               // Immediate delivery

        // Lost mode auto-timeout if no further command arrives (30 mins)
        private const val LOST_MODE_TIMEOUT_MS = 30 * 60 * 1000L

        var instance: OfflineGpsService? = null
            private set

        fun setLostMode(context: Context, isLost: Boolean) {
            try {
                context.getSharedPreferences(PREFS_DEVICE_STATE, Context.MODE_PRIVATE)
                    .edit().putBoolean(EXTRA_LOST_MODE, isLost).apply()
                val intent = Intent(ACTION_MODE_CHANGED).apply {
                    putExtra(EXTRA_LOST_MODE, isLost)
                    setPackage(context.packageName)
                }
                context.sendBroadcast(intent)
            } catch (e: Exception) {
                Log.w(TAG, "Error setting lost mode: ${e.message}")
            }
        }

        fun setFakeShutdown(context: Context, isActive: Boolean) {
            try {
                context.getSharedPreferences(PREFS_DEVICE_STATE, Context.MODE_PRIVATE)
                    .edit().putBoolean(EXTRA_FAKE_SHUTDOWN, isActive).apply()
                val intent = Intent(ACTION_MODE_CHANGED).apply {
                    putExtra(EXTRA_FAKE_SHUTDOWN, isActive)
                    setPackage(context.packageName)
                }
                context.sendBroadcast(intent)
            } catch (e: Exception) {
                Log.w(TAG, "Error setting fake shutdown: ${e.message}")
            }
        }
    }

    private lateinit var connectivityManager: ConnectivityManager
    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private lateinit var locationCallback: LocationCallback
    private lateinit var dbHelper: DatabaseHelper
    private var isTrackingLocations = false
    private var networkCallbackRegistered = false
    private var modeReceiverRegistered = false

    private var deviceId: String? = null
    private var supabaseUrl: String? = null
    private var supabaseAnonKey: String? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var lastAutoSmsTime = 0L

    // Adaptive tracking state
    @Volatile private var isLostMode = false
    @Volatile private var isFakeShutdownActive = false
    @Volatile private var currentTrackingModeHighAccuracy = false
    private var lostModeStartTime = 0L

    // Significant motion sensor
    private var sensorManager: SensorManager? = null
    private var sigMotionSensor: Sensor? = null
    private var sigMotionListener: TriggerEventListener? = null

    private fun acquireTemporaryWakeLock(timeoutMs: Long = 5000L) {
        try {
            wakeLock?.acquire(timeoutMs)
        } catch (e: Exception) {
            Log.w(TAG, "Error acquiring temporary wakelock: ${e.message}")
        }
    }

    private fun isHighAccuracyActive(): Boolean {
        if (isFakeShutdownActive) return true
        if (isLostMode) {
            val elapsed = System.currentTimeMillis() - lostModeStartTime
            if (elapsed < LOST_MODE_TIMEOUT_MS) {
                return true
            } else {
                // Auto-timeout expired: revert to standby
                isLostMode = false
                getSharedPreferences(PREFS_DEVICE_STATE, Context.MODE_PRIVATE)
                    .edit().putBoolean(EXTRA_LOST_MODE, false).apply()
            }
        }
        return false
    }

    private val modeReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == ACTION_MODE_CHANGED) {
                if (intent.hasExtra(EXTRA_LOST_MODE)) {
                    isLostMode = intent.getBooleanExtra(EXTRA_LOST_MODE, false)
                    if (isLostMode) {
                        lostModeStartTime = System.currentTimeMillis()
                    }
                }
                if (intent.hasExtra(EXTRA_FAKE_SHUTDOWN)) {
                    isFakeShutdownActive = intent.getBooleanExtra(EXTRA_FAKE_SHUTDOWN, false)
                }
                reconfigureTracking()
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
        dbHelper = DatabaseHelper(this)
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)

        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "MobTrack::OfflineGpsWakeLock").apply {
            setReferenceCounted(false)
        }
        // NOTE: Permanent wakeLock?.acquire() is intentionally omitted to prevent CPU drain.
        // Temporary wakeLocks with safe timeouts are acquired only during location processing and data syncing.

        locationCallback = object : LocationCallback() {
            override fun onLocationResult(locationResult: LocationResult) {
                acquireTemporaryWakeLock(5000L)
                for (location in locationResult.locations) {
                    recordLocation(location)
                }
            }
        }

        if (!modeReceiverRegistered) {
            val filter = IntentFilter(ACTION_MODE_CHANGED)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(modeReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                registerReceiver(modeReceiver, filter)
            }
            modeReceiverRegistered = true
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        intent?.let {
            if (it.hasExtra("DEVICE_ID")) deviceId = it.getStringExtra("DEVICE_ID")
            if (it.hasExtra("SUPABASE_URL")) supabaseUrl = it.getStringExtra("SUPABASE_URL")
            if (it.hasExtra("SUPABASE_ANON_KEY")) supabaseAnonKey = it.getStringExtra("SUPABASE_ANON_KEY")

            val prefs = getSharedPreferences("offline_gps_config", MODE_PRIVATE).edit()
            if (deviceId != null) prefs.putString("DEVICE_ID", deviceId)
            if (supabaseUrl != null) prefs.putString("SUPABASE_URL", supabaseUrl)
            if (supabaseAnonKey != null) prefs.putString("SUPABASE_ANON_KEY", supabaseAnonKey)
            prefs.apply()

            if (it.hasExtra(EXTRA_LOST_MODE)) {
                isLostMode = it.getBooleanExtra(EXTRA_LOST_MODE, false)
                if (isLostMode) lostModeStartTime = System.currentTimeMillis()
            }
            if (it.hasExtra(EXTRA_FAKE_SHUTDOWN)) {
                isFakeShutdownActive = it.getBooleanExtra(EXTRA_FAKE_SHUTDOWN, false)
            }
        }
        if (deviceId == null) {
            val prefs = getSharedPreferences("offline_gps_config", MODE_PRIVATE)
            deviceId = prefs.getString("DEVICE_ID", null)
            supabaseUrl = prefs.getString("SUPABASE_URL", null)
            supabaseAnonKey = prefs.getString("SUPABASE_ANON_KEY", null)
        }

        // Restore persisted state
        val statePrefs = getSharedPreferences(PREFS_DEVICE_STATE, Context.MODE_PRIVATE)
        if (!isFakeShutdownActive) {
            isFakeShutdownActive = statePrefs.getBoolean(EXTRA_FAKE_SHUTDOWN, false)
        }
        if (!isLostMode) {
            isLostMode = statePrefs.getBoolean(EXTRA_LOST_MODE, false)
            if (isLostMode) lostModeStartTime = System.currentTimeMillis()
        }

        createNotificationChannel()
        val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Offline GPS Protection")
            .setContentText("Monitoring location if device goes offline")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

        startForeground(NOTIFICATION_ID, notification)

        setupNetworkCallback()
        reconfigureTracking()

        return START_STICKY
    }

    private fun setupNetworkCallback() {
        connectivityManager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()

        if (!networkCallbackRegistered) {
            connectivityManager.registerNetworkCallback(request, networkCallback)
            networkCallbackRegistered = true
        }

        if (hasUsableNetwork()) triggerSyncWorker()
    }

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            super.onAvailable(network)
            if (hasUsableNetwork()) {
                triggerSyncWorker()
            }
        }

        override fun onLost(network: Network) {
            super.onLost(network)
            // Keep collecting locally while offline.
        }
    }

    private fun hasUsableNetwork(): Boolean {
        val network = connectivityManager.activeNetwork ?: return false
        val caps = connectivityManager.getNetworkCapabilities(network) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            (caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) ||
                caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) ||
                caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI))
    }

    private fun reconfigureTracking() {
        val shouldBeHighAccuracy = isHighAccuracyActive()
        if (shouldBeHighAccuracy == currentTrackingModeHighAccuracy && isTrackingLocations) {
            return
        }
        Log.d(TAG, "Reconfiguring location updates: highAccuracy=$shouldBeHighAccuracy")
        applyLocationRequest(shouldBeHighAccuracy)
    }

    private fun applyLocationRequest(highAccuracy: Boolean) {
        if (checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) != android.content.pm.PackageManager.PERMISSION_GRANTED &&
            checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION) != android.content.pm.PackageManager.PERMISSION_GRANTED) return

        try {
            val priority = if (highAccuracy) Priority.PRIORITY_HIGH_ACCURACY else Priority.PRIORITY_BALANCED_POWER_ACCURACY
            val interval = if (highAccuracy) EMERGENCY_INTERVAL_MS else STANDBY_INTERVAL_MS
            val minInterval = if (highAccuracy) EMERGENCY_MIN_INTERVAL_MS else STANDBY_MIN_INTERVAL_MS
            val minDistance = if (highAccuracy) EMERGENCY_MIN_DISTANCE_M else STANDBY_MIN_DISTANCE_M
            val maxDelay = if (highAccuracy) EMERGENCY_MAX_DELAY_MS else STANDBY_MAX_DELAY_MS

            val locationRequest = LocationRequest.Builder(priority, interval)
                .setMinUpdateIntervalMillis(minInterval)
                .setMinUpdateDistanceMeters(minDistance)
                .setMaxUpdateDelayMillis(maxDelay)
                .build()

            if (isTrackingLocations) {
                fusedLocationClient.removeLocationUpdates(locationCallback)
            }

            fusedLocationClient.requestLocationUpdates(
                locationRequest,
                locationCallback,
                Looper.getMainLooper()
            )
            isTrackingLocations = true
            currentTrackingModeHighAccuracy = highAccuracy

            if (!highAccuracy) {
                armSignificantMotionSensor()
            } else {
                disarmSignificantMotionSensor()
            }
        } catch (e: SecurityException) {
            isTrackingLocations = false
            Log.e(TAG, "SecurityException requesting location updates", e)
        } catch (e: Exception) {
            Log.e(TAG, "Error applying location request", e)
        }
    }

    private fun armSignificantMotionSensor() {
        try {
            if (sensorManager == null) {
                sensorManager = getSystemService(Context.SENSOR_SERVICE) as? SensorManager
            }
            if (sigMotionSensor == null) {
                sigMotionSensor = sensorManager?.getDefaultSensor(Sensor.TYPE_SIGNIFICANT_MOTION)
            }
            if (sigMotionSensor != null) {
                if (sigMotionListener == null) {
                    sigMotionListener = object : TriggerEventListener() {
                        override fun onTrigger(event: TriggerEvent?) {
                            Log.d(TAG, "Significant motion detected — device is moving")
                            acquireTemporaryWakeLock(5000L)
                            requestSingleLocationFix()
                            // Significant motion triggers are one-shot; re-arm if still in standby mode
                            if (!isHighAccuracyActive() && sigMotionSensor != null) {
                                try {
                                    sensorManager?.requestTriggerSensor(this, sigMotionSensor)
                                } catch (_: Exception) {}
                            }
                        }
                    }
                }
                sensorManager?.requestTriggerSensor(sigMotionListener, sigMotionSensor)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Significant motion sensor setup failed: ${e.message}")
        }
    }

    private fun disarmSignificantMotionSensor() {
        try {
            if (sigMotionListener != null && sigMotionSensor != null) {
                sensorManager?.cancelTriggerSensor(sigMotionListener, sigMotionSensor)
            }
        } catch (_: Exception) {}
    }

    private fun requestSingleLocationFix() {
        if (checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) != android.content.pm.PackageManager.PERMISSION_GRANTED &&
            checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION) != android.content.pm.PackageManager.PERMISSION_GRANTED) return
        try {
            fusedLocationClient.getCurrentLocation(Priority.PRIORITY_BALANCED_POWER_ACCURACY, null)
                .addOnSuccessListener { location ->
                    location?.let {
                        acquireTemporaryWakeLock(5000L)
                        recordLocation(it)
                    }
                }
        } catch (e: Exception) {
            Log.w(TAG, "Error fetching single location fix: ${e.message}")
        }
    }

    private fun recordLocation(location: Location) {
        dbHelper.addBreadcrumb(deviceId, location.latitude, location.longitude, location.time)
        // The queue is always written first. If connectivity is currently
        // available, ask WorkManager to upload the pending queue afterward.
        if (hasUsableNetwork()) {
            triggerSyncWorker()
        } else {
            checkAndSendOfflinePathSms()
        }
    }

    private fun stopLocationUpdates() {
        if (!isTrackingLocations) return
        isTrackingLocations = false
        fusedLocationClient.removeLocationUpdates(locationCallback)
        disarmSignificantMotionSensor()
    }

    private fun triggerSyncWorker() {
        if (deviceId == null || supabaseUrl == null || supabaseAnonKey == null) return

        val data = workDataOf(
            "DEVICE_ID" to deviceId,
            "SUPABASE_URL" to supabaseUrl,
            "SUPABASE_ANON_KEY" to supabaseAnonKey
        )

        val syncRequest = OneTimeWorkRequestBuilder<SyncWorker>()
            .setInputData(data)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 1, TimeUnit.MINUTES)
            .build()

        WorkManager.getInstance(applicationContext).enqueueUniqueWork(
            "OfflineGpsSyncWorker",
            ExistingWorkPolicy.KEEP,
            syncRequest
        )
    }

    private fun checkAndSendOfflinePathSms() {
        val now = System.currentTimeMillis()
        if (lastAutoSmsTime != 0L && now - lastAutoSmsTime < 15 * 60 * 1000L) {
            return
        }

        val prefs = getSharedPreferences("sms_gateway_prefs", Context.MODE_PRIVATE)
        val relayNumber = prefs.getString("last_relay_sender", null)
        if (relayNumber.isNullOrEmpty()) {
            return
        }
        val configuredPin = prefs.getString("security_pin", "1234") ?: "1234"

        acquireTemporaryWakeLock(10_000L)

        try {
            val breadcrumbs = dbHelper.getRecentBreadcrumbs(3)
            if (breadcrumbs.isEmpty()) return

            val pathSegments = mutableListOf<String>()
            val latest = breadcrumbs.last()
            val baseTime = latest.timestamp

            for (bc in breadcrumbs) {
                val latFrac = Math.abs(bc.latitude) - Math.floor(Math.abs(bc.latitude))
                val lngFrac = Math.abs(bc.longitude) - Math.floor(Math.abs(bc.longitude))
                val latFracStr = String.format(java.util.Locale.US, ".%04d", Math.round(latFrac * 10000).toInt())
                val lngFracStr = String.format(java.util.Locale.US, ".%04d", Math.round(lngFrac * 10000).toInt())
                val diffMin = Math.max(0L, (baseTime - bc.timestamp) / (60 * 1000L))
                pathSegments.add("$latFracStr,$lngFracStr,$diffMin")
            }

            val bm = getSystemService(Context.BATTERY_SERVICE) as? android.os.BatteryManager
            val batteryPct = bm?.getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY) ?: 50
            val latStr = String.format(java.util.Locale.US, "%.5f", latest.latitude)
            val lngStr = String.format(java.util.Locale.US, "%.5f", latest.longitude)
            val targetDevId = deviceId ?: "device"
            val pathSuffix = if (pathSegments.isNotEmpty()) ":${pathSegments.joinToString(";")}" else ""

            val payload = "MT1:$configuredPin:$targetDevId:$latStr,$lngStr:$batteryPct:$baseTime$pathSuffix"
            val smsManager = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                getSystemService(android.telephony.SmsManager::class.java)
            } else {
                @Suppress("DEPRECATION")
                android.telephony.SmsManager.getDefault()
            }
            smsManager.sendTextMessage(relayNumber, null, payload, null, null)
            lastAutoSmsTime = now
        } catch (e: Exception) {
            Log.e(TAG, "Error sending auto offline path SMS", e)
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val serviceChannel = NotificationChannel(
                CHANNEL_ID,
                "Offline GPS Protection Service",
                NotificationManager.IMPORTANCE_LOW
            )
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(serviceChannel)
        }
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        Log.d(TAG, "App task removed — keeping offline GPS protection service active")
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        super.onDestroy()
        stopLocationUpdates()
        if (modeReceiverRegistered) {
            try { unregisterReceiver(modeReceiver) } catch (_: Exception) {}
            modeReceiverRegistered = false
        }
        disarmSignificantMotionSensor()
        if (wakeLock?.isHeld == true) {
            try { wakeLock?.release() } catch (_: Exception) {}
        }
        try {
            if (networkCallbackRegistered) connectivityManager.unregisterNetworkCallback(networkCallback)
        } catch (_: Exception) {}
        instance = null
    }

    override fun onBind(intent: Intent?): IBinder? {
        return null
    }
}
