package com.quickerhub.nearbox

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.widget.Toast
import androidx.core.content.FileProvider
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/** Downloads the APK the paired PC is serving and asks Android to install it. */
object ApkInstaller {
    private val io = Executors.newSingleThreadExecutor()

    fun start(activity: Activity, url: String) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.packageManager.canRequestPackageInstalls()) {
            Toast.makeText(activity, activity.getString(R.string.install_permission), Toast.LENGTH_LONG).show()
            activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
            return
        }
        Toast.makeText(activity, activity.getString(R.string.installing_apk), Toast.LENGTH_SHORT).show()
        io.execute {
            try {
                val file = download(activity, url)
                activity.runOnUiThread { promptInstall(activity, file) }
            } catch (error: Exception) {
                activity.runOnUiThread {
                    Toast.makeText(activity, activity.getString(R.string.install_failed, error.message.orEmpty()), Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    private fun download(activity: Activity, url: String): File {
        val dest = File(activity.cacheDir, "nearbox-update.apk")
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            instanceFollowRedirects = true
            connectTimeout = 15_000
            readTimeout = 60_000
            setRequestProperty("User-Agent", "Nearbox")
        }
        try {
            if (connection.responseCode !in 200..299) {
                throw IllegalStateException("HTTP ${connection.responseCode}")
            }
            connection.inputStream.use { input ->
                dest.outputStream().use { output -> input.copyTo(output) }
            }
        } finally {
            connection.disconnect()
        }
        return dest
    }

    private fun promptInstall(activity: Activity, file: File) {
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.files", file)
        activity.startActivity(
            Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            },
        )
    }
}
