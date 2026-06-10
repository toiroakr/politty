import { beforeAll } from "vitest";
import type { DeleteFileFs } from "./doc-comparator.js";
import { assertDocMatch, initDocFile } from "./golden-test.js";
import type { GenerateDocConfig } from "./types.js";

/**
 * A documentation test suite bound to a shared base config.
 *
 * `createDocSuite` wires the `initDocFile` lifecycle for you (it registers a
 * `beforeAll` that, in update mode, deletes the configured files so stale
 * blocks from skipped tests don't linger). Each `match()` call runs
 * `assertDocMatch` with the base config merged with per-test overrides — the
 * usual `targetCommands` / `examples` per `it()`.
 */
export interface DocSuite {
  /** Run `assertDocMatch` with the base config merged with `overrides`. */
  match(overrides?: Partial<GenerateDocConfig>): Promise<void>;
}

/** Options for {@link createDocSuite}. */
export interface CreateDocSuiteOptions {
  /**
   * fs implementation used to delete files when `node:fs` is mocked. Pass the
   * real fs (e.g. `await vi.importActual("node:fs")`) so file deletion in
   * update mode bypasses the mock.
   */
  fileSystem?: DeleteFileFs;
}

/**
 * Create a documentation test suite from a shared base config. Call it at the
 * top of a `describe` block (so the internal `beforeAll` registers correctly):
 *
 * ```ts
 * import { createDocSuite } from "politty/docs/vitest";
 *
 * describe("cli docs", () => {
 *   const doc = createDocSuite(baseConfig, { fileSystem: realFs });
 *   it("read", () => doc.match({ targetCommands: ["read"], examples: { read: { mock, cleanup } } }));
 *   it("write", () => doc.match({ targetCommands: ["write"] }));
 * });
 * ```
 *
 * This removes the three easy-to-forget steps of the manual pattern: calling
 * `initDocFile` in `beforeAll`, passing the real fs under a mock, and gating on
 * update mode (all handled here).
 */
export function createDocSuite(
  base: GenerateDocConfig,
  options: CreateDocSuiteOptions = {},
): DocSuite {
  beforeAll(() => {
    initDocFile(base, options.fileSystem);
  });

  return {
    match: (overrides) => assertDocMatch({ ...base, ...overrides }),
  };
}
