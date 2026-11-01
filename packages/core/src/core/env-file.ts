import * as fs from "node:fs";
import * as path from "node:path";
import { parseEnv } from "node:util";
import type { ExtractedFields, ResolvedFieldMeta } from "../adapter/field-meta.js";

export interface EnvFileRequest {
  path: string;
  ifExists: boolean;
}

export class EnvFileNotFoundError extends Error {
  constructor(envPath: string) {
    super(`Environment file not found: ${envPath}`);
    this.name = "EnvFileNotFoundError";
  }
}

/**
 * Env files named by `envFile` global options, in option declaration order,
 * then in the order given on the command line (outer command first).
 */
export function collectEnvFileRequests(
  levels: readonly Record<string, unknown>[],
  extracted: ExtractedFields,
): EnvFileRequest[] {
  return extracted.fields.flatMap((field) => {
    if (!field.envFile) return [];
    const ifExists = field.envFile === "if-exists";
    return levels.flatMap((level) =>
      [level[field.name]]
        .flat()
        .filter((value): value is string => typeof value === "string")
        .map((file) => ({ path: file, ifExists })),
    );
  });
}

/**
 * Load env files into `process.env` with the semantics of Node.js
 * `--env-file`: a later file overrides an earlier one, and a variable that was
 * already set before the first file was read is left alone.
 */
export function loadEnvFiles(requests: readonly EnvFileRequest[]): void {
  const originalKeys = new Set(Object.keys(process.env));
  // Read every file before applying any, so a missing file leaves process.env untouched.
  const parsedFiles = requests.flatMap((request) => {
    const envPath = path.resolve(process.cwd(), request.path);
    if (!fs.existsSync(envPath)) {
      if (request.ifExists) return [];
      throw new EnvFileNotFoundError(envPath);
    }
    return [parseEnv(fs.readFileSync(envPath, "utf-8"))];
  });
  for (const parsed of parsedFiles) {
    for (const [key, value] of Object.entries(parsed)) {
      if (!originalKeys.has(key)) process.env[key] = value;
    }
  }
}

function allDefinitions(extracted: ExtractedFields): ResolvedFieldMeta[] {
  return [
    ...extracted.fields,
    ...(extracted.variants ?? []).flatMap((variant) => variant.fields),
    ...(extracted.unionOptions ?? []).flatMap(allDefinitions),
  ];
}

/**
 * Reject `envFile` on an option that cannot hold a path, and a union whose
 * variants declare one option with different `envFile` settings: the files are
 * read before the variant is chosen, so a single setting has to apply to every
 * variant.
 */
export function validateEnvFileDefinitions(extracted: ExtractedFields): void {
  const settings = new Map<string, Set<boolean | "if-exists">>();
  for (const field of allDefinitions(extracted)) {
    if (field.envFile && field.type !== "string" && field.type !== "array") {
      throw new Error(
        `Global option "${field.name}" sets envFile but its value is not a string or an array of strings`,
      );
    }
    const set = settings.get(field.name) ?? new Set();
    set.add(field.envFile ?? false);
    settings.set(field.name, set);
  }
  for (const [name, set] of settings) {
    if (set.size > 1) {
      throw new Error(
        `Global option "${name}" has different envFile settings across union variants (${[...set]
          .map((value) => JSON.stringify(value))
          .join(", ")}); use the same setting in every variant`,
      );
    }
  }
}
