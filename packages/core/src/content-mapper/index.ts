import { createContentMapperHandlers } from "./handlers.js";
import { serveJsonRpc } from "./rpc.js";

/**
 * Serve politty's content mapper on stdin/stdout, as TypeScript starts it
 * from the `typescript.contentMapper` field of a politty package.
 */
export async function serveContentMapper(): Promise<void> {
  await serveJsonRpc(createContentMapperHandlers(), process.stdin, (chunk) =>
    process.stdout.write(chunk),
  );
}
