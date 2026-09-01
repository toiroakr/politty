/**
 * Default on-disk cache directory for a program's completion cache.
 *
 * Split out from `loader.ts` so the runMain background-refresh hook
 * (`install-check.ts`) can resolve it without pulling in the rc-loader
 * generator's heavier dependency chain (`extractor.ts`).
 */
export function defaultCacheDir(programName: string): string {
  const xdg = process.env.XDG_CACHE_HOME ?? `${process.env.HOME ?? ""}/.cache`;
  return `${xdg}/${programName}`;
}
