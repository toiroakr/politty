import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { API_PACKAGES, loadCorsa, type ApiPackage, type Corsa } from "./corsa.js";
import { readGlobalArgs } from "./entry-analysis.js";
import { buildGlobalArgsModule, EMPTY_MODULE } from "./global-args-module.js";
import type { JsonRpcHandler } from "./rpc.js";

export type ContentMapperHandlers = Record<
  "initialize" | "openProject" | "transform" | "closeProject",
  JsonRpcHandler
>;

type PositionEncoding = "utf-8" | "utf-16";

interface InitializeParams {
  positionEncodings?: PositionEncoding[];
  protocolVersion?: number;
}

interface OpenProjectParams {
  configFileName: string;
  projectHandle: string;
  options?: Record<string, unknown>;
  compilerOptions?: Record<string, unknown>;
}

interface TransformParams {
  fileName: string;
  content: string;
  projectHandle: string;
}

interface OptionDiagnostic {
  path: string[];
  messageText: string;
  code: number;
}

interface Project {
  text: string;
  problem?: string | undefined;
  watchedFiles: string[];
}

const PROJECT_DIAGNOSTIC_CODE = 1;
const OPTION_DIAGNOSTIC_CODE = 2;
const ATOM_SPAN = 1;
const DEFINITION_FEATURES = (1 << 3) | (1 << 4);
const PROJECT_NOT_OPENED = "The project was not opened; restart the TypeScript server";

