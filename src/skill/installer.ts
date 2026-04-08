import { cpSync, existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { resolve } from "node:path";
import type { DiscoveredSkill } from "./types.js";

/** Canonical directory where skill files are stored. */
const AGENTS_SKILLS_DIR = ".agents/skills";

/**
 * Agent directories that get symlinks to the canonical skill directory.
 * Universal agents (Cursor, Cline, etc.) read from .agents/skills/ directly.
 */
const SYMLINK_TARGETS = [".claude/skills"] as const;

/**
 * Install a skill to the project's agent skill directories.
 *
 * Copies the skill directory to `.agents/skills/<name>/` (canonical),
 * then creates symlinks from each agent-specific directory.
 */
export function installSkill(skill: DiscoveredSkill, cwd: string = process.cwd()): void {
  const name = skill.frontmatter.name;
  const canonicalDir = resolve(cwd, AGENTS_SKILLS_DIR, name);

  // Copy skill directory to canonical location
  mkdirSync(canonicalDir, { recursive: true });
  cpSync(skill.sourcePath, canonicalDir, { recursive: true });

  // Create symlinks for non-universal agents
  for (const target of SYMLINK_TARGETS) {
    const targetDir = resolve(cwd, target, name);
    const targetParent = resolve(cwd, target);

    // Remove existing (stale symlink or old copy)
    if (existsSync(targetDir) || isDeadSymlink(targetDir)) {
      rmSync(targetDir, { recursive: true, force: true });
    }

    mkdirSync(targetParent, { recursive: true });
    try {
      symlinkSync(canonicalDir, targetDir, "dir");
    } catch {
      // Symlink failed (e.g., Windows without dev mode), fall back to copy
      cpSync(canonicalDir, targetDir, { recursive: true });
    }
  }
}

/**
 * Uninstall a skill from the project's agent skill directories.
 *
 * Removes symlinks from agent directories, then removes the canonical copy.
 */
export function uninstallSkill(name: string, cwd: string = process.cwd()): void {
  // Remove symlinks first
  for (const target of SYMLINK_TARGETS) {
    const targetDir = resolve(cwd, target, name);
    if (existsSync(targetDir) || isDeadSymlink(targetDir)) {
      rmSync(targetDir, { recursive: true, force: true });
    }
  }

  // Remove canonical copy
  const canonicalDir = resolve(cwd, AGENTS_SKILLS_DIR, name);
  if (existsSync(canonicalDir)) {
    rmSync(canonicalDir, { recursive: true, force: true });
  }
}

function isDeadSymlink(path: string): boolean {
  try {
    const stat = lstatSync(path);
    return stat.isSymbolicLink();
  } catch {
    return false;
  }
}
