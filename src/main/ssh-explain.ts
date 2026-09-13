/**
 * Pure SSH user-facing strings and path guards. Kept free of `@shared` so
 * `node --test` can pin the Chinese copy without Electron path aliases.
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
  if (/Permission denied|Too many authentication failures|No supported authentication/i.test(text)) {
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

/** Login name for `ssh -l`: no leading dash (option-like) and no whitespace / controls. */
export function isSshUser(user: string): boolean {
  return Boolean(user) && !user.startsWith("-") && !/[\r\n\u0000\s]/.test(user) && user.length <= 128;
}

/** Drop a hostile/broken probe user; reject a home path that would break later ssh helpers. */
export function adoptProbeIdentity(user: unknown, home: unknown): { user: string; home: string } {
  const homeText = String(home ?? "");
  if (homeText && /[\r\n\u0000]/.test(homeText)) {
    throw new Error("路径不合法。");
  }
  const userText = String(user ?? "");
  return { user: isSshUser(userText) ? userText : "", home: homeText };
}