function readSource(file: string): string | undefined {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

const ENTRY_OPTION = "entry";
const COMPILER_OPTION = "compiler";
const ENTRY_REQUIRED = `politty's content mapper needs the "${ENTRY_OPTION}" option in tsconfig.json: the path of the module that calls runMain, relative to tsconfig.json`;
const GENERATED_DIR = path.dirname(fileURLToPath(import.meta.url));

function isApiPackage(value: unknown): value is ApiPackage {
  return (API_PACKAGES as readonly unknown[]).includes(value);
}

function optionDiagnostics(options: Record<string, unknown> | undefined): OptionDiagnostic[] {
  const diagnostic = (key: string, messageText: string): OptionDiagnostic => ({
    path: [key],
    messageText,
    code: OPTION_DIAGNOSTIC_CODE,
  });
  return Object.entries(options ?? {}).flatMap(([key, value]): OptionDiagnostic[] => {
    if (key === ENTRY_OPTION) {
      return typeof value === "string"
        ? []
        : [
            diagnostic(
              key,
              `"${ENTRY_OPTION}" must be the path of the module that calls runMain, relative to tsconfig.json`,
            ),
          ];
    }
    if (key === COMPILER_OPTION) {
      return isApiPackage(value)
        ? []
        : [
            diagnostic(
              key,
              `"${COMPILER_OPTION}" must be one of ${API_PACKAGES.map((name) => `"${name}"`).join(", ")}`,
            ),
          ];
    }
    return [
      diagnostic(
        key,
        `politty's content mapper takes only the "${ENTRY_OPTION}" and "${COMPILER_OPTION}" options`,
      ),
    ];
  });
}

function missingApi(preferred: ApiPackage | undefined): string {
  const packages = preferred ? [preferred] : API_PACKAGES;
  return `politty's content mapper reads the entry with the TypeScript 7.1 JavaScript API; install ${packages.join(" or ")} in the project (${packages.map((name) => `${name}/sync`).join(", ")} was not found)`;
}

function readEntry(
  corsa: Corsa,
  tsconfigPath: string,
  compilerOptions: Record<string, unknown> | undefined,
  entry: string,
  source: string,
): Project {
  const { api, ast } = corsa;
  const resolver = api.createModuleResolver(
    compilerOptions ?? api.parseConfigFile(tsconfigPath).options,
  );
  const lease = api.createSourceFile(entry, source);
  try {
    const reference = readGlobalArgs(ast, lease.sourceFile);
    if (!reference) {
      return {
        text: EMPTY_MODULE,
        problem: `${entry} does not call runMain with a globalArgs option`,
        watchedFiles: [entry],
      };
    }
    const built = buildGlobalArgsModule(reference, entry, GENERATED_DIR, (specifier, dir) => {
      return resolver.resolveModuleName(specifier, dir).resolvedModule ?? undefined;
    });
    return {
      text: built.text,
      problem: built.problems.length > 0 ? built.problems.join("\n") : undefined,
      watchedFiles: [entry],
    };
  } finally {
    lease.dispose();
    resolver.dispose();
  }
}

/**
 * Read the `globalArgs` schema the entry passes to `runMain` and build the
 * module that augments `GlobalArgs` with its output type.
 * @param tsconfigPath - Path of the project's tsconfig.json
 * @param options - The `options` of politty's `contentMappers` entry
 * @param compilerOptions - The project's compiler options, as TypeScript passes them to the mapper; read from tsconfig.json when omitted
 */
export async function loadProject(
  tsconfigPath: string,
  options?: Record<string, unknown>,
  compilerOptions?: Record<string, unknown>,
): Promise<Project> {
  const entryOption = options?.[ENTRY_OPTION];
  if (typeof entryOption !== "string") {
    return { text: EMPTY_MODULE, problem: ENTRY_REQUIRED, watchedFiles: [] };
  }
  const projectDir = path.dirname(tsconfigPath);
  const entry = path.resolve(projectDir, entryOption);
  const source = readSource(entry);
  if (source === undefined) {
    return {
      text: EMPTY_MODULE,
      problem: `The entry ${entry} cannot be read`,
      watchedFiles: [entry],
    };
  }
  const compiler = options?.[COMPILER_OPTION];
  const preferred = isApiPackage(compiler) ? compiler : undefined;
  const corsa = await loadCorsa(projectDir, preferred);
  if (!corsa) return { text: EMPTY_MODULE, problem: missingApi(preferred), watchedFiles: [entry] };
  return readEntry(corsa, tsconfigPath, compilerOptions, entry, source);
}

/**
 * Create the handlers of the content mapper that types `GlobalArgs` from the
 * `globalArgs` schema passed to `runMain`.
 * @param load - Loads a project; replaceable for tests
 * @returns A handler for each method of the content mapper protocol
 */
export function createContentMapperHandlers(
  load: (
    tsconfigPath: string,
    options?: Record<string, unknown>,
    compilerOptions?: Record<string, unknown>,
  ) => Project | Promise<Project> = loadProject,
): ContentMapperHandlers {
  let encoding: PositionEncoding = "utf-16";
  const projects = new Map<string, Project>();
  const position = (content: string, offset: number): number =>
    encoding === "utf-16" ? offset : Buffer.byteLength(content.slice(0, offset));

  return {
    initialize(params) {
      const { positionEncodings, protocolVersion } = (params ?? {}) as InitializeParams;
      encoding = positionEncodings && !positionEncodings.includes("utf-16") ? "utf-8" : "utf-16";
      return {
        ...(protocolVersion !== undefined && { protocolVersion }),
        positionEncoding: encoding,
        diagnosticSource: "politty",
      };
    },

    async openProject(params) {
      const { configFileName, projectHandle, options, compilerOptions } =
        params as OpenProjectParams;
      const project = await load(configFileName, options, compilerOptions);
      projects.set(projectHandle, project);
      return {
        configIdentity: createHash("sha256")
          .update(JSON.stringify([project.text, project.problem ?? null]))
          .digest("hex"),
        watchedFiles: project.watchedFiles,
        optionDiagnostics: optionDiagnostics(options),
      };
    },

    transform(params) {
      const { content, projectHandle } = params as TransformParams;
      const project = projects.get(projectHandle);
      const text = project?.text ?? EMPTY_MODULE;
      const problem = project ? project.problem : PROJECT_NOT_OPENED;
      return {
        extension: ".ts",
        text,
        diagnostics:
          problem === undefined
            ? []
            : [{ messageText: problem, start: 0, length: 0, code: PROJECT_DIAGNOSTIC_CODE }],
        mappings: [
          [
            0,
            position(text, text.length),
            0,
            position(content, content.length),
            ATOM_SPAN,
            DEFINITION_FEATURES,
          ],
        ],
      };
    },

    closeProject(params) {
      projects.delete((params as { projectHandle: string }).projectHandle);
      return {};
    },
  };
}
