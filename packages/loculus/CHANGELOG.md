# @politty/loculus

## 0.2.1

### Patch Changes

- 3cc227e: Read the value of a value-taking short option attached to it (`-c5`) or combined with other short options (`-ac5`, `-ac 5`), instead of reading every character as a boolean flag. `parseArgv` does this for the options in its new `valueFlags` option.

  Read combined short options that are all global, such as `-vq` or `-n5`, as global options before and after a subcommand. Before, they stopped subcommand detection before a subcommand and were dropped after it. Combined short options that mix global and command options are still read by the command. Dynamic completion reads combined short options the same way.

  Read a negative number after a global option (`-n -5`, `--name -5`, `-vn -5`) as its value, as the command's own options already do. Before, it stopped subcommand detection before a subcommand and left the option without a value after it. Dynamic completion reads it the same way.

## 0.2.0

### Minor Changes

- 4d16b88: Check the options given to a command group run without a subcommand before showing its help or running its `defaultSubCommand`. An invalid global option value, given as a flag or through its environment variable, now exits with 2 instead of printing the help, while a missing required global option still shows it. An unknown flag is rejected by a strict `unknownKeys` mode instead of being ignored. Other modes drop it with a warning (strip) or silently (passthrough) and then run the group as if it was not given, including its `defaultSubCommand`. A group without its own `args` reports flag-like tokens as unknown flags handled by the `globalArgs` schema's mode, instead of as unexpected positional arguments that left it printing nothing. A group never reads the token after an unknown flag as the flag's value: `cli --bogus value` reports `value` as an unknown subcommand like `cli value`, `cli --dry-rn deploy` does not run the `defaultSubCommand`, and `cli --bogus=value` drops the flag with its value.

### Patch Changes

- 5a69178: Stop the `prompt/inquirer` resolver from submitting an argument's help `placeholder` (e.g. `FILE`) as its value when the user presses Enter on an empty text prompt. The placeholder is no longer passed to inquirer as `default`, so empty input gives `""` as with the `prompt/clack` resolver. inquirer has no hint-only option, so the inquirer prompt no longer shows the placeholder.

## 0.1.1

### Patch Changes

- b35de48: Add the Loculus adapter with inferred command types, argument metadata, defaults, environment fallbacks, typed literal choices, discriminated unions, shell completion, help, docs, prompts, agent helpers and CLI entry points.

  Require `loculus ^0.2.4` to preserve scalar discriminator conversion and refinement/transform callbacks in wrapped composites. Support optional build-time optimization with `@loculus/rolldown` 0.2.2 or newer in the 0.2 line, preserving post-bundle execution and generated help, docs and completion.

- 4f7ec00: Support Node.js 22.18.0 and newer with the Loculus adapter and compile its output for that Node.js version. Require loculus ^0.2.5, whose declared Node.js requirement includes Node.js 22.18.0.
