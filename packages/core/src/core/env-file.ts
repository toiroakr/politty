import * as fs from "node:fs";
import * as path from "node:path";
import { parseEnv } from "node:util";
import type { ExtractedFields } from "../adapter/field-meta.js";

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
  for (const request of requests) {
    const envPath = path.resolve(process.cwd(), request.path);
    if (!fs.existsSync(envPath)) {
      if (request.ifExists) continue;
      throw new EnvFileNotFoundError(envPath);
    }
    for (const [key, value] of Object.entries(parseEnv(fs.readFileSync(envPath, "utf-8")))) {
      if (!originalKeys.has(key)) process.env[key] = value;
    }
  }
}
