/**
 * Pure helpers for merging a fresh detectAgents() pass onto the live catalog.
 * Keeps AgentInfo object identity (and thus models[]) when availability/command
 * did not change, so run-only snapshot ticks are not forced by a manual refresh.
 */

export type DetectedAgent = {
  kind: string;
  label: string;
  available: boolean;
  command?: string;
  detail?: string;
  supportsResume: boolean;
};

function detectionEqual(a: DetectedAgent, b: DetectedAgent): boolean {
  return (
    a.kind === b.kind &&
    a.label === b.label &&
    a.available === b.available &&
    a.command === b.command &&
    a.detail === b.detail &&
    a.supportsResume === b.supportsResume
  );
}

/**
 * Adopt `detected` onto `previous`. Unchanged rows keep their previous object
 * (models / errors / ide prefs). When every row is unchanged, return `previous`
 * itself so snapshot.agents stays referentially stable.
 */
export function adoptDetectedAgents<T extends DetectedAgent>(previous: readonly T[], detected: readonly T[]): T[] {
  if (previous.length === detected.length) {
    let allSame = true;
    for (let index = 0; index < detected.length; index += 1) {
      const prior = previous[index]!;
      const next = detected[index]!;
      if (prior.kind !== next.kind || !detectionEqual(prior, next)) {
        allSame = false;
        break;
      }
    }
    if (allSame) {
      return previous as T[];
    }
  }
  const byKind = new Map(previous.map((item) => [item.kind, item] as const));
  return detected.map((info) => {
    const prior = byKind.get(info.kind);
    if (prior && detectionEqual(prior, info)) {
      return prior;
    }
    if (prior && "models" in prior && (prior as T & { models?: unknown }).models) {
      const rich = prior as T & {
        models?: unknown;
        modelsCheckedAt?: unknown;
        modelsError?: unknown;
        ideModels?: unknown;
      };
      return {
        ...info,
        models: rich.models,
        modelsCheckedAt: rich.modelsCheckedAt,
        modelsError: rich.modelsError,
        ideModels: rich.ideModels,
      } as T;
    }
    return info;
  });
}
