import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { API_PACKAGES, closeCorsa, loadCorsa } from "./corsa.js";
import { createContentMapperHandlers, loadProject } from "./handlers.js";
import { serveJsonRpc } from "./rpc.js";

const ENTRY = `import { z } from "zod";
import { runMain } from "politty";
import { commonArgs } from "./shared/args.js";
runMain(cli, { globalArgs: z.object(commonArgs) });
`;

const fixtures: string[] = [];

afterEach(() => {
  for (const dir of fixtures.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

afterAll(() => closeCorsa());

/** A project directory inside this package, so it resolves the package's typescript, tsrs and zod. */
function project(parent = import.meta.dirname): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(parent, ".content-mapper-fixture-")));
  fixtures.push(dir);
  write(
    dir,
    "tsconfig.json",
    JSON.stringify({ compilerOptions: { module: "esnext", moduleResolution: "bundler" } }),
  );
  return dir;
}

/** How the generated module writes a path: with forward slashes on every platform. */
function posix(file: string): string {
  return file.split(path.sep).join("/");
}

function write(dir: string, relative: string, content: string): string {
  const file = path.join(dir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

describe("loadCorsa", () => {
  it("loads the package named, or the first installed one", async () => {
    expect((await loadCorsa(import.meta.dirname))?.packageName).toBe("typescript");
    expect((await loadCorsa(import.meta.dirname, "tsrs"))?.packageName).toBe("tsrs");
    expect(await loadCorsa(os.tmpdir())).toBeUndefined();
  });
});

describe.each(API_PACKAGES)("loadProject with %s", (compiler) => {
  const load = (dir: string, entry = "src/main.ts") =>
    loadProject(path.join(dir, "tsconfig.json"), { entry, compiler });

  it("augments GlobalArgs from the schema, reaching project files by absolute path", async () => {
    const dir = project();
    const entry = write(dir, "src/main.ts", ENTRY);
    write(dir, "src/shared/args.ts", "export const commonArgs = {};\n");

    expect(await load(dir)).toEqual({
      text: `import { z } from "zod";
import { commonArgs } from "${posix(dir)}/src/shared/args.js";
const __polittyGlobalArgsSchema = z.object(commonArgs);
type __PolittyKeys<U> = U extends unknown ? keyof U : never;
type __PolittyValue<U, K extends PropertyKey> = U extends unknown ? (K extends keyof U ? U[K] : never) : never;
type __PolittyIsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : never;
type __PolittyOptionalKeys<U> = U extends unknown ? { [K in keyof U]-?: {} extends Pick<U, K> ? K : never }[keyof U] : never;
type __PolittyRequiredKeys<T> = Exclude<keyof T, __PolittyOptionalKeys<T>>;
type __PolittyExtendable<T> = true extends __PolittyIsUnion<T>
  ? { [K in Extract<__PolittyRequiredKeys<T>, PropertyKey>]: __PolittyValue<T, K> } & { [K in Exclude<__PolittyKeys<T>, __PolittyRequiredKeys<T>>]?: __PolittyValue<T, K> }
  : T;
type __PolittyGlobalArgs = __PolittyExtendable<NonNullable<(typeof __polittyGlobalArgsSchema)["~standard"]["types"]>["output"]>;
declare module "./index.js" {
  interface GlobalArgs extends __PolittyGlobalArgs {}
}
export {};
`,
      problem: undefined,
      watchedFiles: [entry],
    });
  });

  it("resolves # imports and tsconfig paths the way the project does", async () => {
    const dir = project();
    write(dir, "package.json", JSON.stringify({ imports: { "#/*": "./src/*.ts" } }));
    write(
      dir,
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          module: "esnext",
          moduleResolution: "bundler",
          paths: { "@lib/*": ["./lib/*"] },
        },
      }),
    );
    write(dir, "src/shared/args.ts", "export const a = {};\n");
    write(dir, "lib/types.d.ts", "export type B = {};\n");
    write(
      dir,
      "src/main.ts",
      `import { runMain } from "politty";
import { a } from "#/shared/args";
import type { B } from "@lib/types";
runMain(cli, { globalArgs: z.object(a as B) });
`,
    );
    const { text, problem } = await load(dir);
    expect(problem).toBeUndefined();
    expect(text).toContain(`import { a } from "${posix(dir)}/src/shared/args.js";`);
    expect(text).toContain(`import type { B } from "${posix(dir)}/lib/types.js";`);
  });

  it("resolves with the compiler options TypeScript passes, and rewrites import() specifiers", async () => {
    const dir = project();
    write(dir, "src/shared/args.ts", "export const a = {};\n");
    write(dir, "src/shared/types.ts", "export type Mode = {};\n");
    write(
      dir,
      "src/main.ts",
      `import { runMain } from "politty";
type Mode = import("@shared/types").Mode;
runMain(cli, { globalArgs: (await import("@shared/args")).a as Mode });
`,
    );
    const { text, problem } = await loadProject(
      path.join(dir, "tsconfig.json"),
      { entry: "src/main.ts", compiler },
      {
        module: 99,
        moduleResolution: 100,
        paths: { "@shared/*": ["./src/shared/*"] },
        pathsBasePath: dir,
      },
    );
    expect(problem).toBeUndefined();
    expect(text).toContain(`type Mode = import("${posix(dir)}/src/shared/types.js").Mode;`);
    expect(text).toContain(`(await import("${posix(dir)}/src/shared/args.js")).a as Mode;`);
  });

  it("reports a package the generated module cannot resolve as the entry does", async () => {
    const dir = project();
    write(
      dir,
      "node_modules/local-schema/package.json",
      JSON.stringify({ name: "local-schema", types: "index.d.ts" }),
    );
    write(dir, "node_modules/local-schema/index.d.ts", "export declare const schema: unknown;\n");
    write(
      dir,
      "src/main.ts",
      `import { runMain } from "politty";\nimport { schema } from "local-schema";\nrunMain(cli, { globalArgs: schema });\n`,
    );
    expect((await load(dir)).problem).toMatch(
      /"local-schema" resolves to .*local-schema\/index\.d\.ts from .* but to nothing from politty's package/,
    );
  });

  it("reports an entry that is missing or passes no globalArgs", async () => {
    const dir = project();
    expect((await load(dir, "missing.ts")).problem).toMatch(/cannot be read/);
    write(dir, "src/main.ts", `import { runMain } from "politty";\nrunMain(cli);\n`);
    expect((await load(dir)).problem).toMatch(/does not call runMain with a globalArgs option/);
  });
});

