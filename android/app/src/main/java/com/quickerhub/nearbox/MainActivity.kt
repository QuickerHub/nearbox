package com.quickerhub.nearbox

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
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
import com.quickerhub.nearbox.databinding.ActivityMainBinding

class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private val filePicker = registerForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        fileCallback?.onReceiveValue(uris.toTypedArray())
        fileCallback = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.hostInput.setText(prefs().getString(KEY_HOST, ""))
        binding.connectButton.setOnClickListener { connectFromForm() }
        binding.pasteButton.setOnClickListener { pasteInvite() }

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
                binding.webView.visibility = View.GONE
                binding.pairing.visibility = View.VISIBLE
                Toast.makeText(this@MainActivity, "连不上电脑，请确认电脑端已打开并在同一 Wi-Fi", Toast.LENGTH_LONG).show()
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
            reopenLastHost()
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    /**
     * The web app remembers its paired session in WebView storage, so a plain launch can go
     * straight back to the last PC without a token. If that session is gone, the page itself
     * shows the PIN screen.
     */
    private fun reopenLastHost() {
        val host = prefs().getString(KEY_HOST, "").orEmpty()
        if (host.isBlank()) {
            return
        }
        val port = prefs().getInt(KEY_PORT, 17831)
        showWeb("http://$host:$port/")
    }

    override fun onBackPressed() {
        if (binding.webView.visibility == View.VISIBLE && binding.webView.canGoBack()) {
            binding.webView.goBack()
            return
        }
        super.onBackPressed()
    }

    private fun handleIntent(intent: Intent?): Boolean {
        val uri = intent?.data ?: return false
        if (uri.scheme == "nearbox" && uri.host == "connect") {
            openSession(uri.getQueryParameter("host"), uri.getQueryParameter("port"), uri.getQueryParameter("t"))
            return true
        }
        if (uri.scheme == "http" || uri.scheme == "https") {
            openSession(uri.host, uri.port.takeIf { it > 0 }?.toString(), uri.getQueryParameter("t") ?: uri.getQueryParameter("pin"))
            return true
        }
        return false
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
        val text = androidx.core.content.ContextCompat.getSystemService(
            this,
            android.content.ClipboardManager::class.java,
        )?.primaryClip?.getItemAt(0)?.coerceToText(this)?.toString().orEmpty()
        val uri = runCatching { Uri.parse(text.trim()) }.getOrNull()
        if (uri?.host.isNullOrBlank()) {
            Toast.makeText(this, "剪贴板里没有邀请链接", Toast.LENGTH_SHORT).show()
            return
        }
        openSession(uri.host, uri.port.takeIf { it > 0 }?.toString(), uri.getQueryParameter("t") ?: uri.getQueryParameter("pin"))
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

    private fun showWeb(url: String) {
        binding.pairing.visibility = View.GONE
        binding.webView.visibility = View.VISIBLE
        binding.webView.loadUrl(url)
    }

    private fun prefs() = getSharedPreferences("nearbox", MODE_PRIVATE)

    companion object {
        private const val KEY_HOST = "last_host"
        private const val KEY_PORT = "last_port"
    }
}
