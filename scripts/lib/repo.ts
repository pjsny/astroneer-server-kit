import { execSync } from "child_process";

/** Returns `user/repo` from `origin` when it points at github.com, else `""`. */
export function detectGitHubRepoSlug(): string {
  try {
    const remote = execSync("git remote get-url origin", { encoding: "utf8" }).trim();
    const m = remote.match(/github\.com[:/](.+?\/.+?)(?:\.git)?$/);
    return (m?.[1] ?? "").trim();
  } catch {
    return "";
  }
}

/**
 * `https://github.com/user/repo` for status / docs (e.g. **astroneer-server-kit**).
 * Uses `GITHUB_REPO` from env when set, otherwise `git remote origin`.
 */
export function resolveRepoUrl(env: Record<string, string | undefined>): string {
  const slug = (env.GITHUB_REPO ?? detectGitHubRepoSlug()).trim();
  if (!slug) {
    throw new Error(
      "Set GITHUB_REPO=user/repo in .env (or clone this repo from GitHub so origin is a github.com URL).",
    );
  }
  return `https://github.com/${slug}`;
}
