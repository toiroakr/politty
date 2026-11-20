import {
  arg,
  createDefineCommand,
  defineCommand,
  standardArgs,
  unflatten,
} from "@politty/standard";
import * as v from "valibot";
import { z } from "zod";

const transformed = z
  .object({ message: z.string(), count: z.coerce.number() })
  .transform(({ message, count }) => ({ size: message.length * count, count }));
const args = standardArgs(transformed, {
  fields: {
    message: { positional: true },
    count: {
      effect: (value) => {
        value.toFixed();
      },
    },
  },
});

createDefineCommand<{ verbose: boolean }>()({
  name: "wrapped",
  args,
  run: (args) => {
    const output: [number, boolean] = [args.size, args.verbose];
    // @ts-expect-error Input-only fields are not exposed after validation.
    void args.message;
    return output;
  },
});

const direct = defineCommand({
  name: "direct",
  args: z.object({ mode: z.enum(["fast", "safe"]) }),
  run: (args) => args.mode,
});
const mode: "fast" | "safe" = direct.run({ mode: "fast" });
void mode;

const validator = v.object({ mode: v.string() });
// @ts-expect-error Validation alone provides no input shape to the adapter.
defineCommand({ name: "validation-only", args: validator, run: () => {} });
// @ts-expect-error A separately convertible validator requires the converter option.
standardArgs(validator);
// @ts-expect-error Metadata names come from the input object.
standardArgs(transformed, { fields: { size: { alias: "s" } } });
// @ts-expect-error Command args schemas must return an object.
defineCommand({ name: "scalar", args: z.string(), run: () => {} });

const port = arg(z.coerce.number(), { alias: "p" });
defineCommand({
  name: "connect",
  args: unflatten(
    standardArgs(z.object({ "server.port": port }), { fields: { "server.port": port } }),
  ),
  run: ({ server }) => {
    const portNumber: number = server.port;
    return portNumber;
  },
});

const untyped = standardArgs(
  {
    "~standard": { version: 1, vendor: "untyped", validate: () => ({ value: { id: "example" } }) },
  },
  {
    jsonSchema: {
      "~standard": {
        version: 1,
        jsonSchema: { input: () => ({ type: "object", properties: { id: { type: "string" } } }) },
      },
    },
  },
);
defineCommand({ name: "untyped", args: untyped, run: (args) => args.id });
