import * as fs from "node:fs";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assertDocMatch, initDocFile, type GenerateDocConfig } from "../../src/docs/index.js";
import { runCommand } from "../../src/index.js";
import { spyOnConsoleLog, type ConsoleSpy } from "../../tests/utils/console.js";
import { mdFormatter } from "../../tests/utils/formatter.js";
import { checkCommand, command, readCommand, writeCommand } from "./index.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: vi.fn((path: fs.PathOrFileDescriptor, options?: unknown) => {
      // Allow golden test to read actual README files
      if (String(path).includes("README") || String(path).includes("playground/22-examples")) {
        return actual.readFileSync(path, options as fs.ObjectEncodingOptions);
      }
      throw new Error(`readFileSync not mocked for: ${path}`);
    }),
    writeFileSync: vi.fn((path: fs.PathOrFileDescriptor, data: unknown, options?: unknown) => {
      // Allow golden test to write actual README files
      if (String(path).includes("README") || String(path).includes("playground/22-examples")) {
        return actual.writeFileSync(path, data as string, options as fs.WriteFileOptions);
      }
      throw new Error(`writeFileSync not mocked for: ${path}`);
    }),
    existsSync: vi.fn((path: fs.PathLike) => {
      // Allow golden test to check actual files
      if (String(path).includes("README") || String(path).includes("playground/22-examples")) {
        return actual.existsSync(path);
      }
      return false;
    }),
    mkdirSync: vi.fn((path: fs.PathLike, options?: fs.MakeDirectoryOptions) => {
      // Allow golden test to create directories
      if (String(path).includes("playground/22-examples")) {
        return actual.mkdirSync(path, options);
      }
      throw new Error(`mkdirSync not mocked for: ${path}`);
    }),
  };
});

// Get actual fs module (not mocked)
const realFs = await vi.importActual<typeof fs>("node:fs");

// Shared config for all documentation tests - fileMap is built from this
const baseDocConfig: Omit<GenerateDocConfig, "examples" | "targetCommand"> = {
  command,
  files: { "playground/22-examples/README.md": ["", "read", "write", "check"] },
  formatter: mdFormatter,
};

describe("22-examples", () => {
  let consoleSpy: ConsoleSpy;

  // Initialize doc file before all tests (deletes file when update mode is enabled)
  beforeAll(() => {
    initDocFile(baseDocConfig, realFs);
  });

  beforeEach(() => {
    consoleSpy = spyOnConsoleLog();
    vi.resetAllMocks();

    // By default, delegate to real fs for doc-comparator operations
    vi.mocked(fs.existsSync).mockImplementation((path) => realFs.existsSync(path));
    vi.mocked(fs.readFileSync).mockImplementation((path, options) =>
      realFs.readFileSync(path, options as fs.EncodingOption),
    );
    vi.mocked(fs.writeFileSync).mockImplementation((path, data, options) =>
      realFs.writeFileSync(path, data, options),
    );
    vi.mocked(fs.mkdirSync).mockImplementation((path, options) => realFs.mkdirSync(path, options));
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe("root command", () => {
    describe("documentation", () => {
      it("generates documentation", async () => {
        await assertDocMatch({
          ...baseDocConfig,
          targetCommand: "",
          examples: {},
        });
      });
    });
  });

  describe("read command", () => {
    it("reads file content", async () => {
      vi.mocked(fs.readFileSync).mockReturnValue("file content");

      const result = await runCommand(readCommand, ["test.txt"]);

      expect(result.success).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith("file content");
    });

    it("reads and parses JSON file", async () => {
      vi.mocked(fs.readFileSync).mockReturnValue('{"key": "value"}');

      const result = await runCommand(readCommand, ["config.json", "-f", "json"]);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.result).toEqual({ key: "value" });
      }
    });

    it("documentation", async () => {
      const readFileSyncSpy = vi.mocked(fs.readFileSync);

      await assertDocMatch({
        ...baseDocConfig,
        targetCommand: "read",
        examples: {
          read: {
            mock: () => {
              readFileSyncSpy.mockImplementation((path: fs.PathOrFileDescriptor) => {
                if (path === "config.json") {
                  return '{\n  "name": "my-app",\n  "version": "1.0.0"\n}';
                }
                if (path === "data.txt") {
                  return "Hello from data.txt";
                }
                // Delegate to real fs for other files (like README.md)
                return realFs.readFileSync(path, "utf-8");
              });
            },
            cleanup: () => {
              readFileSyncSpy.mockImplementation((path, options) =>
                realFs.readFileSync(path, options as fs.EncodingOption),
              );
            },
          },
        },
      });
    });
  });

  describe("write command", () => {
    it("writes content to file", async () => {
      vi.mocked(fs.writeFileSync).mockImplementation(() => {});

      const result = await runCommand(writeCommand, ["output.txt", "Hello"]);

      expect(result.success).toBe(true);
      expect(fs.writeFileSync).toHaveBeenCalledWith("output.txt", "Hello", { flag: "w" });
      expect(consoleSpy).toHaveBeenCalledWith("Successfully written to output.txt");
    });

    it("appends content to file", async () => {
      vi.mocked(fs.writeFileSync).mockImplementation(() => {});

      const result = await runCommand(writeCommand, ["log.txt", "entry", "--append"]);

      expect(result.success).toBe(true);
      expect(fs.writeFileSync).toHaveBeenCalledWith("log.txt", "entry", { flag: "a" });
      expect(consoleSpy).toHaveBeenCalledWith("Successfully appended to log.txt");
    });

    it("documentation", async () => {
      const writeFileSyncSpy = vi.mocked(fs.writeFileSync);

      await assertDocMatch({
        ...baseDocConfig,
        targetCommand: "write",
        examples: {
          write: {
            mock: () => {
              writeFileSyncSpy.mockImplementation((path, data, options) => {
                // Ignore writes to example files, but allow doc file writes
                if (String(path).endsWith(".md")) {
                  realFs.writeFileSync(path, data, options);
                }
                // Silently ignore example command writes
              });
            },
            cleanup: () => {
              writeFileSyncSpy.mockImplementation((path, data, options) =>
                realFs.writeFileSync(path, data, options),
              );
            },
          },
        },
      });
    });
  });

  describe("check command", () => {
    it("checks existing file", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const result = await runCommand(checkCommand, ["config.json"]);

      expect(result.success).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith("File exists: config.json");
    });

    it("checks non-existing file", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = await runCommand(checkCommand, ["missing.txt"]);

      expect(result.success).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith("File not found: missing.txt");
    });

    it("documentation", async () => {
      const existsSyncSpy = vi.mocked(fs.existsSync);

      await assertDocMatch({
        ...baseDocConfig,
        targetCommand: "check",
        examples: {
          check: {
            mock: () => {
              existsSyncSpy.mockImplementation((path: fs.PathLike) => {
                // For example files, return mock values
                if (path === "config.json") return true;
                if (path === "missing.txt") return false;
                // Delegate to real fs for other files
                return realFs.existsSync(path);
              });
            },
            cleanup: () => {
              existsSyncSpy.mockImplementation((path) => realFs.existsSync(path));
            },
          },
        },
      });
    });
  });
});