describe("loadProject options", () => {
  it("requires the entry option", async () => {
    const dir = project();
    for (const options of [undefined, {}, { entry: 1 }]) {
      expect(await loadProject(path.join(dir, "tsconfig.json"), options)).toEqual({
        text: "export {};\n",
        problem: expect.stringMatching(/needs the "entry" option/),
        watchedFiles: [],
      });
    }
  });

  it("asks for typescript or tsrs when the project has neither", async () => {
    const dir = project(os.tmpdir());
    const entry = write(dir, "src/main.ts", ENTRY);
    expect(await loadProject(path.join(dir, "tsconfig.json"), { entry: "src/main.ts" })).toEqual({
      text: "export {};\n",
      problem: expect.stringMatching(/install typescript or tsrs in the project/),
      watchedFiles: [entry],
    });
    expect(
      (
        await loadProject(path.join(dir, "tsconfig.json"), {
          entry: "src/main.ts",
          compiler: "tsrs",
        })
      ).problem,
    ).toMatch(/install tsrs in the project \(tsrs\/sync was not found\)/);
  });
});

describe("createContentMapperHandlers", () => {
  const project = { text: "export {};\n// é\n", problem: "broken", watchedFiles: ["/a.ts"] };

  it("negotiates the position encoding and echoes the protocol version", () => {
    const handlers = createContentMapperHandlers(() => project);
    expect(handlers.initialize({ positionEncodings: ["utf-8"], protocolVersion: 1 })).toEqual({
      protocolVersion: 1,
      positionEncoding: "utf-8",
      diagnosticSource: "politty",
    });
    expect(handlers.initialize({ positionEncodings: ["utf-8", "utf-16"] })).toMatchObject({
      positionEncoding: "utf-16",
    });
  });

  it("answers transform with the project's module and its problem", async () => {
    const handlers = createContentMapperHandlers(() => project);
    handlers.initialize({ positionEncodings: ["utf-8"] });
    const opened = (await handlers.openProject({
      configFileName: "/p/tsconfig.json",
      projectHandle: "p1",
      options: { entry: 1, compiler: "tsc", other: true },
    })) as { configIdentity: string; watchedFiles: string[]; optionDiagnostics: unknown[] };
    expect(opened.watchedFiles).toEqual(["/a.ts"]);
    expect(opened.configIdentity).toMatch(/^[0-9a-f]{64}$/);
    expect(opened.optionDiagnostics).toEqual([
      expect.objectContaining({ path: ["entry"] }),
      expect.objectContaining({
        path: ["compiler"],
        messageText: expect.stringMatching(/"typescript", "tsrs"/),
      }),
      expect.objectContaining({ path: ["other"] }),
    ]);

    expect(
      handlers.transform({
        fileName: "/x/global-args.politty",
        content: "// é",
        projectHandle: "p1",
      }),
    ).toEqual({
      extension: ".ts",
      text: project.text,
      diagnostics: [{ messageText: "broken", start: 0, length: 0, code: 1 }],
      mappings: [[0, Buffer.byteLength(project.text), 0, Buffer.byteLength("// é"), 1, 24]],
    });

    handlers.closeProject({ projectHandle: "p1" });
    expect(
      handlers.transform({ fileName: "/x/global-args.politty", content: "", projectHandle: "p1" }),
    ).toMatchObject({ text: "export {};\n", diagnostics: [expect.objectContaining({ code: 1 })] });
  });
});

