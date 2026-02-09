# Documentation Generator

A system that automatically generates Markdown documentation from CLI commands defined with `defineCommand` and validates consistency with golden tests.

## Quick Start

```typescript
import { describe, it } from "vitest";
import { assertDocMatch } from "politty/docs";
import { command } from "./my-command.js";

describe("my-command", () => {
  it("documentation", async () => {
    await assertDocMatch({
      command,
      files: { "path/to/README.md": [""] },
    });
  });
});
```

### Updating Documentation

Tests fail when there are differences. Set the environment variable and run tests to update files:

```bash
POLITTY_DOCS_UPDATE=true pnpm test
```

## API

### `assertDocMatch(config)`

Validates that documentation matches the golden file. Throws an error if there are differences and `POLITTY_DOCS_UPDATE` is not set.

```typescript
import { assertDocMatch } from "politty/docs";

await assertDocMatch({
  command: myCommand,
  files: {
    "docs/cli.md": [""], // Root command only
  },
});
```

### `generateDoc(config)`

Generates documentation and returns the result. Does not perform assertions.

```typescript
import { generateDoc } from "politty/docs";

const result = await generateDoc({
  command: myCommand,
  files: { "docs/cli.md": [""] },
});

console.log(result.success); // true or false
console.log(result.files); // Status for each file
```

## Configuration

### `GenerateDocConfig`

| Property         | Type                     | Description                                                      |
| ---------------- | ------------------------ | ---------------------------------------------------------------- |
| `command`        | `AnyCommand`             | Command to generate documentation for                            |
| `files`          | `FileMapping`            | Mapping of file paths to commands (use `path` for simpler cases) |
| `path`           | `PathConfig`             | Simplified path config (alternative to `files`)                  |
| `ignores`        | `string[]`               | Command paths to exclude (with subcommands)                      |
| `format`         | `DefaultRendererOptions` | Options for default renderer                                     |
| `formatter`      | `FormatterFunction`      | Formatter for generated content                                  |
| `examples`       | `ExampleConfig`          | Example execution settings per command                           |
| `targetCommands` | `string[]`               | Specific commands to validate/generate (for partial updates)     |
| `globalArgs`     | `ArgsSchema`             | Global arguments schema (adds Global Options section)            |
| `rootInfo`       | `RootCommandInfo`        | Root command info (title, header, footer)                        |

### `path` (Simplified Path Configuration)

For common use cases, use `path` instead of `files`:

```typescript
// Single file for all commands
await assertDocMatch({
  command: cli,
  path: "docs/cli.md",
});

// Split files with explicit mapping
await assertDocMatch({
  command: cli,
  path: {
    root: "docs/README.md",
    commands: {
      build: "docs/build.md",
      deploy: "docs/deploy.md",
    },
  },
});
```

| Form                       | Description                                    |
| -------------------------- | ---------------------------------------------- |
| `path: "docs/cli.md"`      | All commands in a single file                  |
| `path: { root, commands }` | Root in `root` file, subcommands in `commands` |

For advanced configurations (custom render per file, wildcards), use `files` instead.

### `FileMapping`

Specify command path arrays with file paths as keys. **Subcommands of specified commands are automatically included.**

```typescript
const files: FileMapping = {
  // Specifying root command includes all subcommands
  "docs/cli.md": [""],

  // Splitting into multiple files
  "docs/cli.md": ["", "user"],
  "docs/cli/config.md": ["config"], // config get, config set are also included

  // Using wildcards
  "docs/config-commands.md": ["config *"], // Only direct children of config
};
```

- Keys are file paths
- Values are arrays of command paths (`""` is root command, `"config get"` is space-separated subcommand path)
- **Subcommands are automatically included** (specifying `"config"` includes `"config get"`, `"config set"`)
- **Wildcard `*`**: Matches any single command segment (see below)
- Passing a `FileConfig` object as value allows specifying a custom renderer
- **Links to other files**: When subcommands are output to different files, relative path links are automatically generated

