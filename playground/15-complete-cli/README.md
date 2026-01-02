<!-- politty:command::start -->

# my-tool

完全なCLIツールの例

## Usage

```
my-tool [options] [command] <input>
```

## Arguments

| Argument | Description  | Required |
| -------- | ------------ | -------- |
| `input`  | 入力ファイル | Yes      |

## Options

| Option              | Alias | Description          | Default  |
| ------------------- | ----- | -------------------- | -------- |
| `--output <OUTPUT>` | `-o`  | 出力ファイル         | -        |
| `--verbose`         | `-v`  | 詳細出力を有効にする | `false`  |
| `--format <FORMAT>` | `-f`  | 出力形式             | `"json"` |

## Commands

| Command         | Description                |
| --------------- | -------------------------- |
| [`init`](#init) | 新しいプロジェクトを初期化 |

## Notes

サブコマンド、ライフサイクルフック、複数の出力形式をサポートしています。

<!-- politty:command::end -->
<!-- politty:command:init:start -->

# init

新しいプロジェクトを初期化

## Usage

```
my-tool init [options]
```

## Options

| Option                  | Alias | Description          | Default     |
| ----------------------- | ----- | -------------------- | ----------- |
| `--template <TEMPLATE>` | `-t`  | 使用するテンプレート | `"default"` |
| `--name <NAME>`         | `-n`  | プロジェクト名       | -           |

<!-- politty:command:init:end -->
