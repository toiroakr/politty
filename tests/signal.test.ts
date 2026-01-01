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

        child.on("close", (code, signal) => {
          try {
            expect(output).toContain("CLEANUP_CALLED");
            // Exit code can be 1 (normal cleanup), null (killed by signal in containers),
            // or 130 (128 + SIGINT) depending on environment
            if (code !== null) {
              expect([1, 130]).toContain(code);
            } else {
              // In container environments, code can be null when killed by signal
              expect(signal).toBe("SIGINT");
            }
            resolve();
          } catch (e) {
            console.error("STDOUT:", output);
            console.error("STDERR:", errorOutput);
            console.error("EXIT CODE:", code, "SIGNAL:", signal);
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
});