```typescript
// Example: Splitting config subcommand to separate file
const files: FileMapping = {
  "docs/cli.md": [""], // Link to config becomes config.md#config
  "docs/config.md": ["config"], // config get, config set are same-file anchors
};
```

### `FileConfig`

```typescript
interface FileConfig {
  commands: string[]; // Array of command paths to include
  render?: RenderFunction; // Custom renderer (optional)
}
```

### `ignores`

Excludes specific commands and their subcommands from documentation generation:

```typescript
await assertDocMatch({
  command: cli,
  files: { "docs/cli.md": [""] },
  ignores: ["internal", "debug"], // Exclude internal, debug and their subcommands
});
```

- Commands specified in `ignores` and their subcommands are automatically excluded
- **Wildcard `*`**: Matches any single command segment (see below)
- Error if commands specified in both `files` and `ignores` overlap
- Error if specifying non-existent command paths

```typescript
// Error: "config" specified in both files and ignores
await assertDocMatch({
  command: cli,
  files: { "docs/cli.md": ["config"] },
  ignores: ["config"], // Error!
});
```

### Wildcard Patterns

Wildcard `*` can be used in `files` and `ignores`. `*` matches any single command segment (name).

| Pattern    | Matches                    | Description                           |
| ---------- | -------------------------- | ------------------------------------- |
| `*`        | `greet`, `config`          | All top-level commands                |
| `* *`      | `config get`, `config set` | Depth 2 commands (nested subcommands) |
| `config *` | `config get`, `config set` | Direct children of config             |
| `* * *`    | `config get key`           | Depth 3 commands                      |

**Subcommands of wildcard-matched commands are also automatically included** (same as normal command path specification).

```typescript
// Exclude only nested subcommands
await assertDocMatch({
  command: cli,
  files: { "docs/cli.md": [""] },
  ignores: ["* *"], // Exclude config get, config set etc. at depth 2+
});

// Put specific parent's children in separate file
await assertDocMatch({
  command: cli,
  files: {
    "docs/cli.md": [""],
    "docs/config.md": ["config *"], // Only config get, config set
  },
  ignores: ["config *"], // Exclude config children from main file
});

// Exclude "two" from all subcommands
await assertDocMatch({
  command: cli,
  files: { "docs/cli.md": ["*"] }, // All top-level commands
  ignores: ["* two"], // Exclude alpha two, beta two
});
```

- Error if wildcard pattern matches no commands

### `examples`

Executes `examples` defined in `defineCommand` and includes output in documentation. Mocks can be set per command:

```typescript
import * as fs from "node:fs";
import { vi } from "vitest";

vi.mock("node:fs");

await assertDocMatch({
  command: cli,
  files: { "docs/cli.md": ["", "read", "write"] },
  examples: {
    // read command: Mock file reading
    read: {
      mock: () => {
        vi.mocked(fs.readFileSync).mockImplementation((path) => {
          if (path === "config.json") return '{"name": "app"}';
          throw new Error(`File not found: ${path}`);
        });
      },
      cleanup: () => {
        vi.mocked(fs.readFileSync).mockReset();
      },
    },
    // write command: Mock file writing
    write: {
      mock: () => {
        vi.mocked(fs.writeFileSync).mockImplementation(() => {});
      },
      cleanup: () => {
        vi.mocked(fs.writeFileSync).mockReset();
      },
    },
  },
});
```

### `ExampleConfig`

| Property  | Type                          | Description                               |
| --------- | ----------------------------- | ----------------------------------------- |
| `mock`    | `() => void \| Promise<void>` | Mock setup function called before example |
| `cleanup` | `() => void \| Promise<void>` | Cleanup function called after example     |

- Examples for command paths specified in `examples` are executed
- Each command processes in order: `mock` → execute examples → `cleanup`
- Mocks don't interfere between commands (reset in `cleanup`)

### `targetCommands`

Validates/generates only specific command sections. Used when isolating tests per command:

