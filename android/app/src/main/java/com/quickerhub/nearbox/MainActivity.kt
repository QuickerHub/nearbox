package com.quickerhub.nearbox

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import com.quickerhub.nearbox.databinding.ActivityMainBinding
import com.quickerhub.nearbox.databinding.ItemHostBinding

class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var scanner: LanScanner? = null
    private val filePicker = registerForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        fileCallback?.onReceiveValue(uris.toTypedArray())
        fileCallback = null
    }
    private val qrScanner = registerForActivityResult(ScanContract()) { result ->
        val invite = InviteParser.parse(result.contents)
        if (invite == null) {
            if (!result.contents.isNullOrBlank()) {
                Toast.makeText(this, "不是 Nearbox 邀请码", Toast.LENGTH_SHORT).show()
            }
            return@registerForActivityResult
        }
        openSession(invite.host, invite.port.toString(), invite.token)
    }
    private val cameraPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            startQrScan()
        } else {
            Toast.makeText(this, getString(R.string.camera_needed), Toast.LENGTH_SHORT).show()
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.hostInput.setText(prefs().getString(KEY_HOST, ""))
        binding.connectButton.setOnClickListener { connectFromForm() }
        binding.pasteButton.setOnClickListener { pasteInvite() }
        binding.refreshButton.setOnClickListener { scanner?.refresh(prefs().getString(KEY_HOST, null)) }
        binding.scanButton.setOnClickListener { requestQrScan() }

        binding.webView.settings.javaScriptEnabled = true
        binding.webView.settings.domStorageEnabled = true
        binding.webView.settings.allowFileAccess = true
        binding.webView.settings.userAgentString =
            "${binding.webView.settings.userAgentString} NearboxShell/${packageManager.getPackageInfo(packageName, 0).versionName}"
        binding.webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                return false
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (!request.isForMainFrame) {
                    return
                }
                showPairing("连不上电脑，正在重新查找…")
            }
        }
        binding.webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?,
            ): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = filePathCallback
                filePicker.launch("*/*")
                return true
            }
        }

        if (!handleIntent(intent)) {
            if (!reopenLastHost()) {
                showPairing()
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    override fun onDestroy() {
        scanner?.stop()
        super.onDestroy()
    }

    private fun reopenLastHost(): Boolean {
        val host = prefs().getString(KEY_HOST, "").orEmpty()
        if (host.isBlank()) {
            return false
        }
        val port = prefs().getInt(KEY_PORT, 17831)
        showWeb("http://$host:$port/")
        return true
    }

    override fun onBackPressed() {
        if (binding.webView.visibility == View.VISIBLE && binding.webView.canGoBack()) {
            binding.webView.goBack()
            return
        }
        if (binding.webView.visibility == View.VISIBLE) {
            showPairing()
            return
        }
        super.onBackPressed()
    }

    private fun handleIntent(intent: Intent?): Boolean {
        val invite = InviteParser.parse(intent?.data?.toString()) ?: return false
        openSession(invite.host, invite.port.toString(), invite.token)
        return true
    }

    private fun connectFromForm() {
        val host = binding.hostInput.text.toString().trim()
        val pin = binding.pinInput.text.toString().trim()
        if (host.isEmpty() || pin.length != 6) {
            Toast.makeText(this, "请填写电脑 IP 和 6 位验证码", Toast.LENGTH_SHORT).show()
            return
        }
        openSession(host, "17831", pin)
    }

    private fun pasteInvite() {
        val text = ContextCompat.getSystemService(this, android.content.ClipboardManager::class.java)
            ?.primaryClip
            ?.getItemAt(0)
            ?.coerceToText(this)
            ?.toString()
            .orEmpty()
        val invite = InviteParser.parse(text)
        if (invite == null) {
            Toast.makeText(this, "剪贴板里没有邀请链接", Toast.LENGTH_SHORT).show()
            return
        }
        openSession(invite.host, invite.port.toString(), invite.token)
    }

    private fun requestQrScan() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            startQrScan()
        } else {
            cameraPermission.launch(Manifest.permission.CAMERA)
        }
    }

    private fun startQrScan() {
        qrScanner.launch(
            ScanOptions()
                .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                .setPrompt(getString(R.string.scan_prompt))
                .setBeepEnabled(false)
                .setOrientationLocked(true),
        )
    }

    private fun openSession(host: String?, portText: String?, token: String?) {
        val safeHost = host?.trim().orEmpty()
        val tokenValue = token?.trim().orEmpty()
        if (safeHost.isEmpty() || tokenValue.isEmpty()) {
            Toast.makeText(this, "邀请不完整", Toast.LENGTH_SHORT).show()
            return
        }
        val port = portText?.toIntOrNull() ?: 17831
        prefs().edit().putString(KEY_HOST, safeHost).putInt(KEY_PORT, port).apply()
        binding.hostInput.setText(safeHost)
        showWeb("http://$safeHost:$port/?t=${Uri.encode(tokenValue)}")
    }

    private fun showPairing(status: String? = null) {
        binding.webView.visibility = View.GONE
        binding.pairing.visibility = View.VISIBLE
        if (status != null) {
            binding.scanStatus.text = status
        }
        startScan()
    }

    private fun showWeb(url: String) {
        scanner?.stop()
        binding.pairing.visibility = View.GONE
        binding.webView.visibility = View.VISIBLE
        binding.webView.loadUrl(url)
    }

    private fun startScan() {
        scanner?.stop()
        binding.hostList.removeAllViews()
        val next = LanScanner(
            onHost = { host -> runOnUiThread { addHost(host) } },
            onStatus = { text -> runOnUiThread { binding.scanStatus.text = text } },
        )
        scanner = next
        next.start(prefs().getString(KEY_HOST, null))
    }

    private fun addHost(host: FoundHost) {
        val row = ItemHostBinding.inflate(LayoutInflater.from(this), binding.hostList, false)
        row.hostName.text = host.name
        val version = if (host.version.isBlank()) "" else " · v${host.version}"
        row.hostMeta.text = "${host.connectHost}:${host.port}$version"
        row.root.setOnClickListener {
            if (host.token.isNullOrBlank()) {
                binding.hostInput.setText(host.connectHost)
                binding.pinInput.requestFocus()
                Toast.makeText(this, "请输入电脑上的 6 位验证码", Toast.LENGTH_SHORT).show()
            } else {
                openSession(host.connectHost, host.port.toString(), host.token)
            }
        }
        binding.hostList.addView(row.root)
    }

    private fun prefs() = getSharedPreferences("nearbox", MODE_PRIVATE)

    companion object {
        private const val KEY_HOST = "last_host"
        private const val KEY_PORT = "last_port"
    }
}
