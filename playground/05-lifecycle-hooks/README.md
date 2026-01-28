<!-- politty:command::start -->

# db-query

Execute database query (lifecycle hooks demo)

**Usage**

```
db-query [options]
```

**Options**

| Option                  | Alias | Description                | Default |
| ----------------------- | ----- | -------------------------- | ------- |
| `--database <DATABASE>` | `-d`  | Database connection string | -       |
| `--query <QUERY>`       | `-q`  | SQL query                  | -       |
| `--simulate_error`      | `-e`  | Simulate an error          | `false` |

**Notes**

This command demonstrates the setup → run → cleanup execution order.
Using the --simulate-error flag, you can verify that cleanup is called even when an error occurs.

<!-- politty:command::end -->
