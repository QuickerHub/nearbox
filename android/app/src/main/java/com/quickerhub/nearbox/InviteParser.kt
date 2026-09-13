package com.quickerhub.nearbox

import android.net.Uri

data class Invite(val host: String, val port: Int, val token: String)

object InviteParser {
    private const val DEFAULT_PORT = 17831

    fun parse(text: String?): Invite? {
        val raw = text?.trim().orEmpty()
        if (raw.isEmpty()) {
            return null
        }
        val uri = runCatching { Uri.parse(raw) }.getOrNull() ?: return null
        val token = uri.getQueryParameter("t")
            ?: uri.getQueryParameter("token")
            ?: uri.getQueryParameter("pin")
            ?: return null
        if (token.isBlank()) {
            return null
        }
        if (uri.scheme == "nearbox" && uri.host == "connect") {
            val host = uri.getQueryParameter("host")?.trim().orEmpty()
            if (host.isEmpty()) {
                return null
            }
            val port = uri.getQueryParameter("port")?.toIntOrNull() ?: DEFAULT_PORT
            if (!isValidPort(port)) {
                return null
            }
            return Invite(host, port, token)
        }
        if (uri.scheme == "http" || uri.scheme == "https") {
            val host = uri.host?.trim().orEmpty()
            if (host.isEmpty()) {
                return null
            }
            val port = uri.port.takeIf { it > 0 } ?: DEFAULT_PORT
            if (!isValidPort(port)) {
                return null
            }
            return Invite(host, port, token)
        }
        return null
    }

    /** Same 1–65535 rule as shared parseInviteText / parseDiscover. */
    private fun isValidPort(port: Int): Boolean = port in 1..65535
}
