package com.quickerhub.nearbox

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
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
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity() {
    private data class Target(val host: String, val port: Int, val token: String?) {
        val url: String
            get() = if (token.isNullOrBlank()) "http://$host:$port/" else "http://$host:$port/?t=${Uri.encode(token)}"
    }

    private lateinit var binding: ActivityMainBinding
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var scanner: LanScanner? = null
    private val io = Executors.newSingleThreadExecutor()

    /** Bumped whenever the screen changes what it is doing, so results of an earlier scan / probe / page load are dropped. */
    private var attempt = 0

    /** The WebView is loading behind the pairing screen and gets revealed once the page has rendered. */
    private var loading = false

    /** Where we last tried to connect; retried automatically when Wi-Fi comes back. */
    private var lastTarget: Target? = null

    /** Whether the phone was on a LAN the last time we looked; a false→true flip triggers a retry. */
    private var lanAvailable = false
    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            runOnUiThread { onLanChanged() }
        }

        override fun onLost(network: Network) {
            runOnUiThread {
                onLanChanged()
                // The interface keeps its address for a moment after the network is gone; look again shortly.
                binding.root.postDelayed({ onLanChanged() }, 1500)
            }
        }
    }

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
        binding.refreshButton.setOnClickListener { startScan() }
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

            override fun onPageFinished(view: WebView, url: String) {
                if (loading) {
                    // Each session starts with a fresh loadUrl; drop the earlier ones so Back leads to the
                    // pairing screen instead of replaying an old address.
                    view.clearHistory()
                    revealWeb()
                }
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (!request.isForMainFrame) {
                    return
                }
                val host = lastTarget?.host ?: request.url.host.orEmpty()
                showPairing("连不上电脑 $host，正在重新查找…")
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

        if (!handleIntent(intent) && !reopenLastHost()) {
            showPairing()
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    override fun onStart() {
        super.onStart()
        val state = Lan.state(this)
        lanAvailable = state == LanState.LAN
        refreshNetworkHint(state)
        val request = NetworkRequest.Builder()
            .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
            .addTransportType(NetworkCapabilities.TRANSPORT_ETHERNET)
            .build()
        runCatching { connectivity()?.registerNetworkCallback(request, networkCallback) }
    }

    override fun onStop() {
        runCatching { connectivity()?.unregisterNetworkCallback(networkCallback) }
        super.onStop()
    }

    override fun onDestroy() {
        scanner?.stop()
        io.shutdownNow()
        super.onDestroy()
    }

    override fun onBackPressed() {
        if (loading) {
            lastTarget = null
            showPairing()
            return
        }
        if (binding.webView.visibility == View.VISIBLE && binding.webView.canGoBack()) {
            binding.webView.goBack()
            return
        }
        if (binding.webView.visibility == View.VISIBLE) {
            lastTarget = null
            showPairing()
            return
        }
        super.onBackPressed()
    }

    // ------------------------------------------------------------------ where to connect

    private fun reopenLastHost(): Boolean {
        val host = prefs().getString(KEY_HOST, "").orEmpty()
        if (host.isBlank()) {
            return false
        }
        tryOpen(Target(host, prefs().getInt(KEY_PORT, LanScanner.HTTP_PORT), null))
        return true
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
        openSession(host, LanScanner.HTTP_PORT.toString(), pin)
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
        binding.hostInput.setText(safeHost)
        tryOpen(Target(safeHost, portText?.toIntOrNull() ?: LanScanner.HTTP_PORT, tokenValue))
    }

    // ------------------------------------------------------------------ connecting

    /**
     * Checks that a Nearbox host really answers at [target] before handing the address to the WebView.
     * A WebView pointed at an unreachable LAN address sits on a black page until the system's own
     * connect timeout fires — that is what happens when the phone is not on Wi-Fi.
     */
    private fun tryOpen(target: Target) {
        lastTarget = target
        val myAttempt = ++attempt
        stopScan()
        hideWeb()
        binding.pairing.visibility = View.VISIBLE
        setConnectStatus("正在连接 ${target.host}…")
        refreshNetworkHint()
        io.execute {
            val found = LanScanner.probe(target.host, target.port, PROBE_TIMEOUT_MS)
            runOnUiThread {
                if (attempt != myAttempt) {
                    return@runOnUiThread
                }
                if (found == null) {
                    showPairing("连不上电脑 ${target.host}，正在重新查找…")
                } else {
                    prefs().edit().putString(KEY_HOST, target.host).putInt(KEY_PORT, target.port).apply()
                    setConnectStatus("找到「${found.name}」，正在打开…")
                    showWeb(target.url)
                }
            }
        }
    }

    private fun showWeb(url: String) {
        stopScan()
        loading = true
        val myAttempt = attempt
        binding.webView.visibility = View.INVISIBLE
        binding.webView.loadUrl(url)
        // Reveal even if the page never reports finishing, so a slow script cannot keep us on this screen.
        binding.root.postDelayed({
            if (loading && attempt == myAttempt) {
                revealWeb()
            }
        }, REVEAL_FALLBACK_MS)
    }

    private fun revealWeb() {
        loading = false
        binding.pairing.visibility = View.GONE
        binding.webView.visibility = View.VISIBLE
    }

    private fun hideWeb() {
        if (loading) {
            loading = false
            binding.webView.stopLoading()
        }
        binding.webView.visibility = View.GONE
    }

    private fun showPairing(message: String? = null) {
        hideWeb()
        binding.pairing.visibility = View.VISIBLE
        setConnectStatus(message)
        startScan()
    }

    // ------------------------------------------------------------------ scanning

    private fun startScan() {
        stopScan()
        val myAttempt = ++attempt
        refreshNetworkHint()
        val next = LanScanner(
            this,
            onHost = { host -> runOnUiThread { if (attempt == myAttempt) addHost(host) } },
            onStatus = { text -> runOnUiThread { if (attempt == myAttempt) setScanStatus(text) } },
        )
        scanner = next
        next.start(prefs().getString(KEY_HOST, null))
    }

    private fun stopScan() {
        scanner?.stop()
        scanner = null
        binding.hostList.removeAllViews()
        setScanStatus(null)
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

    // ------------------------------------------------------------------ network state

    private fun connectivity() = getSystemService(ConnectivityManager::class.java)

    private fun refreshNetworkHint(state: LanState = Lan.state(this)) {
        val hint = when (state) {
            LanState.LAN -> null
            LanState.MOBILE_DATA -> getString(R.string.hint_mobile_data)
            LanState.NO_WIFI -> getString(R.string.hint_no_wifi)
        }
        binding.networkHint.text = hint
        binding.networkHint.visibility = if (hint == null) View.GONE else View.VISIBLE
    }

    private fun onLanChanged() {
        if (isFinishing || isDestroyed) {
            return
        }
        val state = Lan.state(this)
        val now = state == LanState.LAN
        refreshNetworkHint(state)
        if (now && !lanAvailable && binding.pairing.visibility == View.VISIBLE && !loading) {
            // Wi-Fi just came back while we were stuck on the pairing screen: pick up where we left off.
            val target = lastTarget
            if (target != null) {
                tryOpen(target)
            } else {
                startScan()
            }
        }
        lanAvailable = now
    }

    // ------------------------------------------------------------------ helpers

    private fun setConnectStatus(text: String?) {
        binding.connectStatus.text = text.orEmpty()
        binding.connectStatus.visibility = if (text.isNullOrBlank()) View.GONE else View.VISIBLE
    }

    private fun setScanStatus(text: String?) {
        binding.scanStatus.text = text.orEmpty()
        binding.scanStatus.visibility = if (text.isNullOrBlank()) View.GONE else View.VISIBLE
    }

    private fun prefs() = getSharedPreferences("nearbox", MODE_PRIVATE)

    companion object {
        private const val KEY_HOST = "last_host"
        private const val KEY_PORT = "last_port"

        /** LAN hosts answer /api/discover within a few hundred ms; anything slower is as good as unreachable. */
        private const val PROBE_TIMEOUT_MS = 2000
        private const val REVEAL_FALLBACK_MS = 8000L
    }
}