```typescript
// Validate/generate only read command section
await assertDocMatch({
  command: cli,
  files: { "docs/cli.md": ["", "read", "write"] },
  targetCommands: ["read"],
  examples: {
    read: {
      mock: () => {
        /* ... */
      },
      cleanup: () => {
        /* ... */
      },
    },
  },
});

// Validate/generate multiple commands simultaneously
await assertDocMatch({
  command: cli,
  files: { "docs/cli.md": ["", "read", "write"] },
  targetCommands: ["read", "write"],
  examples: {
    read: {
      mock: () => {
        /* ... */
      },
      cleanup: () => {
        /* ... */
      },
    },
    write: {
      mock: () => {
        /* ... */
      },
      cleanup: () => {
        /* ... */
      },
    },
  },
});
```

- When `targetCommands` is specified, only those command sections are generated/validated
- **Subcommand recursive expansion**: Subcommands of specified commands are also automatically generated
  - However, commands explicitly specified in `files` are excluded (generated individually with `targetCommands`)
- Other command sections are preserved as-is if they exist in the file
- If section doesn't exist, inserted at correct position based on order in `files`
- Use empty string `""` to specify root command
- Commands spanning multiple files can be specified together

```typescript
// Subcommand recursive expansion example
// cli: root -> read, write, check, delete (subcommands)
await assertDocMatch({
  command: cli,
  files: { "docs/cli.md": ["", "read", "write", "check"] },
  targetCommands: [""], // Specify root command
  examples: {},
});
// Result:
// - "" (root) section is generated
// - "delete" section is also generated (subcommand not explicitly in files)
// - "read", "write", "check" are not generated (explicitly in files, generated in individual tests)
```

### `globalArgs`

Adds a "Global Options" section to the documentation. For root commands, displays the full options table. For subcommands, displays a link to the Global Options section.

```typescript
const globalArgsSchema = z.object({
  verbose: arg(z.boolean().default(false), { alias: "v", description: "Verbose output" }),
  config: arg(z.string().optional(), { alias: "c", description: "Config file path" }),
});

await assertDocMatch({
  command: cli,
  files: { "docs/cli.md": [""] },
  globalArgs: globalArgsSchema,
});
```

Generated output for root command:

```markdown
**Global Options**

| Option              | Alias | Description      | Required | Default |
| ------------------- | ----- | ---------------- | -------- | ------- |
| `--verbose`         | `-v`  | Verbose output   | No       | `false` |
| `--config <CONFIG>` | `-c`  | Config file path | No       | -       |
```

Generated output for subcommands:

```markdown
See [Global Options](#global-options) for options available to all commands.
```

When documentation is split across multiple files, cross-file links are automatically generated:

```markdown
See [Global Options](../cli.md#global-options) for options available to all commands.
```

### `rootInfo`

Adds CLI overview content to the root command documentation.

````typescript
await assertDocMatch({
  command: cli,
  files: { "docs/cli.md": [""] },
  globalArgs: globalArgsSchema,
  rootInfo: {
    title: "My CLI", // Defaults to command.name
    description: "A powerful CLI tool", // Defaults to command.description
    header:
      "## Installation\n\n```bash\nnpm install -g my-cli\n```\n\n> **Note**: Requires Node.js 18+",
    footer: "## License\n\nMIT License",
  },
});
````

| Property      | Type                  | Description                                                   |
| ------------- | --------------------- | ------------------------------------------------------------- |
| `title`       | `string \| undefined` | CLI title (defaults to `command.name`)                        |
| `description` | `string \| undefined` | CLI description (defaults to `command.description`)           |
| `header`      | `string \| undefined` | Custom markdown after title/description, before Usage section |
| `footer`      | `string \| undefined` | Custom markdown at the very end of the document               |

Generated output:

````markdown
# My CLI

A powerful CLI tool

## Installation

```bash
npm install -g my-cli
```

> **Note**: Requires Node.js 18+

**Usage**

...

## License

MIT License
````

### `initDocFile(config, fileSystem?)`

Initializes (deletes) documentation files at test start. Call in `beforeAll` to ensure skipped test sections don't remain:

