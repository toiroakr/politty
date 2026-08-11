# deploy

Deploy the application to a target environment

**Usage**

```
deploy [options] <target>
```

**Arguments**

| Argument | Description                                                                                                               | Required |
| -------- | ------------------------------------------------------------------------------------------------------------------------- | -------- |
| `target` | Deployment target environment.<br>- staging: safe sandbox for verification<br>- production: live, user-facing environment | Yes      |

**Options**

| Option                  | Alias | Description                                                                                                                             | Required | Default     |
| ----------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------- |
| `--strategy <STRATEGY>` | `-s`  | Rollout strategy.<br>rolling: replace instances gradually with zero downtime.<br>recreate: stop all instances, then start the new ones. | No       | `"rolling"` |
| `--yes`                 | `-y`  | Skip the confirmation prompt.<br>Use this in CI environments.                                                                           | No       | `false`     |
