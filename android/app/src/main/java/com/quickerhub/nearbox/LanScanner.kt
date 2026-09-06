package com.quickerhub.nearbox

import android.content.Context
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.SocketTimeoutException
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

data class FoundHost(
    val name: String,
    val connectHost: String,
    val port: Int,
    val version: String,
    val token: String?,
    val pin: String?,
)

/** One scan of the LAN for Nearbox hosts. Single use: create a new scanner for every scan. */
class LanScanner(
    context: Context,
    private val onHost: (FoundHost) -> Unit,
    private val onStatus: (String) -> Unit,
) {
    private val context = context.applicationContext
    private val io = Executors.newFixedThreadPool(24)
    private val running = AtomicBoolean(false)
    private val seen = ConcurrentHashMap<String, FoundHost>()
    private var udp: DatagramSocket? = null

    fun start(lastHost: String?) {
        if (!running.compareAndSet(false, true)) {
            return
        }
        seen.clear()
        onStatus("正在查找同一网络上的电脑…")
        io.submit { listenUdp() }
        io.submit { scanHttp(lastHost) }
    }

    fun stop() {
        running.set(false)
        try {
            udp?.close()
        } catch (_: Exception) {
        }
        udp = null
        io.shutdownNow()
    }

    private fun listenUdp() {
        try {
            val socket = DatagramSocket(null).apply {
                reuseAddress = true
                soTimeout = 1500
                bind(InetSocketAddress(DISCOVERY_PORT))
            }
            udp = socket
            val buf = ByteArray(2048)
            while (running.get()) {
                try {
                    val packet = DatagramPacket(buf, buf.size)
                    socket.receive(packet)
                    val text = String(packet.data, packet.offset, packet.length, Charsets.UTF_8)
                    val source = packet.address.hostAddress ?: continue
                    parseHost(text, source, HTTP_PORT)?.let(::publish)
                } catch (_: SocketTimeoutException) {
                    /* keep listening */
                } catch (_: Exception) {
                    if (running.get()) {
                        break
                    }
                }
            }
        } catch (_: Exception) {
            /* emulator / some networks cannot bind the broadcast port */
        }
    }

    private fun scanHttp(lastHost: String?) {
        val mine = Lan.localAddresses(context)
        val targets = LinkedHashSet<String>()
        if (!lastHost.isNullOrBlank()) {
            targets.add(lastHost)
        }
        targets.add("10.0.2.2")
        for (address in mine) {
            val parts = address.hostAddress?.split(".") ?: continue
            if (parts.size != 4) {
                continue
            }
            val prefix = "${parts[0]}.${parts[1]}.${parts[2]}"
            for (tail in 1..254) {
                targets.add("$prefix.$tail")
            }
        }
        val pending = AtomicInteger(targets.size)
        onStatus("正在扫描局域网（${targets.size} 个地址）…")
        for (host in targets) {
            if (!running.get()) {
                return
            }
            // The PC we used last time is by far the likeliest hit; give it room when the sweep floods the network.
            val timeout = if (host == lastHost) LAST_HOST_TIMEOUT_MS else SWEEP_TIMEOUT_MS
            try {
                io.submit {
                    try {
                        probe(host, HTTP_PORT, timeout)?.let(::publish)
                    } finally {
                        if (pending.decrementAndGet() <= 0 && running.get()) {
                            if (seen.isEmpty()) {
                                onStatus(nothingFound(mine.mapNotNull { it.hostAddress }))
                            } else {
                                onStatus("找到 ${seen.size} 台电脑，点一下即可配对")
                            }
                        }
                    }
                }
            } catch (_: Exception) {
                /* stopped while queueing */
                return
            }
        }
    }

    private fun nothingFound(mine: List<String>): String {
        val where = if (mine.isEmpty()) "" else "（手机 IP ${mine.joinToString(" / ")}）"
        return "没有找到电脑$where。请确认电脑上的 Nearbox 已打开，并且手机和电脑连的是同一个 Wi-Fi；也可以扫码连接。"
    }

    private fun publish(host: FoundHost) {
        val key = "${host.connectHost}:${host.port}"
        if (seen.put(key, host) == null) {
            onHost(host)
            onStatus("找到 ${seen.size} 台电脑，点一下即可配对")
        }
    }

    companion object {
        const val HTTP_PORT = 17831
        const val DISCOVERY_PORT = 17832
        private const val SWEEP_TIMEOUT_MS = 350
        private const val LAST_HOST_TIMEOUT_MS = 1500

        /** Asks one address whether a Nearbox host answers there. Blocking; call it off the main thread. */
        fun probe(host: String, port: Int, timeoutMs: Int): FoundHost? {
            val conn = try {
                (URL("http://$host:$port/api/discover").openConnection() as HttpURLConnection).apply {
                    connectTimeout = timeoutMs
                    readTimeout = timeoutMs
                    requestMethod = "GET"
                    useCaches = false
                }
            } catch (_: Exception) {
                return null
            }
            return try {
                if (conn.responseCode != 200) {
                    null
                } else {
                    parseHost(conn.inputStream.bufferedReader(Charsets.UTF_8).readText(), host, port)
                }
            } catch (_: Exception) {
                null
            } finally {
                conn.disconnect()
            }
        }

        private fun parseHost(raw: String, connectHost: String, fallbackPort: Int): FoundHost? {
            val info = try {
                JSONObject(raw)
            } catch (_: Exception) {
                return null
            }
            if (info.optString("service") != "nearbox") {
                return null
            }
            return FoundHost(
                name = info.optString("name").ifBlank { connectHost },
                connectHost = connectHost,
                port = info.optInt("port", fallbackPort),
                version = info.optString("version", ""),
                token = info.optString("token").ifBlank { info.optString("pin") }.ifBlank { null },
                pin = info.optString("pin").ifBlank { null },
            )
        }
    }
}
