/**
 * analytics-command.ts - Another lazy loaded command
 *
 * Demonstrates lazy loading for analytics functionality.
 */

import { z } from "zod";
import { arg, defineCommand } from "../../../src/index.js";

// Simulate loading heavy analytics dependencies
console.log("[analytics-command] Module loaded");

export const analyticsCommand = defineCommand({
  name: "analytics",
  description: "Analyze project metrics (lazily loaded)",
  args: z.object({
    metric: arg(z.enum(["lines", "files", "complexity"]).default("lines"), {
      alias: "m",
      description: "Metric to analyze",
    }),
    format: arg(z.enum(["text", "json"]).default("text"), {
      alias: "f",
      description: "Output format",
    }),
  }),
  run: ({ metric, format }) => {
    const data = {
      lines: 12500,
      files: 87,
      complexity: 4.2,
    };

    if (format === "json") {
      console.log(JSON.stringify({ metric, value: data[metric] }, null, 2));
    } else {
      console.log(`${metric}: ${data[metric]}`);
    }
  },
});
