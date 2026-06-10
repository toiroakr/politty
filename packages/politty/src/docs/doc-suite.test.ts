import { describe, expect, it } from "vitest";
import { command } from "../../playground/23-global-options-index-markers/index.js";
import type { GenerateDocConfig } from "./types.js";
import { createDocSuite } from "./vitest.js";

describe("createDocSuite", () => {
  // Pointed at a path that does not exist; with update mode off this makes
  // assertDocMatch reject, which is enough to prove match() forwards the merged
  // config. initDocFile (registered via beforeAll) is a no-op when update mode
  // is off, so no real file is touched.
  const base: GenerateDocConfig = {
    command,
    files: { "src/docs/__does_not_exist__.md": { commands: [""] } },
  };
  const doc = createDocSuite(base);

  it("returns a match() function", () => {
    expect(typeof doc.match).toBe("function");
  });

  it("match() forwards base + overrides to assertDocMatch (rejects on diff)", async () => {
    await expect(doc.match({ targetCommands: [""] })).rejects.toThrow(
      /does not match|does not exist/i,
    );
  });
});
