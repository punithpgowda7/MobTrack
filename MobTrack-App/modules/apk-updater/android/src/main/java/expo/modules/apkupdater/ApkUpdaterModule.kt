package expo.modules.apkupdater

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import androidx.core.content.pm.PackageInfoCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

class ApkUpdaterModule : Module() {
    private var isDownloading = false

    override fun definition() = ModuleDefinition {
        Name("ApkUpdater")

        Events("onDownloadProgress")

        AsyncFunction("getAppVersion") { promise: Promise ->
            try {
                val ctx = appContext.reactContext
                    ?: throw Exception("React context unavailable")
                val pInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    ctx.packageManager.getPackageInfo(ctx.packageName, PackageManager.PackageInfoFlags.of(0))
                } else {
                    @Suppress("DEPRECATION")
                    ctx.packageManager.getPackageInfo(ctx.packageName, 0)
                }
                val versionCode = PackageInfoCompat.getLongVersionCode(pInfo)
                val versionName = pInfo.versionName ?: "1.0.0"

                promise.resolve(
                    mapOf(
                        "versionCode" to versionCode,
                        "versionName" to versionName,
                        "packageName" to ctx.packageName
                    )
                )
            } catch (e: Exception) {
                promise.reject("ERR_VERSION", e.message ?: "Failed to get version", e)
            }
        }

