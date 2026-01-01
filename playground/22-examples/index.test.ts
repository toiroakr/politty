import * as fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { assertDocMatch } from "../../src/docs/index.js";
import { runCommand } from "../../src/index.js";
import { spyOnConsoleLog, type ConsoleSpy } from "../../tests/utils/console.js";
import { oxfmtFormatter } from "../../tests/utils/formatter.js";
import { checkCommand, command, readCommand, writeCommand } from "./index.js";

vi.mock("node:fs");

describe("22-examples", () => {
  let consoleSpy: ConsoleSpy;

  beforeEach(() => {
    consoleSpy = spyOnConsoleLog();
    vi.resetAllMocks();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
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
  });

  describe("documentation", () => {
    let readFileSyncSpy: MockInstance;
    let writeFileSyncSpy: MockInstance;
    let existsSyncSpy: MockInstance;

    beforeEach(() => {
      readFileSyncSpy = vi.mocked(fs.readFileSync);
      writeFileSyncSpy = vi.mocked(fs.writeFileSync);
      existsSyncSpy = vi.mocked(fs.existsSync);
    });

    it("generates documentation with example execution and per-command mocks", async () => {
      await assertDocMatch({
        command,
        files: { "playground/22-examples/README.md": ["", "read", "write", "check"] },
        formatter: oxfmtFormatter,
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
                throw new Error(`File not found: ${path}`);
              });
            },
            cleanup: () => {
              readFileSyncSpy.mockReset();
            },
          },
          write: {
            mock: () => {
              writeFileSyncSpy.mockImplementation(() => {});
            },
            cleanup: () => {
              writeFileSyncSpy.mockReset();
            },
          },
          check: {
            mock: () => {
              existsSyncSpy.mockImplementation((path: fs.PathLike) => {
                return path === "config.json";
              });
            },
            cleanup: () => {
              existsSyncSpy.mockReset();
            },
          },
        },
      });
    });

    it("verifies mocks do not interfere between commands", async () => {
      const readMockValues: string[] = [];
      const writeMockValues: string[] = [];
      const checkMockValues: boolean[] = [];

      await assertDocMatch({
        command,
        files: { "playground/22-examples/README-isolated.md": ["", "read", "write", "check"] },
        formatter: oxfmtFormatter,
        examples: {
          read: {
            mock: () => {
              readFileSyncSpy.mockImplementation((path: fs.PathOrFileDescriptor) => {
                const content = `READ_MOCK_CONTENT_FOR_${path}`;
                readMockValues.push(content);
                return content;
              });
              // Other operations should not be called during read
              writeFileSyncSpy.mockImplementation(() => {
                throw new Error("writeFileSync should not be called during read mock");
              });
              existsSyncSpy.mockImplementation(() => {
                throw new Error("existsSync should not be called during read mock");
              });
            },
            cleanup: () => {
              vi.resetAllMocks();
            },
          },
          write: {
            mock: () => {
              writeFileSyncSpy.mockImplementation((_path, content) => {
                writeMockValues.push(content as string);
              });
              // Other operations should not be called during write
              readFileSyncSpy.mockImplementation(() => {
                throw new Error("readFileSync should not be called during write mock");
              });
              existsSyncSpy.mockImplementation(() => {
                throw new Error("existsSync should not be called during write mock");
              });
            },
            cleanup: () => {
              vi.resetAllMocks();
            },
          },
          check: {
            mock: () => {
              existsSyncSpy.mockImplementation((path: fs.PathLike) => {
                const exists = String(path).includes("config");
                checkMockValues.push(exists);
                return exists;
              });
              // Other operations should not be called during check
              readFileSyncSpy.mockImplementation(() => {
                throw new Error("readFileSync should not be called during check mock");
              });
              writeFileSyncSpy.mockImplementation(() => {
                throw new Error("writeFileSync should not be called during check mock");
              });
            },
            cleanup: () => {
              vi.resetAllMocks();
            },
          },
        },
      });

      // Verify each mock was applied correctly
      expect(readMockValues.length).toBeGreaterThan(0);
      expect(readMockValues.every((v) => v.startsWith("READ_MOCK_CONTENT_FOR_"))).toBe(true);

      expect(writeMockValues.length).toBeGreaterThan(0);

      expect(checkMockValues.length).toBeGreaterThan(0);
      expect(checkMockValues).toContain(true);
      expect(checkMockValues).toContain(false);
    });
  });
});
