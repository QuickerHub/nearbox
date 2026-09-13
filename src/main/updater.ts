import { createWriteStream, existsSync } from "node:fs";
import { mkdir, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { AppUpdateStatus } from "@shared/protocol";
import { isNewerVersion, stripTagPrefix } from "../shared/version.ts";

export const DEFAULT_RELEASE_REPO = "QuickerHub/nearbox";
const STALE_MS = 60 * 60 * 1000;
const RELEASES_PAGE = "https://github.com/QuickerHub/nearbox/releases/latest";

export interface GithubReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface GithubRelease {
  tag_name?: string;
  html_url?: string;
  body?: string;
  assets?: GithubReleaseAsset[];
}

export interface AppUpdaterOptions {
  currentVersion: string;
  packaged: boolean;
  cacheDir: string;
  repo?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  onLaunchInstaller(filePath: string): void;
}

export function pickReleaseAssets(assets: GithubReleaseAsset[] | undefined): { exeUrl: string | null; apkUrl: string | null } {
  const list = assets ?? [];
  const exe = list.find((item) => /\.exe$/i.test(item.name) && /win/i.test(item.name)) ?? list.find((item) => /\.exe$/i.test(item.name));
  const apk = list.find((item) => /\.apk$/i.test(item.name));
  return { exeUrl: exe?.browser_download_url ?? null, apkUrl: apk?.browser_download_url ?? null };
}

export function statusFromRelease(release: GithubRelease, current: string, packaged: boolean): Pick<
  AppUpdateStatus,
  "current" | "latest" | "newer" | "notes" | "htmlUrl" | "exeUrl" | "apkUrl" | "packaged"
> {
  const latest = release.tag_name ? stripTagPrefix(release.tag_name) : null;
  const assets = pickReleaseAssets(release.assets);
  return {
    current,
    latest,
    newer: latest ? isNewerVersion(latest, current) : false,
    notes: (release.body ?? "").trim().slice(0, 400),
    htmlUrl: release.html_url ?? RELEASES_PAGE,
    exeUrl: assets.exeUrl,
    apkUrl: assets.apkUrl,
    packaged,
  };
}

export function emptyUpdateStatus(current: string, packaged: boolean): AppUpdateStatus {
  return {
    current,
    latest: null,
    newer: false,
    notes: "",
    htmlUrl: RELEASES_PAGE,
    exeUrl: null,
    apkUrl: null,
    packaged,
    checking: false,
    downloading: false,
    progress: 0,
  };
}

/**
 * Looks up the latest GitHub Release and can download the Windows installer.
 * The phone UI is served by this PC, so updating the desktop updates the phone
 * page; the Android shell then installs the APK this PC already has.
 */
export class AppUpdater {
  private readonly options: AppUpdaterOptions;
  private readonly fetchImpl: typeof fetch;
  private snapshot = emptyUpdateStatus("", false);
  private readyFile: string | null = null;
  private readyVersion: string | null = null;
  private inflight: Promise<AppUpdateStatus> | null = null;
  private installJob: Promise<void> | null = null;

  constructor(options: AppUpdaterOptions) {
    this.options = options;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.snapshot = emptyUpdateStatus(options.currentVersion, options.packaged);
  }

  status(): AppUpdateStatus {
    return { ...this.snapshot };
  }

  async check(force = false): Promise<AppUpdateStatus> {
    if (this.inflight) {
      return this.inflight;
    }
    const checkedAt = this.snapshot.checkedAt ? Date.parse(this.snapshot.checkedAt) : 0;
    const now = (this.options.now ?? Date.now)();
    if (!force && checkedAt && now - checkedAt < STALE_MS && !this.snapshot.error) {
      return this.status();
    }
    this.snapshot = { ...this.snapshot, checking: true, error: undefined };
    this.inflight = this.refresh()
      .catch((error: unknown) => {
        this.snapshot = {
          ...this.snapshot,
          checking: false,
          error: error instanceof Error ? error.message : String(error),
          checkedAt: new Date((this.options.now ?? Date.now)()).toISOString(),
        };
        return this.status();
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  /** Download the Windows installer (if needed) and hand it to the host to launch. */
  startInstall(): AppUpdateStatus {
    if (this.installJob) {
      return this.status();
    }
    this.installJob = this.install()
      .catch((error: unknown) => {
        this.snapshot = {
          ...this.snapshot,
          downloading: false,
          error: error instanceof Error ? error.message : String(error),
        };
      })
      .finally(() => {
        this.installJob = null;
      });
    return this.status();
  }

  private async refresh(): Promise<AppUpdateStatus> {
    const repo = this.options.repo ?? DEFAULT_RELEASE_REPO;
    const response = await this.fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "Nearbox",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (response.status === 403) {
      throw new Error("GitHub 查询次数用完了，过一会儿再试。");
    }
    if (!response.ok) {
      throw new Error(`无法检查更新（${response.status}）`);
    }
    const release = (await response.json()) as GithubRelease;
    this.snapshot = {
      ...statusFromRelease(release, this.options.currentVersion, this.options.packaged),
      checking: false,
      downloading: false,
      progress: this.readyVersion && this.readyVersion === stripTagPrefix(release.tag_name ?? "") ? 1 : 0,
      checkedAt: new Date((this.options.now ?? Date.now)()).toISOString(),
    };
    return this.status();
  }

  private async install(): Promise<void> {
    const status = this.snapshot.latest ? this.snapshot : await this.check(true);
    if (!status.newer) {
      throw new Error("已经是最新版本。");
    }
    if (!status.exeUrl) {
      throw new Error("这个版本没有 Windows 安装包。");
    }
    if (!this.options.packaged) {
      throw new Error("开发中的版本请先安装正式包，之后就可以在设置里更新。");
    }
    const file = await this.download(status.latest!, status.exeUrl);
    this.options.onLaunchInstaller(file);
  }

  private async download(version: string, url: string): Promise<string> {
    if (this.readyFile && this.readyVersion === version && existsSync(this.readyFile)) {
      return this.readyFile;
    }
    await mkdir(this.options.cacheDir, { recursive: true });
    const dest = installerPath(this.options.cacheDir, version);
    const partial = `${dest}.partial`;
    this.snapshot = { ...this.snapshot, downloading: true, progress: 0, error: undefined };
    const response = await this.fetchImpl(url, { headers: { "User-Agent": "Nearbox" }, redirect: "follow" });
    if (!response.ok || !response.body) {
      throw new Error(`下载失败（${response.status}）`);
    }
    const total = Number(response.headers.get("content-length") ?? 0);
    const reader = response.body.getReader();
    const file = createWriteStream(partial);
    try {
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        received += value.byteLength;
        await new Promise<void>((resolve, reject) => {
          file.write(value, (error) => (error ? reject(error) : resolve()));
        });
        this.snapshot = {
          ...this.snapshot,
          downloading: true,
          progress: total > 0 ? Math.min(1, received / total) : 0,
        };
      }
      await new Promise<void>((resolve, reject) => file.end((error: NodeJS.ErrnoException | null | undefined) => (error ? reject(error) : resolve())));
      // A premature close would otherwise leave a truncated .exe marked ready.
      if (total > 0 && received !== total) {
        throw new Error(`下载不完整（${received}/${total}）`);
      }
      if (received === 0) {
        throw new Error("下载失败（空文件）");
      }
      await unlink(dest).catch(() => undefined);
      await rename(partial, dest);
    } catch (error) {
      file.destroy();
      await unlink(partial).catch(() => undefined);
      throw error;
    }
    this.readyFile = dest;
    this.readyVersion = version;
    this.snapshot = { ...this.snapshot, downloading: false, progress: 1 };
    return dest;
  }
}

/**
 * Keep installer filenames free of path separators so a weird release tag cannot
 * write outside the cache directory (`Nearbox-1.0.0/../../evil-win-x64.exe`).
 */
export function sanitizeInstallerVersion(version: string): string {
  const safe = version.trim().replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return safe || "unknown";
}

export function installerFileName(version: string): string {
  return `Nearbox-${sanitizeInstallerVersion(version)}-win-x64.exe`;
}

/** `cacheDir/Nearbox-<safe>-win-x64.exe` — safe name has no separators, so join cannot escape. */
export function installerPath(cacheDir: string, version: string): string {
  return join(cacheDir, installerFileName(version));
}
