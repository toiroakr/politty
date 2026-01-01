import { execSync } from "node:child_process";

/**
 * Format content using oxfmt
 */
export function oxfmtFormatter(content: string): string {
  return execSync("pnpm oxfmt --stdin-filepath=file.md", {
    input: content,
    encoding: "utf-8",
  });
}
