/**
 * ssh argv builder. Runtime-import free of `@shared` so `node --test` can
 * pin that a dash-prefixed host cannot become an extra OpenSSH option.
 */

export type SshArgTarget = {
  host: string;
  user?: string;
  port?: number;
  identityFile?: string;
};

const CONNECT_TIMEOUT_S = 12;

/**
 * Host / alias we pass as the ssh destination. A leading dash would be parsed
 * as another option (`-R…`, `-D…`, `-J…`) if it sat where `destination` goes.
 */
export function isSshDestination(host: string): boolean {
  return Boolean(host) && !host.startsWith("-") && /^[A-Za-z0-9._:%-]+$/.test(host);
}

/** Identity file path: no leading dash (would look like an option) and no control chars. */
export function isSshIdentityFile(path: string): boolean {
  return Boolean(path) && !path.startsWith("-") && !/[\r\n\u0000]/.test(path);
}

export function sshArgs(target: SshArgTarget, command: string): string[] {
  const args = [
    "-T",
    "-o",
    "BatchMode=yes",
    "-o",
    `ConnectTimeout=${CONNECT_TIMEOUT_S}`,
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=4",
    "-o",
    "LogLevel=ERROR",
  ];
  if (target.port) {
    args.push("-p", String(target.port));
  }
  if (target.identityFile) {
    args.push("-i", target.identityFile);
  }
  if (target.user) {
    args.push("-l", target.user);
  }
  // `--` so a stored host that starts with `-` cannot become `-R` / `-D` / `-J`.
  args.push("--", target.host, command);
  return args;
}
