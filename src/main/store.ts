import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  emptyState,
  parsePersistedState,
  type ModelCatalog,
  type PairedSession,
  type PersistedState,
  type StoredFile,
} from "./store-normalize.ts";
import { enqueueWrite } from "./write-chain.ts";

export type { ModelCatalog, PairedSession, PersistedState, StoredFile };

const MAX_RUNS_KEPT = 300;

/**
 * Single-file JSON store. Writes are debounced and atomic (tmp + rename) so a
 * crash mid-write never leaves a truncated file behind.
 */
export class Store {
  readonly file: string;
  state: PersistedState;
  private timer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();
  private dirty = false;

  constructor(dataDir: string) {
    this.file = join(dataDir, "state.json");
    this.state = this.load();
  }

  private load(): PersistedState {
    if (!existsSync(this.file)) {
      return emptyState();
    }
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as Partial<PersistedState>;
      return parsePersistedState(raw);
    } catch {
      // Keep the broken file around for inspection instead of silently replacing it.
      const backup = `${this.file}.corrupt-${Date.now()}`;
      void rename(this.file, backup).catch(() => undefined);
      return emptyState();
    }
  }

  /** Schedule a write; multiple calls within the window collapse into one. */
  save(): void {
    this.dirty = true;
    if (this.timer) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush().catch(() => undefined);
    }, 150);
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty) {
      return this.writing;
    }
    // A prior failed write leaves `writing` rejected; `.then(write)` would never run
    // again, so one disk blip would permanently stop persistence until restart.
    // Loop inside one job so save() during a write is drained before await flush()
    // returns — without re-entering flush() from that same promise's `.then` (deadlock).
    this.writing = enqueueWrite(this.writing, async () => {
      while (this.dirty) {
        this.dirty = false;
        if (this.timer) {
          clearTimeout(this.timer);
          this.timer = null;
        }
        if (this.state.runs.length > MAX_RUNS_KEPT) {
          this.state.runs = this.state.runs.slice(-MAX_RUNS_KEPT);
        }
        const payload = JSON.stringify(this.state, null, 2);
        try {
          await mkdir(dirname(this.file), { recursive: true });
          const tmp = `${this.file}.tmp`;
          await writeFile(tmp, payload, "utf8");
          await rename(tmp, this.file);
        } catch (error) {
          this.dirty = true;
          throw error;
        }
      }
    });
    return this.writing;
  }
}
