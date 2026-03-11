import { spawn } from "child_process";
import { unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const TEMP_APP_PATH = join(__dirname, "temp-signal-app.ts");

const APP_CODE = `
import { defineCommand, runMain } from "../src/index.js";

const command = defineCommand({
  name: "signal-test",
  run: async () => {
    console.log("READY");
    // Keep alive
    await new Promise((resolve) => setTimeout(resolve, 5000));
  },
  cleanup: async () => {
    console.log("CLEANUP_CALLED");
  },
});

runMain(command);
`;

const GLOBAL_LIFECYCLE_APP_CODE = `
import { defineCommand, runMain } from "../src/index.js";

const command = defineCommand({
  name: "signal-test",
  run: async () => {
    console.log("READY");
    await new Promise((resolve) => setTimeout(resolve, 5000));
  },
  cleanup: async ({ error }) => {
    console.log("COMMAND_CLEANUP:" + (error ? error.message : "no-error"));
  },
});

runMain(command, {
  setup: () => {
    console.log("GLOBAL_SETUP");
  },
  cleanup: ({ error }) => {
    console.log("GLOBAL_CLEANUP:" + (error ? error.message : "no-error"));
  },
});
`;

function runSignalApp(
  code: string,
): Promise<{ output: string; errorOutput: string; code: number | null; signal: string | null }> {
  const tempPath = TEMP_APP_PATH;
  writeFileSync(tempPath, code);

  return new Promise((resolve, reject) => {
    const child = spawn("node", ["--import", "tsx/esm", tempPath], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: join(__dirname, ".."),
      detached: true,
    });

    let output = "";
    let errorOutput = "";
    let ready = false;

    child.stdout.on("data", (data) => {
      const str = data.toString();
      output += str;
      if (str.includes("READY") && !ready) {
        ready = true;
        process.kill(-child.pid!, "SIGINT");
      }
    });

    child.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });

    child.on("close", (code, signal) => {
      try {
        unlinkSync(tempPath);
      } catch {}
      resolve({ output, errorOutput, code, signal });
    });

    child.on("error", (err) => {
      try {
        unlinkSync(tempPath);
      } catch {}
      reject(err);
    });
  });
}

describe("Signal Handling", () => {
  it("should run cleanup on SIGINT", async () => {
    const { output, code, signal } = await runSignalApp(APP_CODE);

    expect(output).toContain("CLEANUP_CALLED");
    if (code !== null) {
      expect([1, 130]).toContain(code);
    } else {
      expect(signal).toBe("SIGINT");
    }
  }, 10000);

  it("should pass error to per-command cleanup and run global cleanup on signal", async () => {
    const { output, code, signal } = await runSignalApp(GLOBAL_LIFECYCLE_APP_CODE);

    expect(output).toContain("GLOBAL_SETUP");
    expect(output).toContain("COMMAND_CLEANUP:Process interrupted");
    expect(output).toContain("GLOBAL_CLEANUP:Process interrupted");
    if (code !== null) {
      expect([1, 130]).toContain(code);
    } else {
      expect(signal).toBe("SIGINT");
    }
  }, 10000);
});
