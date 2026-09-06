package com.quickerhub.nearbox

import android.net.Uri

data class Invite(val host: String, val port: Int, val token: String)

object InviteParser {
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
            return Invite(host, uri.getQueryParameter("port")?.toIntOrNull() ?: 17831, token)
        }
        if (uri.scheme == "http" || uri.scheme == "https") {
            val host = uri.host?.trim().orEmpty()
            if (host.isEmpty()) {
                return null
            }
            val port = uri.port.takeIf { it > 0 } ?: 17831
            return Invite(host, port, token)
        }
        return null
    }
}
