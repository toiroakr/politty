<!-- politty:command::start -->

# my-cli

サブコマンドを持つCLIの例

**Usage**

```
my-cli [command]
```

**Commands**

| Command           | Description          |
| ----------------- | -------------------- |
| [`init`](#init)   | プロジェクトを初期化 |
| [`build`](#build) | プロジェクトをビルド |

<!-- politty:command::end -->
<!-- politty:command:build:start -->

## build

プロジェクトをビルド

**Usage**

```
my-cli build [options]
```

**Options**

| Option              | Alias | Description        | Default  |
| ------------------- | ----- | ------------------ | -------- |
| `--output <OUTPUT>` | `-o`  | 出力ディレクトリ   | `"dist"` |
| `--minify`          | `-m`  | 出力を圧縮         | `false`  |
| `--watch`           | `-w`  | ファイル変更を監視 | `false`  |

<!-- politty:command:build:end -->
<!-- politty:command:init:start -->

## init

プロジェクトを初期化

**Usage**

```
my-cli init [options]
```

**Options**

| Option                  | Alias | Description          | Default     |
| ----------------------- | ----- | -------------------- | ----------- |
| `--template <TEMPLATE>` | `-t`  | テンプレート名       | `"default"` |
| `--force`               | `-f`  | 既存ファイルを上書き | `false`     |

<!-- politty:command:init:end -->
