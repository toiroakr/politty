# serve

Serve a project using Standard Schema and a separate JSON Schema converter

**Usage**

```
serve [options] <config>
```

**Arguments**

| Argument | Description             | Required |
| -------- | ----------------------- | -------- |
| `config` | Path to the config file | Yes      |

**Options**

| Option                   | Alias | Description           | Required | Default  | Env               |
| ------------------------ | ----- | --------------------- | -------- | -------- | ----------------- |
| `--port <PORT>`          | `-p`  | Port number (1-65535) | Yes      | -        | -                 |
| `--level <LEVEL>`        | `-L`  | Log level             | No       | `"info"` | `SERVE_LOG_LEVEL` |
| `--color` / `--no-color` | -     | Colorize output       | No       | `true`   | -                 |
