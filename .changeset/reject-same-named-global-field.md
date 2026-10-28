---
"@politty/loculus": minor
"@politty/zod": minor
"@politty/valibot": minor
"@politty/zod-mini": minor
"politty": minor
---

Reject a field that is declared with the same name in both `globalArgs` and a command's own `args`, even when the two definitions are identical. Previously identical definitions were allowed and a flag typed before the subcommand pre-filled the command's field, but a prompt on such a field asked twice and the second answer overwrote the first.

Before, this was accepted:

```ts
const output = arg(z.string().default("dist"));
runMain(defineCommand({ name: "build", args: z.object({ output }) }), {
  globalArgs: z.object({ output }),
});
```

Now it throws `FieldTypeConflictError` ("can only be declared in one schema"). The error class name is unchanged, but it is now thrown for identical definitions too. Declare the field in only one of the two schemas. A same-named `verbose`/`json` on the built-in skills commands is still handled by passing `globalArgs` to `withSkillCommand`.
