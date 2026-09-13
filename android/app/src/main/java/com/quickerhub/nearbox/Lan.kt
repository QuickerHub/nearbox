package com.quickerhub.nearbox

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import java.net.Inet4Address
import java.net.NetworkInterface

enum class LanState {
    /** Wi-Fi, Ethernet, or this phone's own hotspot: the PC can be on the same network. */
    LAN,
    /** Mobile data only — the most common reason pairing silently fails. */
    MOBILE_DATA,
    /** Airplane mode, Wi-Fi off, or some transport we cannot classify. */
    NO_WIFI,
}

object Lan {
    fun state(context: Context): LanState {
        val networks = Networks.of(context)
        return when {
            networks.hasLanTransport -> LanState.LAN
            // A phone acting as hotspot (or USB-tethered to the PC) has no Wi-Fi network of its own,
            // but the tethering interface still carries a private address the PC can reach.
            localAddresses(networks).isNotEmpty() -> LanState.LAN
            networks.hasCellular -> LanState.MOBILE_DATA
            else -> LanState.NO_WIFI
        }
    }

    /** This phone's private IPv4 addresses on interfaces that can carry a LAN. Mobile data and VPN tunnels are skipped. */
    fun localAddresses(context: Context): List<Inet4Address> = localAddresses(Networks.of(context))


    /**
     * Hosts the shell may open from a QR / paste / typed IP. Public IPv4 would
     * send the pairing token off the LAN. RFC1918, CGNAT (100.64/10), loopback,
     * `.local` / `.lan` and single-label names stay allowed.
     */
    fun isPairableHost(host: String): Boolean {
        val value = host.trim().lowercase()
        if (value.isEmpty() || value.length > 253) {
            return false
        }
        val parts = value.split(".")
        if (parts.size == 4 && parts.all { part -> part.toIntOrNull()?.let { n -> n in 0..255 } == true }) {
            val a = parts[0].toInt()
            val b = parts[1].toInt()
            return a == 10 ||
                a == 127 ||
                (a == 192 && b == 168) ||
                (a == 172 && b in 16..31) ||
                (a == 100 && b in 64..127)
        }
        if (value.contains(':')) {
            return value == "::1"
        }
        return !value.contains('.') || value.endsWith(".local") || value.endsWith(".lan")
    }


    private fun localAddresses(networks: Networks): List<Inet4Address> {
        val result = ArrayList<Inet4Address>()
        val interfaces = try {
            NetworkInterface.getNetworkInterfaces()
        } catch (_: Exception) {
            null
        } ?: return result
        for (nic in interfaces) {
            try {
                if (nic.isLoopback || !nic.isUp || nic.name in networks.nonLanInterfaces) {
                    continue
                }
                for (address in nic.inetAddresses) {
                    if (address is Inet4Address && address.isSiteLocalAddress) {
                        result.add(address)
                    }
                }
            } catch (_: Exception) {
                /* interface vanished while we were looking */
            }
        }
        return result
    }

    /** What the system knows about the networks that are up right now. */
    private class Networks(
        val hasLanTransport: Boolean,
        val hasCellular: Boolean,
        /** Interfaces used by mobile data / VPN; an address on them does not mean a LAN. */
        val nonLanInterfaces: Set<String>,
    ) {
        companion object {
            fun of(context: Context): Networks {
                val manager = context.getSystemService(ConnectivityManager::class.java)
                    ?: return Networks(hasLanTransport = false, hasCellular = false, nonLanInterfaces = emptySet())
                var lan = false
                var cellular = false
                val nonLan = HashSet<String>()
                for (network in allNetworks(manager)) {
                    val caps = try {
                        manager.getNetworkCapabilities(network)
                    } catch (_: Exception) {
                        null
                    } ?: continue
                    if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                        caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
                    ) {
                        lan = true
                        continue
                    }
                    if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) {
                        cellular = true
                    }
                    try {
                        manager.getLinkProperties(network)?.interfaceName?.let(nonLan::add)
                    } catch (_: Exception) {
                        /* network went away */
                    }
                }
                return Networks(lan, cellular, nonLan)
            }

            // Deprecated in favour of network callbacks, but still the only synchronous way to see every
            // network — including a Wi-Fi without internet that Android has demoted below mobile data.
            @Suppress("DEPRECATION")
            private fun allNetworks(manager: ConnectivityManager): List<Network> {
                return try {
                    manager.allNetworks.toList()
                } catch (_: Exception) {
                    listOfNotNull(manager.activeNetwork)
                }
            }
        }
    }
}
