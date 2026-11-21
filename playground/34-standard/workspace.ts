import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  arg,
  defineCommand,
  runMain,
  standardArgs,
  unflatten,
  withCompletionCommand,
} from "../../packages/standard/src/index.js";

const read = defineCommand({
  name: "read",
  description: "Select a local file or a URL",
  args: z.union([z.object({ file: z.string() }), z.object({ url: z.string().url() })]),
  run: (args) => console.log("file" in args ? args.file : args.url),
});

const publish = defineCommand({
  name: "publish",
  description: "Combine destination options with release options",
  args: z.intersection(
    z.object({ destination: z.enum(["preview", "prod"]) }),
    z.object({ releaseVersion: z.string(), dryRun: z.boolean().default(false) }),
  ),
  run: ({ destination, releaseVersion, dryRun }) =>
    console.log(`${releaseVersion} → ${destination}${dryRun ? " (dry run)" : ""}`),
});

const port = arg(z.coerce.number().int().min(1).max(65535), { alias: "p" });
const connect = defineCommand({
  name: "connect",
  description: "Read flat options into a nested database configuration",
  args: unflatten(
    standardArgs(
      z.object({
        "db.host": z.string().default("localhost"),
        "db.port": port,
      }),
      {
        fields: { "db.port": port },
      },
    ),
  ),
  run: ({ db }) => console.log(`${db.host}:${db.port}`),
});

export const workspace = withCompletionCommand(
  defineCommand({ name: "workspace", subCommands: { read, publish, connect } }),
);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runMain(workspace);
}
