import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Comparison result
 */
export interface CompareResult {
  /** Whether the content matches */
  match: boolean;
  /** Diff content (only when match is false) */
  diff?: string;
  /** Whether the file exists */
  fileExists: boolean;
}

/**
 * Compare generated content with existing file
 */
export function compareWithExisting(generatedContent: string, filePath: string): CompareResult {
  const absolutePath = path.resolve(filePath);

  if (!fs.existsSync(absolutePath)) {
    return {
      match: false,
      fileExists: false,
    };
  }

  const existingContent = fs.readFileSync(absolutePath, "utf-8");

  if (generatedContent === existingContent) {
    return {
      match: true,
      fileExists: true,
    };
  }

  return {
    match: false,
    diff: formatDiff(existingContent, generatedContent),
    fileExists: true,
  };
}

/**
 * Format diff between two strings in unified diff format
 */
export function formatDiff(expected: string, actual: string): string {
  const expectedLines = expected.split("\n");
  const actualLines = actual.split("\n");

  const result: string[] = [];
  result.push("--- existing");
  result.push("+++ generated");
  result.push("");

  // Simple line-by-line diff
  const maxLines = Math.max(expectedLines.length, actualLines.length);
  let inChunk = false;
  let chunkStart = 0;
  const chunk: string[] = [];

  const flushChunk = (): void => {
    if (chunk.length > 0) {
      result.push(`@@ -${chunkStart + 1},${chunk.length} @@`);
      result.push(...chunk);
      chunk.length = 0;
    }
    inChunk = false;
  };

  for (let i = 0; i < maxLines; i++) {
    const expectedLine = expectedLines[i];
    const actualLine = actualLines[i];

    if (expectedLine === actualLine) {
      if (inChunk) {
        // Add context line
        chunk.push(` ${expectedLine ?? ""}`);
        // If we have more than 3 context lines after a change, flush the chunk
        const lastChangeIndex = chunk.findIndex(
          (line, idx) =>
            (line.startsWith("-") || line.startsWith("+")) &&
            chunk.slice(idx + 1).every((l) => l.startsWith(" ")),
        );
        if (lastChangeIndex !== -1 && chunk.length - lastChangeIndex > 3) {
          flushChunk();
        }
      }
    } else {
      if (!inChunk) {
        inChunk = true;
        chunkStart = i;
        // Add up to 3 lines of context before
        const contextStart = Math.max(0, i - 3);
        for (let j = contextStart; j < i; j++) {
          chunk.push(` ${expectedLines[j] ?? ""}`);
        }
      }

      if (expectedLine !== undefined && (actualLine === undefined || expectedLine !== actualLine)) {
        chunk.push(`-${expectedLine}`);
      }
      if (actualLine !== undefined && (expectedLine === undefined || expectedLine !== actualLine)) {
        chunk.push(`+${actualLine}`);
      }
    }
  }

  flushChunk();

  return result.join("\n");
}

/**
 * Write content to file, creating directories if needed
 */
export function writeFile(filePath: string, content: string): void {
  const absolutePath = path.resolve(filePath);
  const dir = path.dirname(absolutePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(absolutePath, content, "utf-8");
}

/**
 * Read file content if it exists
 * Returns null if file does not exist
 */
export function readFile(filePath: string): string | null {
  const absolutePath = path.resolve(filePath);

  if (!fs.existsSync(absolutePath)) {
    return null;
  }

  return fs.readFileSync(absolutePath, "utf-8");
}

/**
 * Minimal fs interface for deleteFile
 */
export interface DeleteFileFs {
  existsSync: typeof fs.existsSync;
  unlinkSync: typeof fs.unlinkSync;
}

/**
 * Delete file if it exists
 * @param filePath - Path to the file to delete
 * @param fileSystem - Optional fs implementation (useful when fs is mocked)
 */
export function deleteFile(filePath: string, fileSystem: DeleteFileFs = fs): void {
  const absolutePath = path.resolve(filePath);

  if (fileSystem.existsSync(absolutePath)) {
    fileSystem.unlinkSync(absolutePath);
  }
}
