/**
 * GitHub `owner/name` slug for releases/latest. Anything with extra path
 * segments or odd characters must not be interpolated into the API URL.
 */

const REPO_SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** True when `repo` is a single owner/name pair safe for the releases API path. */
export function isGithubRepoSlug(repo: string): boolean {
  if (typeof repo !== "string") {
    return false;
  }
  const trimmed = repo.trim();
  if (!trimmed || trimmed.length > 128) {
    return false;
  }
  if (trimmed.includes("..") || trimmed.includes("\\") || trimmed.includes("//")) {
    return false;
  }
  return REPO_SLUG.test(trimmed);
}

/** Prefer a valid override; otherwise fall back to the default release repo. */
export function resolveReleaseRepo(repo: string | undefined, fallback: string): string {
  if (typeof repo === "string" && isGithubRepoSlug(repo)) {
    return repo.trim();
  }
  return fallback;
}
