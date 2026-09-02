# serve

Serve a project (zod/mini edition)

**Usage**

```
serve [options] <config>
```

**Arguments**

| Argument | Description             | Required |
| -------- | ----------------------- | -------- |
| `config` | Path to the config file | Yes      |

**Options**

| Option                   | Alias | Description           | Required | Default  |
| ------------------------ | ----- | --------------------- | -------- | -------- |
| `--port <PORT>`          | `-p`  | Port number (1-65535) | Yes      | -        |
| `--level <LEVEL>`        | `-L`  | Log level             | No       | `"info"` |
| `--color` / `--no-color` | -     | Colorize output       | No       | `true`   |
