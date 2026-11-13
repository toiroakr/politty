import * as fs from "node:fs";
import * as path from "node:path";
import { parseEnv } from "node:util";
import type { ExtractedFields, ResolvedFieldMeta } from "../adapter/field-meta.js";
import { extractGlobalArgs, scanInformationalFlags } from "../parser/arg-parser.js";
import type { ArgsSchema } from "../types.js";
import { extractFields } from "./schema-extractor.js";

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
 * Values of array-typed `envFile` options joined across command levels, outer
 * first. Only options given at more than one level need an entry.
 */
export function concatEnvFileValues(
  levels: readonly Record<string, unknown>[],
  extracted: ExtractedFields | undefined,
): Record<string, string[]> {
  return Object.fromEntries(
    (extracted?.fields ?? []).flatMap((field) => {
      if (!field.envFile || field.type !== "array") return [];
      const values = levels.flatMap((level) => [level[field.name]].flat());
      return values.length > 0 && values.every((value) => typeof value === "string")
        ? [[field.name, values as string[]]]
        : [];
    }),
  );
}

export interface LoadEnvFilesFromArgsOptions {
  /** Command-line arguments to read. Defaults to `process.argv.slice(2)`. */
  argv?: readonly string[];
}

/**
 * Load env files into `process.env` with the semantics of Node.js
 * `--env-file`: a later file overrides an earlier one, and a variable that was
 * already set before the first file was read is left alone.
 *
 * Pass the requests to load, or the `globalArgs` schema to load the files its
 * `envFile` options name on the command line. The second form reads every
 * `envFile` option wherever it sits in `argv`, so a CLI can load the files
 * before it hands the arguments to a plugin that politty does not parse. Files
 * load in option declaration order, then in the order given on the command
 * line. Nothing after `--` is read, and no file is read when help or the
 * version is requested.
 *
 * A missing required file throws {@link EnvFileNotFoundError} and applies no
 * file.
 */
export function loadEnvFiles(requests: readonly EnvFileRequest[]): void;
export function loadEnvFiles(globalArgs: ArgsSchema, options?: LoadEnvFilesFromArgsOptions): void;
export function loadEnvFiles(
  source: readonly EnvFileRequest[] | ArgsSchema,
  options: LoadEnvFilesFromArgsOptions = {},
): void {
  const requests = Array.isArray(source)
    ? (source as readonly EnvFileRequest[])
    : requestsFromArgv(source as ArgsSchema, options.argv ?? process.argv.slice(2));
  applyEnvFileRequests(requests);
}

function requestsFromArgv(globalArgs: ArgsSchema, argv: readonly string[]): EnvFileRequest[] {
  const extracted = extractFields(globalArgs);
  validateEnvFileDefinitions(extracted);
  // A run that only prints help or the version reads no env file, as in runMain.
  if (Object.values(scanInformationalFlags(argv, extracted)).some(Boolean)) return [];
  // Every file counts: a single-string option given twice keeps both values.
  const readAll: ExtractedFields = {
    ...extracted,
    fields: extracted.fields.map((field) =>
      field.envFile && field.type === "string" ? { ...field, type: "array" } : field,
    ),
  };
  return collectEnvFileRequests([extractGlobalArgs(argv, readAll)], extracted);
}

function applyEnvFileRequests(requests: readonly EnvFileRequest[]): void {
  // Read every file before applying any, so a missing file leaves process.env untouched.
  const parsedFiles = requests.flatMap((request) => {
    const envPath = path.resolve(process.cwd(), request.path);
    if (!fs.existsSync(envPath)) {
      if (request.ifExists) return [];
      throw new EnvFileNotFoundError(envPath);
    }
    return [parseEnv(fs.readFileSync(envPath, "utf-8"))];
  });
  // Ask process.env itself rather than compare names, which a case-insensitive
  // environment (Windows) resolves differently: `PATH` in a file must not
  // override an existing `Path`. `in` is not used because it also matches
  // inherited properties such as `constructor`.
  const preset = new Set(
    parsedFiles
      .flatMap((parsed) => Object.keys(parsed))
      .filter((key) => typeof process.env[key] === "string"),
  );
  for (const parsed of parsedFiles) {
    for (const [key, value] of Object.entries(parsed)) {
      if (!preset.has(key)) process.env[key] = value;
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
