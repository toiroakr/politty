import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { resolveBinPath } from "./header.js";
import type { BundledWorkerOptions, ShellType } from "./types.js";

const execFileAsync = promisify(execFile);

const SHELL_EXT: Record<ShellType, string> = {
  bash: "bash",
  zsh: "zsh",
  fish: "fish",
};

const REQUIRED_WORKER_HEADERS = [
  "# politty-completion-version: 1",
  "# politty-completion-mode: worker",
  "# politty-completion-worker: true",
] as const;

export interface GenerateBundledCompletionWorkerOptions {
  /** CLI binary or built JS entry file to invoke. */
  bin: string;
  /** Program name embedded in completion metadata. */
  programName: string;
  /** Shell worker to generate. */
  shell: ShellType;
  /** Output path. Defaults to `dist/completion/<shell>-worker.<ext>`. */
  outputPath?: string | undefined;
  /** Verify that `__completion-worker-path <shell>` resolves to the generated file. */
  verify?: boolean | undefined;
  /** Working directory used for relative paths. Defaults to `process.cwd()`. */
  cwd?: string | undefined;
  /** Extra environment passed to the target binary. */
  env?: Readonly<Record<string, string | undefined>> | undefined;
  /** Suppress the success message. */
  quiet?: boolean | undefined;
}

export interface GenerateBundledCompletionWorkerResult {
  /** Absolute generated worker path. */
  outputPath: string;
  /** Generated file size in bytes. */
  size: number;
  /** Absolute path reported by `__completion-worker-path`, when verified. */
  reportedPath?: string | undefined;
}

interface ExecResult {
  stdout: string;
  stderr: string;
}

export function bundledWorkerShellExtension(shell: ShellType): string {
  return SHELL_EXT[shell];
}

export function defaultBundledWorkerOutputPath(shell: ShellType): string {
  return join("dist", "completion", `${shell}-worker.${bundledWorkerShellExtension(shell)}`);
}

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

function workerHead(path: string): string {
  return readFileSync(path, "utf8").split("\n", 24).join("\n");
}

function requiredBundledWorkerHeaders(programName: string, shell: ShellType): string[] {
  return [...REQUIRED_WORKER_HEADERS, `# program: ${programName}`, `# shell: ${shell}`];
}

function missingBundledWorkerHeaders(
  head: string,
  programName: string,
  shell: ShellType,
): string[] {
  const lines = head.split("\n").map((line) => line.trimEnd());
  return requiredBundledWorkerHeaders(programName, shell).filter(
    (header) => !lines.includes(header),
  );
}

export function validateBundledWorkerFile(
  path: string,
  programName: string,
  shell: ShellType,
): void {
  if (!existsSync(path)) {
    throw new Error(`Bundled completion worker does not exist: ${path}`);
  }

  const missing = missingBundledWorkerHeaders(workerHead(path), programName, shell);
  if (missing.length > 0) {
    throw new Error(
      `Invalid bundled completion worker ${path}: missing ${missing.map((h) => JSON.stringify(h)).join(", ")}`,
    );
  }
}

export function isBundledWorkerFile(path: string, programName: string, shell: ShellType): boolean {
  try {
    validateBundledWorkerFile(path, programName, shell);
    return true;
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

function resolvePathFromCwd(path: string, cwd: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

function executableCommand(
  bin: string,
  args: readonly string[],
  cwd: string,
): { command: string; args: string[] } {
  const binPath =
    bin.startsWith(".") || bin.includes("/") || bin.includes("\\")
      ? resolvePathFromCwd(bin, cwd)
      : bin;
  const ext = extname(binPath).toLowerCase();
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") {
    return { command: process.execPath, args: [binPath, ...args] };
  }
  return { command: binPath, args: [...args] };
}

async function runTargetBin(
  bin: string,
  args: readonly string[],
  opts: { cwd: string; env?: Readonly<Record<string, string | undefined>> | undefined },
): Promise<ExecResult> {
  const command = executableCommand(bin, args, opts.cwd);
  try {
    const { stdout, stderr } = await execFileAsync(command.command, command.args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return { stdout, stderr };
  } catch (error) {
    const stderr =
      typeof error === "object" && error !== null && "stderr" in error
        ? String((error as { stderr?: unknown }).stderr ?? "").trim()
        : "";
    const detail = stderr ? `\n${stderr}` : "";
    throw new Error(
      `Command failed: ${command.command} ${command.args.join(" ")}${detail}`,
      error instanceof Error ? { cause: error } : undefined,
    );
  }
}

function assertNonEmptyFile(path: string): number {
  const stat = statSync(path);
  if (!stat.isFile() || stat.size === 0) {
    throw new Error(`Generated bundled completion worker is empty: ${path}`);
  }
  return stat.size;
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  return `${(size / 1024).toFixed(1)} KiB`;
}

function printSuccess(path: string, size: number, cwd: string): void {
  const rel = relative(cwd, path);
  console.log(
    `Generated bundled completion worker: ${rel && !rel.startsWith("..") ? rel : path} (${formatSize(size)})`,
  );
}

export async function generateBundledCompletionWorker(
  options: GenerateBundledCompletionWorkerOptions,
): Promise<GenerateBundledCompletionWorkerResult> {
  const cwd = options.cwd ?? process.cwd();
  const outputPath = resolvePathFromCwd(
    options.outputPath ?? defaultBundledWorkerOutputPath(options.shell),
    cwd,
  );

  mkdirSync(dirname(outputPath), { recursive: true });
  // Force a fresh build: `__refresh-completion` no-ops when the existing
  // worker's `politty-bin-sig` matches the bin's (second-granularity) mtime,
  // which can return a stale artifact during fast successive builds. Removing
  // any existing output guarantees regeneration for the publishable worker.
  rmSync(outputPath, { force: true });
  await runTargetBin(
    options.bin,
    ["__refresh-completion", options.shell, outputPath, "--static", "--worker"],
    { cwd, env: options.env },
  );

  const size = assertNonEmptyFile(outputPath);
  validateBundledWorkerFile(outputPath, options.programName, options.shell);

  let reportedPath: string | undefined;
  if (options.verify) {
    const result = await runTargetBin(options.bin, ["__completion-worker-path", options.shell], {
      cwd,
      env: options.env,
    });
    const lines = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length !== 1) {
      throw new Error(
        `Expected __completion-worker-path ${options.shell} to print exactly one path, got ${lines.length}.`,
      );
    }

    reportedPath = resolvePathFromCwd(lines[0]!, cwd);
    const generatedReal = realpathSync(outputPath);
    const reportedReal = realpathSync(reportedPath);
    if (reportedReal !== generatedReal) {
      throw new Error(
        `Bundled completion worker path mismatch: generated ${generatedReal}, reported ${reportedReal}`,
      );
    }
  }

  if (!options.quiet) {
    printSuccess(outputPath, size, cwd);
  }

  return {
    outputPath,
    size,
    ...(reportedPath !== undefined && { reportedPath }),
  };
}
