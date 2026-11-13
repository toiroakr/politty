import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalArgsSourceOf } from "./global-args-module.js";
import { createContentMapperHandlers, loadProject } from "./handlers.js";
import { serveJsonRpc } from "./rpc.js";

const ENTRY = `import { z } from "zod";
import { runMain } from "politty";
import { commonArgs } from "./shared/args.js";
runMain(cli, { globalArgs: z.object(commonArgs) });
`;

let dir: string;

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "politty-content-mapper-")));
  fs.writeFileSync(path.join(dir, "tsconfig.json"), "{}");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(relative: string, content: string): string {
  const file = path.join(dir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

describe("globalArgsSourceOf", () => {
  it("augments GlobalArgs from the schema, resolving relative imports from the entry", () => {
    const entry = write("src/main.ts", ENTRY);
    expect(globalArgsSourceOf(entry, ENTRY)?.text).toBe(`import { z } from "zod";
import { commonArgs } from "${dir}/src/shared/args.js";
const __polittyGlobalArgsSchema = z.object(commonArgs);
type __PolittyGlobalArgs = NonNullable<(typeof __polittyGlobalArgsSchema)["~standard"]["types"]>["output"];
declare module "./index.js" {
  interface GlobalArgs extends __PolittyGlobalArgs {}
}
export {};
`);
  });

  it("resolves # specifiers through the package's imports field", () => {
    write(
      "package.json",
      JSON.stringify({ imports: { "#/*": "./src/*.ts", "#args": { types: "./src/args.ts" } } }),
    );
    const source = `import { runMain } from "politty";
import { a } from "#/shared/args";
import { b } from "#args";
import { c } from "#missing";
runMain(cli, { globalArgs: z.object({ ...a, ...b, ...c }) });
`;
    const text = globalArgsSourceOf(write("src/main.ts", source), source)?.text;
    expect(text).toContain(`import { a } from "${dir}/src/shared/args.ts";`);
    expect(text).toContain(`import { b } from "${dir}/src/args.ts";`);
    expect(text).toContain(`import { c } from "#missing";`);
  });

  it("returns undefined when runMain gets no globalArgs", () => {
    const source = `import { runMain } from "politty";\nrunMain(cli);\n`;
    expect(globalArgsSourceOf(write("src/main.ts", source), source)).toBeUndefined();
  });
});

describe("loadProject", () => {
  const tsconfig = () => path.join(dir, "tsconfig.json");

  it("finds the only entry that passes globalArgs to runMain", () => {
    const entry = write("src/main.ts", ENTRY);
    write("src/other.ts", `export const runMainLater = 1;\n`);
    write("node_modules/dep/main.ts", ENTRY);
    write("src/types.d.ts", ENTRY);
    const project = loadProject(tsconfig());
    expect(project.problem).toBeUndefined();
    expect(project.watchedFiles).toEqual([entry]);
    expect(project.text).toContain("interface GlobalArgs extends");
  });

  it("leaves GlobalArgs alone when no file passes globalArgs", () => {
    write("src/main.ts", `import { runMain } from "politty";\nrunMain(cli);\n`);
    expect(loadProject(tsconfig())).toEqual({ text: "export {};\n", watchedFiles: [] });
  });

  it("asks for the entry option when several files pass globalArgs", () => {
    write("src/a.ts", ENTRY);
    write("src/b.ts", ENTRY);
    const project = loadProject(tsconfig());
    expect(project.text).toBe("export {};\n");
    expect(project.problem).toMatch(/more than one file .*"entry" option/);
  });

  it("uses the entry option when given", () => {
    write("src/a.ts", ENTRY);
    const b = write("src/b.ts", ENTRY.replace("z.object", "z.strictObject"));
    const project = loadProject(tsconfig(), { entry: "./src/b.ts" });
    expect(project.watchedFiles).toEqual([b]);
    expect(project.text).toContain("z.strictObject(commonArgs)");
  });

  it("reports an entry that is missing or passes no globalArgs", () => {
    expect(loadProject(tsconfig(), { entry: "missing.ts" }).problem).toMatch(/does not exist/);
    write("src/main.ts", `export {};\n`);
    expect(loadProject(tsconfig(), { entry: "src/main.ts" }).problem).toMatch(
      /does not call runMain with a globalArgs option/,
    );
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

  it("answers transform with the project's module and its problem", () => {
    const handlers = createContentMapperHandlers(() => project);
    handlers.initialize({ positionEncodings: ["utf-8"] });
    const opened = handlers.openProject({
      configFileName: "/p/tsconfig.json",
      projectHandle: "p1",
      options: { entry: 1, other: true },
    }) as { configIdentity: string; watchedFiles: string[]; optionDiagnostics: unknown[] };
    expect(opened.watchedFiles).toEqual(["/a.ts"]);
    expect(opened.configIdentity).toMatch(/^[0-9a-f]{64}$/);
    expect(opened.optionDiagnostics).toEqual([
      expect.objectContaining({ path: ["entry"] }),
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

  it("answers framed requests in order, split across chunks, and skips notifications", async () => {
    const input = new PassThrough();
    const written: Buffer[] = [];
    const serving = serveJsonRpc(
      {
        echo: (params) => params,
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
      { jsonrpc: "2.0", id: 2, error: { code: -32603, message: "nope" } },
      { jsonrpc: "2.0", id: 3, error: { code: -32601, message: "Unknown method: missing" } },
    ]);
  });
});
