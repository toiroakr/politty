import type { ShellType } from "./types.js";

/**
 * Detect the current shell from environment.
 *
 * Split out from `index.ts` so `with-completion-command.ts` can detect the
 * shell for the runMain background-refresh hook without statically pulling
 * in the bash/zsh/fish generators.
 */
export function detectShell(): ShellType | null {
  const shell = process.env.SHELL || "";
  const shellName = shell.split("/").pop()?.toLowerCase() || "";

  if (shellName.includes("bash")) {
    return "bash";
  }
  if (shellName.includes("zsh")) {
    return "zsh";
  }
  if (shellName.includes("fish")) {
    return "fish";
  }

  return null;
}
