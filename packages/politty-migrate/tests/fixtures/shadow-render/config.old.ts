import { assertDocMatch, createCommandRenderer } from "politty/docs";
import { command } from "./command.js";

// A helper declares a NESTED `const myRender` that is default-equivalent. It
// must NOT shadow the genuinely custom TOP-LEVEL `const myRender` below. The
// resolver previously returned the first (nested) one in document order and
// silently dropped the custom renderer.
function buildHelperRenderer() {
  const myRender = createCommandRenderer({ headingLevel: 1 });
  return myRender;
}

const myRender = makeCustomRenderer();

await assertDocMatch({
  command,
  files: {
    "tests/migrate/fixtures/shadow-render/README.old.md": {
      title: "Shadowed Render",
      description: "Custom renderer must survive as a TODO.",
      commands: ["build"],
      render: myRender,
    },
  },
});
