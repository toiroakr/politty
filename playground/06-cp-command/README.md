# cp

ファイルをコピーする（cpコマンド風）

## Usage

```
cp [options] <source> <destination>
```

## Arguments

| Argument      | Description      | Required |
| ------------- | ---------------- | -------- |
| `source`      | コピー元ファイル | Yes      |
| `destination` | コピー先ファイル | Yes      |

## Options

| Option        | Alias | Description                  | Default |
| ------------- | ----- | ---------------------------- | ------- |
| `--recursive` | `-r`  | ディレクトリを再帰的にコピー | `false` |
| `--force`     | `-f`  | 上書き確認をスキップ         | `false` |
