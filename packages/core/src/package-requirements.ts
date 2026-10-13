import { join } from "node:path";
import { pathToFileURL } from "node:url";

export interface PackageRequirement<TArgs = unknown> {
  name: string;
  install: string;
  from?: string | URL | undefined;
  description?: string | undefined;
  when?: ((args: TArgs) => boolean) | undefined;
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
        `Package "${requirement.name}" is required. Install it with: ${requirement.install}`,
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
      ({ name, install, description }) =>
        `${description ? `${description}: ` : ""}Requires ${name}; install with: ${install}`,
    )
    .join("\n");
}
