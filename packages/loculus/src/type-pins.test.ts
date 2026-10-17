import * as l from "loculus";
import { expect, it } from "vitest";
import { z } from "zod";
import { arg, defineCommand } from "./index.js";
it("infers loculus outputs and rejects foreign and scalar args schemas", () => {
  const command = defineCommand({
    name: "app",
    args: l.object({
      name: l.string(),
      port: l.number({ default: 3000 }),
      flag: l.boolean({ optional: true }),
    }),
    run: (args) => {
      args.name satisfies string;
      args.port satisfies number;
      args.flag satisfies boolean | undefined;
    },
  });
  expect(command.name).toBe("app");
  if (command.name === "typecheck-only") {
    // @ts-expect-error Foreign schemas are outside the loculus adapter contract.
    defineCommand({ name: "foreign", args: z.object({ name: z.string() }), run: () => {} });
    // @ts-expect-error Command arguments require an object output.
    defineCommand({ name: "scalar", args: l.string(), run: () => {} });
    const scalarTransform = {
      name: "scalar-transform",
      args: l.transform(l.string(), (name) => ({ name })),
      run: () => {},
    };
    // @ts-expect-error Scalar input transforms cannot expose CLI object fields.
    defineCommand(scalarTransform);
    // @ts-expect-error Object fields only take description and flatten metadata.
    arg(l.object({ name: l.string() }), { alias: "n" });
    arg(l.object({ name: l.string() }), { description: "Server", flatten: "kebab" });
    // @ts-expect-error flatten only accepts the supported naming styles.
    arg(l.object({ name: l.string() }), { flatten: "snake" });
  }
});
