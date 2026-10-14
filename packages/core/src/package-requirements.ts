import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export interface PackageRequirement<TArgs = unknown> {
  name: string;
  install?: string | undefined;
  from?: string | URL | undefined;
  description?: string | undefined;
  when?: ((args: TArgs) => boolean) | undefined;
}

const INSTALL_COMMANDS = {
  npm: "npm install",
  pnpm: "pnpm add",
  yarn: "yarn add",
  bun: "bun add",
} as const;

const LOCK_FILES = [
  ["pnpm-lock.yaml", "pnpm"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
  ["npm-shrinkwrap.json", "npm"],
] as const;

export function getInstallCommand(
  requirement: Pick<PackageRequirement, "name" | "install" | "from">,
): string {
  if (requirement.install !== undefined) return requirement.install;
  const from = requirement.from ? new URL(requirement.from) : undefined;
  let directory = from?.protocol === "file:" ? fileURLToPath(new URL(".", from)) : process.cwd();
  let manager: keyof typeof INSTALL_COMMANDS = "npm";
  while (true) {
    try {
      const manifest: unknown = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
      if (
        typeof manifest === "object" &&
        manifest !== null &&
        "packageManager" in manifest &&
        typeof manifest.packageManager === "string"
      ) {
        const name = manifest.packageManager.split("@")[0];
        if (name === "npm" || name === "pnpm" || name === "yarn" || name === "bun") {
          manager = name;
          break;
        }
      }
    } catch {}
    const lock = LOCK_FILES.find(([filename]) => {
      try {
        return statSync(join(directory, filename)).isFile();
      } catch {
        return false;
      }
    });
    if (lock) {
      manager = lock[1];
      break;
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return `${INSTALL_COMMANDS[manager]} -D ${requirement.name}`;
}

export async function loadPackage<TModule = unknown>(
  requirement: Pick<PackageRequirement, "name" | "install" | "from">,
): Promise<TModule> {
  const { resolve } = await import("import-meta-resolve");
  const from =
    requirement.from?.toString() ?? pathToFileURL(join(process.cwd(), "package.json")).href;
  let url: string;
  try {
    url = resolve(requirement.name, from);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ERR_MODULE_NOT_FOUND" &&
      error.message.startsWith(`Cannot find package '${requirement.name}' imported from `)
    ) {
      throw new Error(
        `Package "${requirement.name}" is required. Install it with: ${getInstallCommand(requirement)}`,
        { cause: error },
      );
    }
    throw error;
  }
  return import(url) as Promise<TModule>;
}

export async function loadRequiredPackages<TArgs>(
  requirements: readonly PackageRequirement<TArgs>[] | undefined,
  args: TArgs,
): Promise<void> {
  for (const requirement of requirements ?? []) {
    if (!requirement.when || requirement.when(args)) {
      await loadPackage(requirement);
    }
  }
}

export function formatPackageRequirements(
  requirements: readonly PackageRequirement[] | undefined,
): string {
  return (requirements ?? [])
    .map(
      (requirement) =>
        `${requirement.description ? `${requirement.description}: ` : ""}Requires ${requirement.name}; install with: ${getInstallCommand(requirement)}`,
    )
    .join("\n");
}
