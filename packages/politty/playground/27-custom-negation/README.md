<!-- politty:command::start -->

# build

Build with cache and color toggles using custom negation names

**Usage**

```
build [options]
```

**Options**

| Option                        | Alias | Description                               | Required | Default |
| ----------------------------- | ----- | ----------------------------------------- | -------- | ------- |
| `--cache` / `--disable-cache` | -     | Use the build cache                       | No       | `true`  |
| `--color`                     | -     | Colorize output                           | No       | `true`  |
| `--monochrome`                | -     | Disable colorized output (↔ `--color`)    | No       | -       |
| `--pretty` / `--no-pretty`    | -     | Format output for humans                  | No       | `true`  |
| `--verbose`                   | -     | Enable verbose logging (no negation flag) | No       | `false` |

<!-- politty:command::end -->
