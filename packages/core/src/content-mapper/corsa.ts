import { resolve } from "import-meta-resolve";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type * as Ast from "typescript/ast";
import type * as Sync from "typescript/sync";

/** Packages that ship the TypeScript 7 JavaScript API, in the order they are tried. */
export const API_PACKAGES = ["typescript", "tsrs"] as const;
export type ApiPackage = (typeof API_PACKAGES)[number];

export interface Corsa {
  packageName: ApiPackage;
  api: Sync.API;
  ast: typeof Ast;
}

const loaded = new Map<string, Corsa>();

function resolveFrom(projectDir: string, specifier: string): string | undefined {
  try {
    return resolve(specifier, pathToFileURL(path.join(projectDir, "package.json")).href);
  } catch {
    return undefined;
  }
}

async function load(packageName: ApiPackage, projectDir: string): Promise<Corsa | undefined> {
  const syncPath = resolveFrom(projectDir, `${packageName}/sync`);
  const astPath = resolveFrom(projectDir, `${packageName}/ast`);
  if (!syncPath || !astPath) return undefined;
  const key = `${syncPath}\0${projectDir}`;
  const cached = loaded.get(key);
  if (cached) return cached;
  const sync = (await import(syncPath)) as typeof Sync;
  const ast = (await import(astPath)) as typeof Ast;
  const corsa = { packageName, api: new sync.API({ cwd: projectDir }), ast };
  loaded.set(key, corsa);
  return corsa;
}

/**
 * Load the TypeScript 7 JavaScript API (`<package>/sync`) installed in the
 * project, from `typescript` or from `tsrs`, its Rust port.
 * @param projectDir - Directory of the project's tsconfig.json
 * @param preferred - The package to use; when omitted, the first of {@link API_PACKAGES} installed
 * @returns The API, or undefined when no such package is installed
 */
export async function loadCorsa(
  projectDir: string,
  preferred?: ApiPackage,
): Promise<Corsa | undefined> {
  for (const packageName of preferred ? [preferred] : API_PACKAGES) {
    const corsa = await load(packageName, projectDir);
    if (corsa) return corsa;
  }
  return undefined;
}

/** Stop the API processes started by {@link loadCorsa}. */
export function closeCorsa(): void {
  for (const { api } of loaded.values()) api.close();
  loaded.clear();
}
