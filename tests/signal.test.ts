import { describe, it, expect } from "vitest";
import { spawn } from "child_process";
import { join } from "path";
import { writeFileSync, unlinkSync } from "fs";

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

runMain(command, { handleSignals: true });
`;

describe("Signal Handling", () => {
  it("should run cleanup on SIGINT", async () => {
    // Create temp app
    writeFileSync(TEMP_APP_PATH, APP_CODE);

    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn("npx", ["tsx", TEMP_APP_PATH], {
          stdio: ["ignore", "pipe", "pipe"],
          cwd: join(__dirname, ".."), // Run from project root
          detached: false, // Ensure we can kill it
        });

        let output = "";
        let errorOutput = "";
        let ready = false;

        child.stdout.on("data", (data) => {
          const str = data.toString();
          output += str;
          if (str.includes("READY") && !ready) {
            ready = true;
            // Send SIGINT
            child.kill("SIGINT");
          }
        });

        child.stderr.on("data", (data) => {
          errorOutput += data.toString();
        });

        child.on("close", (code) => {
          try {
            expect(output).toContain("CLEANUP_CALLED");
            expect(code).toBe(1); // Should exit with 1 as per implementation
            resolve();
          } catch (e) {
            console.error("STDOUT:", output);
            console.error("STDERR:", errorOutput);
            reject(e);
          }
        });

        child.on("error", (err) => {
          reject(err);
        });
      });
    } finally {
      // Cleanup temp file
      try {
        unlinkSync(TEMP_APP_PATH);
      } catch {}
    }
  }, 10000);

  it("should NOT run cleanup on SIGINT when handleSignals is false", async () => {
    // Create temp app without handleSignals
    const APP_CODE_NO_HANDLE = `
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

runMain(command, { handleSignals: false });
`;
    writeFileSync(TEMP_APP_PATH, APP_CODE_NO_HANDLE);

    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn("npx", ["tsx", TEMP_APP_PATH], {
          stdio: ["ignore", "pipe", "pipe"],
          cwd: join(__dirname, ".."),
          detached: false,
        });

        let output = "";
        let ready = false;

        child.stdout.on("data", (data) => {
          const str = data.toString();
          output += str;
          if (str.includes("READY") && !ready) {
            ready = true;
            // Send SIGINT
            child.kill("SIGINT");
          }
        });

        child.on("close", (code, signal) => {
          try {
            expect(output).not.toContain("CLEANUP_CALLED");
            // When killed by signal, code is null and signal is SIGINT (or similar)
            // Or sometimes code is 128+signal depending on platform/shell, but node child_process usually gives signal
            // We just care that cleanup wasn't called.
            resolve();
          } catch (e) {
            reject(e);
          }
        });

        child.on("error", (err) => {
          reject(err);
        });
      });
    } finally {
      try {
        unlinkSync(TEMP_APP_PATH);
      } catch {}
    }
  }, 10000);
});
