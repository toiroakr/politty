import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { resolveBinPath } from "./header.js";
import type { BundledWorkerOptions, ShellType } from "./types.js";

const SHELL_EXT: Record<ShellType, string> = {
  bash: "bash",
  zsh: "zsh",
  fish: "fish",
};

export function defaultBundledWorkerRelativePaths(shell: ShellType): string[] {
  const ext = SHELL_EXT[shell];
  return [
    `completion/${shell}-worker.${ext}`,
    `../completion/${shell}-worker.${ext}`,
    `dist/completion/${shell}-worker.${ext}`,
    `../dist/completion/${shell}-worker.${ext}`,
    `completion-worker.${shell}`,
    `../completion-worker.${shell}`,
  ];
}

export function bundledWorkerRelativePaths(
  programName: string,
  shell: ShellType,
  options?: BundledWorkerOptions | undefined,
): string[] {
  if (options?.disabled) return [];
  const configured = options?.relativePaths?.[shell];
  const paths =
    configured && configured.length > 0 ? configured : defaultBundledWorkerRelativePaths(shell);
  return paths.map((p) =>
    p
      .replaceAll("{shell}", shell)
      .replaceAll("{ext}", SHELL_EXT[shell])
      .replaceAll("{program}", programName),
  );
}

function readCmdShimTarget(path: string): string | null {
  try {
    const content = readFileSync(path, "utf8");
    let target: string | null = null;
    for (const line of content.split("\n")) {
      const match = line.match(/^# cmd-shim-target=(.+)$/);
      if (match) target = match[1]!;
    }
    return target;
  } catch {
    return null;
  }
}

function addBaseDirs(out: Set<string>, path: string): void {
  if (!path) return;
  out.add(dirname(resolve(path)));
  try {
    out.add(dirname(realpathSync(path)));
  } catch {
    // ignore
  }
  const shimTarget = readCmdShimTarget(path);
  if (shimTarget) addBaseDirs(out, shimTarget);
}

export function isBundledWorkerFile(path: string, programName: string, shell: ShellType): boolean {
  try {
    if (!existsSync(path)) return false;
    const head = readFileSync(path, "utf8").split("\n", 24).join("\n");
    return (
      head.includes("# politty-completion-version: 1") &&
      head.includes(`# program: ${programName}`) &&
      head.includes(`# shell: ${shell}`) &&
      head.includes("# politty-completion-worker: true")
    );
  } catch {
    return false;
  }
}

export function resolveBundledWorkerPath(opts: {
  programName: string;
  shell: ShellType;
  binPath?: string | undefined;
  bundledWorker?: BundledWorkerOptions | undefined;
}): string | null {
  const rels = bundledWorkerRelativePaths(opts.programName, opts.shell, opts.bundledWorker);
  if (rels.length === 0) return null;

  const bases = new Set<string>();
  addBaseDirs(bases, resolveBinPath(opts.programName, opts.binPath));
  if (process.argv[1]) addBaseDirs(bases, process.argv[1]);

  for (const rel of rels) {
    if (isAbsolute(rel) && isBundledWorkerFile(rel, opts.programName, opts.shell)) {
      return rel;
    }
  }

  for (const base of bases) {
    for (const rel of rels) {
      if (isAbsolute(rel)) continue;
      const candidate = join(base, rel);
      if (isBundledWorkerFile(candidate, opts.programName, opts.shell)) {
        return candidate;
      }
    }
  }

  return null;
}
