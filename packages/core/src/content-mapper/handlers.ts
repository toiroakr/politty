import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { EMPTY_MODULE, globalArgsSourceOf } from "./global-args-module.js";
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

function optionDiagnostics(options: Record<string, unknown> | undefined): OptionDiagnostic[] {
  return Object.entries(options ?? {}).flatMap(([key, value]): OptionDiagnostic[] => {
    if (key !== "entry") {
      return [
        {
          path: [key],
          messageText: `politty's content mapper takes only the "entry" option`,
          code: OPTION_DIAGNOSTIC_CODE,
        },
      ];
    }
    return typeof value === "string"
      ? []
      : [
          {
            path: [key],
            messageText: `"entry" must be the path of the module that calls runMain, relative to tsconfig.json`,
            code: OPTION_DIAGNOSTIC_CODE,
          },
        ];
  });
}

const ENTRY_REQUIRED = `politty's content mapper needs the "entry" option in tsconfig.json: the path of the module that calls runMain, relative to tsconfig.json`;

/**
 * Read the `globalArgs` schema the entry passes to `runMain` and build the
 * module that augments `GlobalArgs` with its output type.
 * @param tsconfigPath - Path of the project's tsconfig.json
 * @param options - The `options` of politty's `contentMappers` entry
 */
export function loadProject(tsconfigPath: string, options?: Record<string, unknown>): Project {
  const entryOption = options?.["entry"];
  if (typeof entryOption !== "string") {
    return { text: EMPTY_MODULE, problem: ENTRY_REQUIRED, watchedFiles: [] };
  }
  const entry = path.resolve(path.dirname(tsconfigPath), entryOption);
  const source = readSource(entry);
  if (source === undefined) {
    return {
      text: EMPTY_MODULE,
      problem: `The entry ${entry} cannot be read`,
      watchedFiles: [entry],
    };
  }
  const found = globalArgsSourceOf(entry, source);
  return found
    ? { text: found.text, watchedFiles: [entry] }
    : {
        text: EMPTY_MODULE,
        problem: `${entry} does not call runMain with a globalArgs option`,
        watchedFiles: [entry],
      };
}

/**
 * Create the handlers of the content mapper that types `GlobalArgs` from the
 * `globalArgs` schema passed to `runMain`.
 * @param load - Loads a project; replaceable for tests
 * @returns A handler for each method of the content mapper protocol
 */
export function createContentMapperHandlers(load = loadProject): ContentMapperHandlers {
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

    openProject(params) {
      const { configFileName, projectHandle, options } = params as OpenProjectParams;
      const project = load(configFileName, options);
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
