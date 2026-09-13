/**
 * Pure SSH user-facing strings, path guards, and probe JSON extraction. Kept
 * free of `@shared` so `node --test` can pin the Chinese copy without Electron
 * path aliases.
 */

export type SshExplainTarget = {
  host: string;
  user?: string;
  port?: number;
};

export function describeTarget(target: SshExplainTarget): string {
  const hostPort = target.port ? `${target.host}:${target.port}` : target.host;
  return target.user ? `${target.user}@${hostPort}` : hostPort;
}

/** Turn ssh's stderr into one sentence the user can act on. */
export function explainSshFailure(target: SshExplainTarget, stderr: string): string {
  const text = stderr.trim();
  const line = text.split(/\r?\n/).find((item) => item.trim() && !item.startsWith("Warning:")) ?? text;
  const where = describeTarget(target);
  if (
    /Permission denied|Too many authentication failures|No supported authentication|Authentication failed|Unable to authenticate/i.test(
      text,
    )
  ) {
    return `SSH 免密登录 ${where} 失败（${line}）。请先配置公钥登录，让本机在终端里执行 ssh ${target.host} 时不需要输入密码。`;
  }
  if (/Could not resolve hostname|Name or service not known|getaddrinfo/i.test(text)) {
    return `找不到主机 ${target.host}，请检查地址或 ~/.ssh/config 里的别名。`;
  }
  if (/Connection timed out|Connection refused|No route to host|Network is unreachable|Operation timed out|Host is down/i.test(text)) {
    return `连不上 ${where}（${line}）。请确认那台电脑已开机、和本机在同一网络，并已开启 OpenSSH 服务器。`;
  }
  if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(text)) {
    return `${where} 的主机密钥和以前不一样，ssh 拒绝连接。确认是同一台电脑后，删除 ~/.ssh/known_hosts 里的旧记录再试。`;
  }
  if (/kex_exchange_identification|banner exchange|protocol mismatch/i.test(text)) {
    return `${where} 的 SSH 握手失败（${line}）。请确认对端开的是 OpenSSH 服务，且端口没有被其他程序占用。`;
  }
  if (/Connection reset by peer|Connection closed by|Broken pipe|ECONNRESET/i.test(text)) {
    return `和 ${where} 的连接被中断（${line}）。请确认那台电脑没有休眠或重启，再试一次。`;
  }
  return line ? `连接 ${where} 失败：${line}` : `连接 ${where} 失败。`;
}

/** Reject anything that could not be a single path: control chars break every shell we talk to. */
export function assertSafeRemotePath(path: string): void {
  if (!path.trim() || /[\r\n\u0000]/.test(path)) {
    throw new Error("路径不合法。");
  }
}

/**
 * Pull the `{ nearbox: 1, ... }` object out of probe / list stdout. Tolerates
 * leading logs, trailing chatter on the same line, and multi-line JSON.
 */
export function extractNearboxJson(stdout: string): Record<string, unknown> | null {
  let from = 0;
  while (from < stdout.length) {
    const start = stdout.indexOf("{", from);
    if (start === -1) {
      return null;
    }
    const parsed = parseJsonObjectAt(stdout, start);
    if (parsed && typeof parsed === "object" && (parsed as Record<string, unknown>).nearbox === 1) {
      return parsed as Record<string, unknown>;
    }
    from = start + 1;
  }
  return null;
}

function parseJsonObjectAt(text: string, start: number): unknown | undefined {
  try {
    return JSON.parse(text.slice(start));
  } catch {
    // fall through: false `{` in a log line, or trailing chatter after the object
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}
