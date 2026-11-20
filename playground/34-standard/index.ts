import { pathToFileURL } from "node:url";
import * as z from "zod/mini";
import { defineCommand, runMain, standardArgs } from "../../packages/standard/src/index.js";

const schema = z.strictObject({
  config: z.string().register(z.globalRegistry, { description: "Path to the config file" }),
  port: z.coerce.number().check(z.minimum(1), z.maximum(65535), z.multipleOf(1)),
  level: z._default(z.enum(["debug", "info", "warn"]), "info"),
  color: z._default(z.boolean(), true),
});

export const command = defineCommand({
  name: "serve",
  description: "Serve a project using Standard Schema and a separate JSON Schema converter",
  args: standardArgs(schema, {
    jsonSchema: {
      "~standard": {
        version: 1,
        jsonSchema: {
          input: ({ target }) => z.toJSONSchema(schema, { io: "input", target }),
        },
      },
    },
    fields: {
      config: { positional: true },
      port: { alias: "p", description: "Port number (1-65535)" },
      level: { alias: "L", description: "Log level", env: "SERVE_LOG_LEVEL" },
      color: { description: "Colorize output", negation: true },
    },
  }),
  run: ({ config, port, level, color }) => {
    const label = color ? `[${level}]` : level;
    console.log(`${label} serving ${config} on port ${port}`);
  },
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runMain(command, { version: "1.0.0" });
}
