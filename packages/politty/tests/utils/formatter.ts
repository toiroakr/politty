import { format } from "oxfmt";

/**
 * Format content using oxfmt
 */
export async function mdFormatter(content: string): Promise<string> {
  const { code } = await format("file.md", content);
  return code;
}
