import { beforeEach, describe, expect, it, vi } from "vitest";
import { enableCompileCache } from "../compile-cache.js";
import { defineCommand } from "./command.js";
import { runMain } from "./runner.js";

vi.mock("../compile-cache.js", () => ({
  enableCompileCache: vi.fn(() => ({ enabled: true })),
}));

const useArgv = (argv: string[]) => {
  const originalArgv = process.argv;
  process.argv = argv;
  return {
    [Symbol.dispose]() {
      process.argv = originalArgv;
    },
  };
};

describe("runMain compile cache wiring", () => {
  beforeEach(() => {
    vi.mocked(enableCompileCache).mockClear();
  });

  it("enables the cache with the command name by default", async () => {
    using _argv = useArgv(["node", "mycli"]);
    using _exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    const cmd = defineCommand({ name: "mycli", run: () => {} });
    await runMain(cmd);

    expect(enableCompileCache).toHaveBeenCalledTimes(1);
    expect(enableCompileCache).toHaveBeenCalledWith({ programName: "mycli" });
  });

  it("passes a custom cache directory through", async () => {
    using _argv = useArgv(["node", "mycli"]);
    using _exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    const cmd = defineCommand({ name: "mycli", run: () => {} });
    await runMain(cmd, { compileCache: "/custom/cache-dir" });

    expect(enableCompileCache).toHaveBeenCalledWith({ cacheDir: "/custom/cache-dir" });
  });

  it("skips enabling when compileCache is false", async () => {
    using _argv = useArgv(["node", "mycli"]);
    using _exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    const cmd = defineCommand({ name: "mycli", run: () => {} });
    await runMain(cmd, { compileCache: false });

    expect(enableCompileCache).not.toHaveBeenCalled();
  });
});
