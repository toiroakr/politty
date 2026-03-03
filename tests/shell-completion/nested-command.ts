/**
 * Test fixture: 3-level nested subcommand command for shell completion tests.
 *
 * Structure:
 *   nested-test
 *     └── config
 *           ├── user
 *           │     ├── get  (positional: key)
 *           │     └── set  (positional: key, value; option: --global)
 *           └── core
 *                 ├── get  (positional: key)
 *                 └── set  (positional: key, value)
 */

import { z } from "zod";
import { arg, defineCommand, runMain, withCompletionCommand } from "../../src/index.js";

const getArgs = z.object({
  key: arg(z.string(), { positional: true, description: "Config key" }),
});

const setArgs = z.object({
  key: arg(z.string(), { positional: true, description: "Config key" }),
  value: arg(z.string(), { positional: true, description: "Config value" }),
});

const configUserCommand = defineCommand({
  name: "user",
  description: "Manage user settings",
  subCommands: {
    get: defineCommand({
      name: "get",
      description: "Get user config value",
      args: getArgs,
      run: () => {},
    }),
    set: defineCommand({
      name: "set",
      description: "Set user config value",
      args: setArgs.extend({
        global: arg(z.boolean().default(false), {
          alias: "g",
          description: "Save as global configuration",
        }),
      }),
      run: () => {},
    }),
  },
});

const configCoreCommand = defineCommand({
  name: "core",
  description: "Manage core settings",
  subCommands: {
    get: defineCommand({
      name: "get",
      description: "Get core config value",
      args: getArgs,
      run: () => {},
    }),
    set: defineCommand({
      name: "set",
      description: "Set core config value",
      args: setArgs,
      run: () => {},
    }),
  },
});

const configCommand = defineCommand({
  name: "config",
  description: "Manage configuration",
  subCommands: { user: configUserCommand, core: configCoreCommand },
});

const cli = withCompletionCommand(
  defineCommand({
    name: "nested-test",
    description: "Test fixture for nested subcommand completion",
    subCommands: { config: configCommand },
  }),
);

runMain(cli, { version: "0.0.0" });