describe("serveJsonRpc", () => {
  function frame(message: unknown): Buffer {
    const body = Buffer.from(JSON.stringify(message));
    return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);
  }

  it("answers framed requests in order, split across chunks, keeps null results and skips notifications", async () => {
    const input = new PassThrough();
    const written: Buffer[] = [];
    const serving = serveJsonRpc(
      {
        echo: (params) => params,
        nothing: () => null,
        fail: () => {
          throw new Error("nope");
        },
      },
      input,
      (chunk) => written.push(chunk),
    );
    const requests = Buffer.concat([
      frame({ jsonrpc: "2.0", id: 1, method: "echo", params: { a: "é" } }),
      frame({ jsonrpc: "2.0", method: "echo", params: {} }),
      frame({ jsonrpc: "2.0", id: 4, method: "nothing" }),
      frame({ jsonrpc: "2.0", id: 2, method: "fail" }),
      frame({ jsonrpc: "2.0", id: 3, method: "missing" }),
    ]);
    input.write(requests.subarray(0, 10));
    input.end(requests.subarray(10));
    await serving;

    const responses = Buffer.concat(written)
      .toString("utf8")
      .split(/Content-Length: \d+\r\n\r\n/)
      .filter(Boolean)
      .map((body) => JSON.parse(body));
    expect(responses).toEqual([
      { jsonrpc: "2.0", id: 1, result: { a: "é" } },
      { jsonrpc: "2.0", id: 4, result: null },
      { jsonrpc: "2.0", id: 2, error: { code: -32603, message: "nope" } },
      { jsonrpc: "2.0", id: 3, error: { code: -32601, message: "Unknown method: missing" } },
    ]);
  });
});
