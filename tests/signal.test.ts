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
});