```typescript
import { initDocFile } from "politty/docs";

const docConfig = {
  command,
  files: { "docs/cli.md": ["", "sub1", "sub2"] },
};

describe("my-cli", () => {
  beforeAll(() => {
    initDocFile(docConfig); // Initialize all files in files
  });

  // Tests for each command...
});
```

- First argument is an object containing `{ files: ... }`, or a single file path string
- Deletes files only when `POLITTY_DOCS_UPDATE=true`
- Does nothing during normal test runs (validates existing files)
- When mocking fs, pass `realFs` as second argument:

```typescript
const realFs = await vi.importActual<typeof fs>("node:fs");

beforeAll(() => {
  initDocFile(docConfig, realFs);
});
```

### `examples` Field in `defineCommand`

Add usage examples when defining commands:

```typescript
const readCommand = defineCommand({
  name: "read",
  args: z.object({
    file: arg(z.string(), { positional: true }),
  }),
  examples: [
    { cmd: "config.json", desc: "Read a JSON config file" },
    { cmd: "data.txt -f text", desc: "Read a text file" },
  ],
  run: (args) => {
    const content = fs.readFileSync(args.file, "utf-8");
    console.log(content);
  },
});
```

Generated Markdown:

````markdown
**Examples**

**Read a JSON config file**

```bash
$ config.json
{"name": "app"}
```

**Read a text file**

```bash
$ data.txt -f text
Hello from data.txt
```
````

## Customization

### Default Renderer Options

Customize default renderer output:

```typescript
await assertDocMatch({
  command: cli,
  files: { "docs/cli.md": [""] },
  format: {
    headingLevel: 2, // Heading level (default: 1)
    optionStyle: "list", // "table" or "list"
    generateAnchors: true, // Anchor links to subcommands
    includeSubcommandDetails: true, // Include subcommand details
  },
});
```

#### Automatic Heading Level Adjustment

Subcommand heading levels are **relatively adjusted within the file** based on command depth:

- The shallowest command in the file uses `headingLevel`
- Deeper subcommands have sequentially lower levels

```markdown
<!-- docs/cli.md: When including root command -->

# my-cli ← depth=1, headingLevel

## config ← depth=2, headingLevel+1

### config get ← depth=3, headingLevel+2

<!-- docs/config.md: When subcommands only -->

# config ← depth=2 but shallowest in this file, so headingLevel

## config get ← depth=3, headingLevel+1
```

Subcommand titles display the full path (e.g., `config get`).

### Custom Section Renderers

Customize rendering for each section. `render*` functions receive default content and return final content:

```typescript
import { createCommandRenderer } from "politty/docs";

const customRenderer = createCommandRenderer({
  // Add Examples after options section
  renderOptions: (defaultContent, info) => `${defaultContent}

**Examples**

\`\`\`bash
${info.fullCommandPath} --help
\`\`\``,
});

await assertDocMatch({
  command: cli,
  files: {
    "docs/cli.md": { commands: [""], render: customRenderer },
  },
});
```

Return empty string to hide a section:

```typescript
const customRenderer = createCommandRenderer({
  renderArguments: () => "", // Hide arguments section
});
```

Available render functions:

- `renderDescription` - Description section
- `renderUsage` - Usage section
- `renderArguments` - Arguments section
- `renderOptions` - Options section
- `renderSubcommands` - Subcommands section
- `renderFooter` - Footer (empty by default)

### Fully Custom Renderer

Generate completely custom Markdown:

```typescript
import type { RenderFunction, CommandInfo } from "politty/docs";

