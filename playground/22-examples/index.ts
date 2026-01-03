/**
 * 22-examples.ts - examplesフィールドとモック実行の使用例
 *
 * サブコマンド毎に異なるモックを設定して、examplesを実行する例。
 * ファイルシステム操作をモックして、実際のファイルを触らずにexampleを実行します。
 *
 * 実行方法:
 *   pnpx tsx playground/22-examples/index.ts read config.json
 *   pnpx tsx playground/22-examples/index.ts write output.txt "Hello"
 *   pnpx tsx playground/22-examples/index.ts --help
 */

import * as fs from "node:fs";
import { z } from "zod";
import { arg, defineCommand, runMain } from "../../src/index.js";

// read サブコマンド
export const readCommand = defineCommand({
  name: "read",
  description: "Read file contents",
  args: z.object({
    file: arg(z.string(), {
      positional: true,
      description: "File path to read",
    }),
    format: arg(z.enum(["text", "json"]).default("text"), {
      alias: "f",
      description: "Output format",
    }),
  }),
  examples: [
    {
      cmd: "config.json",
      desc: "Read a JSON config file",
    },
    {
      cmd: "data.txt -f text",
      desc: "Read a text file",
    },
  ],
  run: (args) => {
    const content = fs.readFileSync(args.file, "utf-8");
    if (args.format === "json") {
      const parsed = JSON.parse(content);
      console.log(JSON.stringify(parsed, null, 2));
      return parsed;
    }
    console.log(content);
    return content;
  },
});

// write サブコマンド
export const writeCommand = defineCommand({
  name: "write",
  description: "Write content to file",
  args: z.object({
    file: arg(z.string(), {
      positional: true,
      description: "File path to write",
    }),
    content: arg(z.string(), {
      positional: true,
      description: "Content to write",
    }),
    append: arg(z.boolean().default(false), {
      alias: "a",
      description: "Append to file instead of overwriting",
    }),
  }),
  examples: [
    {
      cmd: 'output.txt "Hello, World!"',
      desc: "Write text to a file",
    },
    {
      cmd: 'log.txt "New entry" --append',
      desc: "Append text to a file",
    },
  ],
  run: (args) => {
    const mode = args.append ? "appended" : "written";
    fs.writeFileSync(args.file, args.content, { flag: args.append ? "a" : "w" });
    const message = `Successfully ${mode} to ${args.file}`;
    console.log(message);
    return { file: args.file, content: args.content, mode };
  },
});

// check サブコマンド
export const checkCommand = defineCommand({
  name: "check",
  description: "Check if file exists",
  args: z.object({
    file: arg(z.string(), {
      positional: true,
      description: "File path to check",
    }),
  }),
  examples: [
    {
      cmd: "config.json",
      desc: "Check if config file exists",
    },
    {
      cmd: "missing.txt",
      desc: "Check non-existent file",
    },
  ],
  run: (args) => {
    const exists = fs.existsSync(args.file);
    const message = exists ? `File exists: ${args.file}` : `File not found: ${args.file}`;
    console.log(message);
    return { file: args.file, exists };
  },
});

// delete サブコマンド（examplesなし）
export const deleteCommand = defineCommand({
  name: "delete",
  description: "Delete a file",
  args: z.object({
    file: arg(z.string(), {
      positional: true,
      description: "File path to delete",
    }),
    force: arg(z.boolean().default(false), {
      alias: "f",
      description: "Force deletion without confirmation",
    }),
  }),
  run: (args) => {
    if (fs.existsSync(args.file)) {
      fs.unlinkSync(args.file);
      console.log(`Deleted: ${args.file}`);
      return { file: args.file, deleted: true };
    }
    console.log(`File not found: ${args.file}`);
    return { file: args.file, deleted: false };
  },
});

// メインコマンド
export const command = defineCommand({
  name: "file-cli",
  description: "File operations CLI with examples",
  subCommands: {
    read: readCommand,
    write: writeCommand,
    check: checkCommand,
    delete: deleteCommand,
  },
});

if (process.argv[1]?.includes("22-examples")) {
  runMain(command, { version: "1.0.0" });
}
