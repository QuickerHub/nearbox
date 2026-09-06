package com.quickerhub.nearbox

import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.SocketTimeoutException
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.Future
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

class LanScanner(
    private val onHost: (FoundHost) -> Unit,
    private val onStatus: (String) -> Unit,
) {
    private val io = Executors.newFixedThreadPool(24)
    private val running = AtomicBoolean(false)
    private val seen = ConcurrentHashMap<String, FoundHost>()
    private var udp: DatagramSocket? = null
    private var jobs: List<Future<*>> = emptyList()

    fun start(lastHost: String?) {
        if (!running.compareAndSet(false, true)) {
            return
        }
        seen.clear()
        onStatus("正在查找同一网络上的电脑…")
        jobs = listOf(
            io.submit { listenUdp() },
            io.submit { scanHttp(lastHost) },
        )
    }

    fun stop() {
        running.set(false)
        try {
            udp?.close()
        } catch (_: Exception) {
        }
        udp = null
        jobs.forEach { it.cancel(true) }
        jobs = emptyList()
    }

    fun refresh(lastHost: String?) {
        stop()
        start(lastHost)
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
                    accept(text, source)
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
        val targets = LinkedHashSet<String>()
        if (!lastHost.isNullOrBlank()) {
            targets.add(lastHost)
        }
        targets.add("10.0.2.2")
        targets.addAll(localSubnetHosts())
        val pending = AtomicInteger(targets.size)
        onStatus("正在扫描局域网（${targets.size} 个地址）…")
        for (host in targets) {
            if (!running.get()) {
                return
            }
            io.submit {
                try {
                    probeHttp(host)
                } finally {
                    if (pending.decrementAndGet() <= 0 && running.get()) {
                        if (seen.isEmpty()) {
                            onStatus("没有找到电脑。确认 Nearbox 已打开，或改用扫码。")
                        } else {
                            onStatus("找到 ${seen.size} 台电脑，点一下即可配对")
                        }
                    }
                }
            }
        }
    }

    private fun probeHttp(host: String) {
        val url = URL("http://$host:$HTTP_PORT/api/discover")
        val conn = (url.openConnection() as HttpURLConnection).apply {
            connectTimeout = 350
            readTimeout = 350
            requestMethod = "GET"
            useCaches = false
        }
        try {
            if (conn.responseCode != 200) {
                return
            }
            accept(conn.inputStream.bufferedReader(Charsets.UTF_8).readText(), host)
        } catch (_: Exception) {
            /* not a Nearbox host */
        } finally {
            conn.disconnect()
        }
    }

    private fun accept(raw: String, connectHost: String) {
        val info = parseDiscover(raw) ?: return
        val host = FoundHost(
            name = info.optString("name", connectHost),
            connectHost = connectHost,
            port = info.optInt("port", HTTP_PORT),
            version = info.optString("version", ""),
            token = info.optString("token").ifBlank { info.optString("pin") }.ifBlank { null },
            pin = info.optString("pin").ifBlank { null },
        )
        val key = "${host.connectHost}:${host.port}"
        if (seen.put(key, host) == null) {
            onHost(host)
            onStatus("找到 ${seen.size} 台电脑，点一下即可配对")
        }
    }

    private fun parseDiscover(raw: String): JSONObject? {
        return try {
            val obj = JSONObject(raw)
            if (obj.optString("service") != "nearbox") null else obj
        } catch (_: Exception) {
            null
        }
    }

    private fun localSubnetHosts(): List<String> {
        val hosts = ArrayList<String>()
        val interfaces = NetworkInterface.getNetworkInterfaces() ?: return hosts
        for (nic in interfaces) {
            if (!nic.isUp || nic.isLoopback) {
                continue
            }
            for (address in nic.inetAddresses) {
                if (address !is Inet4Address || address.isLoopbackAddress) {
                    continue
                }
                val parts = address.hostAddress?.split(".") ?: continue
                if (parts.size != 4) {
                    continue
                }
                val prefix = "${parts[0]}.${parts[1]}.${parts[2]}"
                if (!isPrivatePrefix(parts[0].toInt(), parts[1].toInt())) {
                    continue
                }
                for (tail in 1..254) {
                    hosts.add("$prefix.$tail")
                }
            }
        }
        return hosts.distinct()
    }

    private fun isPrivatePrefix(a: Int, b: Int): Boolean {
        return a == 10 || (a == 172 && b in 16..31) || (a == 192 && b == 168)
    }

    companion object {
        const val HTTP_PORT = 17831
        const val DISCOVERY_PORT = 17832
    }
}