const myRenderer: RenderFunction = (info: CommandInfo) =>
  `
# ${info.name}

${info.description ?? ""}

**Usage**

\`\`\`
${info.fullCommandPath}
\`\`\`
`.trim();
```

### `CommandInfo`

Command information passed to render functions:

| Property          | Type                                  | Description                                        |
| ----------------- | ------------------------------------- | -------------------------------------------------- |
| `name`            | `string`                              | Command name                                       |
| `description`     | `string \| undefined`                 | Command description                                |
| `fullCommandPath` | `string`                              | Full command path (e.g., `"my-cli config get"`)    |
| `commandPath`     | `string`                              | Command path (e.g., `"config get"`, `""` for root) |
| `depth`           | `number`                              | Command depth (root=1, subcommand=2, etc.)         |
| `positionalArgs`  | `ResolvedFieldMeta[]`                 | Array of positional arguments                      |
| `options`         | `ResolvedFieldMeta[]`                 | Array of options (non-positional arguments)        |
| `subCommands`     | `SubCommandInfo[]`                    | Array of subcommand info                           |
| `extracted`       | `ExtractedFields \| null`             | Field info extracted from schema                   |
| `command`         | `AnyCommand`                          | Original command object                            |
| `filePath`        | `string \| undefined`                 | File path where this command is output             |
| `fileMap`         | `Record<string, string> \| undefined` | Map of command path → file path                    |

### `SubCommandInfo`

Subcommand information:

| Property       | Type                  | Description               |
| -------------- | --------------------- | ------------------------- |
| `name`         | `string`              | Subcommand name           |
| `description`  | `string \| undefined` | Subcommand description    |
| `relativePath` | `string[]`            | Relative path from parent |
| `fullPath`     | `string[]`            | Full command path array   |

### `ResolvedFieldMeta`

Argument/option metadata:

| Property       | Type                  | Description                          |
| -------------- | --------------------- | ------------------------------------ |
| `name`         | `string`              | Field name                           |
| `description`  | `string \| undefined` | Description                          |
| `alias`        | `string \| undefined` | Short alias (e.g., `"v"`)            |
| `type`         | `string`              | Type (`"string"`, `"boolean"`, etc.) |
| `required`     | `boolean`             | Whether required                     |
| `defaultValue` | `unknown`             | Default value                        |
| `positional`   | `boolean`             | Whether positional argument          |
| `placeholder`  | `string \| undefined` | Placeholder (e.g., `"FILE"`)         |

## Generated Markdown Format

The default renderer generates Markdown in the following format. Subcommand titles display full paths, and heading levels are automatically adjusted by depth:

````markdown
# command-name

Command description

**Usage**

```
command-name [options] <arg>
```

**Arguments**

| Argument | Description          | Required |
| -------- | -------------------- | -------- |
| `arg`    | Argument description | Yes      |

**Options**

| Option             | Alias | Description        | Default     |
| ------------------ | ----- | ------------------ | ----------- |
| `--option <VALUE>` | `-o`  | Option description | `"default"` |
| `--help`           | `-h`  | Show help          | -           |

**Commands**

| Command                     | Description            |
| --------------------------- | ---------------------- |
| [`subcommand`](#subcommand) | Subcommand description |

## subcommand

Subcommand description

**Usage**

```
command-name subcommand [options]
```

**Commands**

| Command                                   | Description       |
| ----------------------------------------- | ----------------- |
| [`subcommand action`](#subcommand-action) | Nested subcommand |

### subcommand action

Nested subcommand description

**Usage**

```
command-name subcommand action
```
````

## Environment Variables

| Variable              | Description                                              |
| --------------------- | -------------------------------------------------------- |
| `POLITTY_DOCS_UPDATE` | Set to `true` or `1` to enable documentation update mode |

## Example: Playground Tests

### Simple Example

Example implementing documentation tests for each playground command:

```typescript
// playground/01-hello-world/index.test.ts
import { describe, it } from "vitest";
import { assertDocMatch } from "../../src/docs/index.js";
import { command } from "./index.js";

describe("01-hello-world", () => {
  // ... other tests ...

  it("documentation", async () => {
    await assertDocMatch({
      command,
      files: { "playground/01-hello-world/README.md": [""] },
    });
  });
});
```

### Example: Isolating Tests Per Command

When there are multiple subcommands with different mock requirements, use `targetCommands` and `initDocFile` to isolate tests:

```typescript
// playground/22-examples/index.test.ts
import * as fs from "node:fs";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assertDocMatch, initDocFile, type GenerateDocConfig } from "politty/docs";
import { command, readCommand, writeCommand, checkCommand } from "./index.js";