        Function("getDeviceId") {
            val ctx = appContext.reactContext ?: return@Function ""
            Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ANDROID_ID) ?: ""
        }

        AsyncFunction("verifyPassword") { password: String, storedHash: String, promise: Promise ->
            try {
                if (storedHash.startsWith("pbkdf2:sha256:")) {
                    val parts = storedHash.split(":")
                    if (parts.size == 5) {
                        val iterations = parts[2].toInt()
                        val saltHex = parts[3]
                        val expectedHash = parts[4].lowercase()
                        val salt = ByteArray(saltHex.length / 2) { i ->
                            saltHex.substring(i * 2, i * 2 + 2).toInt(16).toByte()
                        }
                        val spec = javax.crypto.spec.PBEKeySpec(password.toCharArray(), salt, iterations, expectedHash.length * 4)
                        val skf = javax.crypto.SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
                        val hashBytes = skf.generateSecret(spec).encoded
                        val calcHash = hashBytes.joinToString("") { "%02x".format(it) }
                        var diff = 0
                        if (calcHash.length != expectedHash.length) {
                            promise.resolve(false)
                            return@AsyncFunction
                        }
                        for (i in calcHash.indices) {
                            diff = diff or (calcHash[i].code xor expectedHash[i].code)
                        }
                        promise.resolve(diff == 0)
                        return@AsyncFunction
                    }
                }
                promise.resolve(password == storedHash)
            } catch (e: Exception) {
                promise.resolve(password == storedHash)
            }
        }

        Function("canRequestPackageInstalls") {
            val ctx = appContext.reactContext ?: return@Function false
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.packageManager.canRequestPackageInstalls()
            } else {
                true
            }
        }

        Function("openInstallPermissionSettings") {
            val ctx = appContext.reactContext ?: return@Function false
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                try {
                    val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
                        data = Uri.parse("package:${ctx.packageName}")
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    ctx.startActivity(intent)
                    true
                } catch (e: Exception) {
                    false
                }
            } else {
                false
            }
        }

        AsyncFunction("downloadApk") { apkUrl: String, promise: Promise ->
            val ctx = appContext.reactContext
            if (ctx == null) {
                promise.reject("ERR_CONTEXT", "React context unavailable", null)
                return@AsyncFunction
            }

            if (isDownloading) {
                promise.reject("ERR_BUSY", "Another download is already in progress", null)
                return@AsyncFunction
            }

            isDownloading = true

            thread(name = "ApkDownloadThread") {
                var connection: HttpURLConnection? = null
                var input: InputStream? = null
                var output: FileOutputStream? = null

                try {
                    var currentUrl = apkUrl
                    var redirectCount = 0
                    val maxRedirects = 5

                    while (redirectCount < maxRedirects) {
                        val url = URL(currentUrl)
                        connection = url.openConnection() as HttpURLConnection
                        connection.instanceFollowRedirects = true
                        connection.connectTimeout = 30000
                        connection.readTimeout = 30000
                        connection.setRequestProperty("User-Agent", "MobTrack-App-Updater")
                        connection.connect()

                        val status = connection.responseCode
                        if (status == HttpURLConnection.HTTP_MOVED_PERM ||
                            status == HttpURLConnection.HTTP_MOVED_TEMP ||
                            status == HttpURLConnection.HTTP_SEE_OTHER ||
                            status == 307 || status == 308
                        ) {
                            val newUrl = connection.getHeaderField("Location")
                            connection.disconnect()
                            if (newUrl != null && newUrl.isNotEmpty()) {
                                currentUrl = newUrl
                                redirectCount++
                                continue
                            }
                        }
                        break
                    }

                    val responseCode = connection?.responseCode ?: -1
                    if (responseCode != HttpURLConnection.HTTP_OK) {
                        throw Exception("Server returned HTTP $responseCode")
                    }

                    val fileLength = connection?.contentLengthLong ?: -1L
                    val apkFile = File(ctx.cacheDir, "mobtrack_update.apk")
                    if (apkFile.exists()) {
                        apkFile.delete()
                    }

                    input = connection?.inputStream ?: throw Exception("Null input stream")
                    output = FileOutputStream(apkFile)

                    val buffer = ByteArray(8192)
                    var totalRead: Long = 0
                    var count: Int
                    var lastReportedPercent = -1

                    while (input.read(buffer).also { count = it } != -1) {
                        output.write(buffer, 0, count)
                        totalRead += count

                        if (fileLength > 0) {
                            val percent = ((totalRead * 100) / fileLength).toInt()
                            if (percent != lastReportedPercent) {
                                lastReportedPercent = percent
                                sendEvent(
                                    "onDownloadProgress",
                                    mapOf(
                                        "progress" to (totalRead.toDouble() / fileLength.toDouble()),
                                        "percent" to percent,
                                        "receivedBytes" to totalRead,
                                        "totalBytes" to fileLength
                                    )
                                )
                            }
                        } else {
                            sendEvent(
                                "onDownloadProgress",
                                mapOf(
                                    "progress" to -1.0,
                                    "percent" to -1,
                                    "receivedBytes" to totalRead,
                                    "totalBytes" to -1L
                                )
                            )
                        }
                    }

                    output.flush()

                    isDownloading = false
                    promise.resolve(apkFile.absolutePath)
                } catch (e: Exception) {
                    isDownloading = false
                    promise.reject("ERR_DOWNLOAD", e.message ?: "Failed to download APK", e)
                } finally {
                    try { output?.close() } catch (_: Exception) {}
                    try { input?.close() } catch (_: Exception) {}
                    try { connection?.disconnect() } catch (_: Exception) {}
                }
            }
        }

        AsyncFunction("installApk") { filePath: String?, promise: Promise ->
            try {
                val ctx = appContext.reactContext
                    ?: throw Exception("React context unavailable")

                val path = filePath ?: File(ctx.cacheDir, "mobtrack_update.apk").absolutePath
                val file = File(path)

                if (!file.exists() || file.length() == 0L) {
                    throw Exception("APK file does not exist or is empty at $path")
                }

                val apkUri = FileProvider.getUriForFile(
                    ctx,
                    "${ctx.packageName}.fileprovider",
                    file
                )

                val intent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(apkUri, "application/vnd.android.package-archive")
                    clipData = ClipData.newRawUri("", apkUri)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
                }

                ctx.startActivity(intent)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("ERR_INSTALL", e.message ?: "Failed to trigger installer", e)
            }
        }
    }
}