vi.mock("node:fs");
const realFs = await vi.importActual<typeof fs>("node:fs");

const baseDocConfig: Omit<GenerateDocConfig, "examples" | "targetCommands"> = {
  command,
  files: { "playground/22-examples/README.md": ["", "read", "write", "check"] },
};

describe("22-examples", () => {
  // Initialize documentation file at test start (pass realFs when mocking fs)
  beforeAll(() => {
    initDocFile(baseDocConfig, realFs);
  });

  beforeEach(() => {
    vi.resetAllMocks();
    // Delegate to realFs
    vi.mocked(fs.existsSync).mockImplementation((path) => realFs.existsSync(path));
    vi.mocked(fs.readFileSync).mockImplementation((path, opts) =>
      realFs.readFileSync(path, opts as fs.EncodingOption),
    );
    vi.mocked(fs.writeFileSync).mockImplementation((path, data, opts) =>
      realFs.writeFileSync(path, data, opts),
    );
  });

  describe("root command", () => {
    it("documentation", async () => {
      await assertDocMatch({
        ...baseDocConfig,
        targetCommands: [""], // Root command
        examples: {},
      });
    });
  });

  describe("read command", () => {
    it("reads file content", async () => {
      vi.mocked(fs.readFileSync).mockReturnValue("file content");
      // ... test
    });

    it("documentation", async () => {
      await assertDocMatch({
        ...baseDocConfig,
        targetCommands: ["read"],
        examples: {
          read: {
            mock: () => {
              vi.mocked(fs.readFileSync).mockImplementation((path) => {
                if (path === "config.json") return '{"name": "app"}';
                return realFs.readFileSync(path, "utf-8");
              });
            },
            cleanup: () => {
              vi.mocked(fs.readFileSync).mockImplementation((path, opts) =>
                realFs.readFileSync(path, opts as fs.EncodingOption),
              );
            },
          },
        },
      });
    });
  });

  describe("write command", () => {
    // ... same pattern
  });
});
```

Benefits of this pattern:

- Independent mocks per command: Different mock settings possible for `read` and `write` commands
- Skipped tests reflected: When a test is skipped, that command's section is not generated
- Order preserved: Sections are placed in the order specified in `files`
- Idempotent: Same results no matter how many times executed

## Exports

### Main API

- `assertDocMatch` - Golden test assertion
- `generateDoc` - Documentation generation
- `initDocFile` - Documentation file initialization (deletes files in update mode)

### Utilities

- `buildCommandInfo` - Build command information
- `collectAllCommands` - Collect all commands
- `resolveSubcommand` - Resolve lazy subcommands

### Renderers

- `createCommandRenderer` - Create custom renderer
- `defaultRenderers` - Default renderer presets
- `renderUsage` - Usage generation
- `renderArgumentsTable` / `renderArgumentsList` - Argument rendering
- `renderOptionsTable` / `renderOptionsList` - Option rendering
- `renderSubcommandsTable` - Subcommand rendering

### Comparator

- `compareWithExisting` - File comparison
- `formatDiff` - Diff formatting
- `writeFile` - File writing

### Renderers (Examples)

- `renderExamplesDefault` - Default renderer for Examples section

### Types

- `CommandInfo` - Command information
- `SubCommandInfo` - Subcommand information
- `RenderFunction` - Renderer function type
- `SectionRenderFunction` - Section render function type
- `DefaultRendererOptions` - Renderer options
- `FileConfig` - File configuration
- `FileMapping` - File mapping
- `GenerateDocConfig` - Configuration
- `GenerateDocResult` - Result
- `ExampleConfig` - Example execution settings
- `ExampleCommandConfig` - Per-command example settings
- `ExampleExecutionResult` - Example execution result
- `FormatterFunction` - Formatter function type
