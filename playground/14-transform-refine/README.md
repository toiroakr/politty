<!-- politty:command::start -->

# validation-demo

transform/refineのデモ

## Usage

```
validation-demo [command]
```

## Commands

| Command                   | Description                              |
| ------------------------- | ---------------------------------------- |
| [`transform`](#transform) | transformを使った変換の例                |
| [`refine`](#refine)       | refineを使ったカスタムバリデーションの例 |

<!-- politty:command::end -->
<!-- politty:command:refine:start -->

# refine-example

refineを使ったカスタムバリデーションの例

## Usage

```
validation-demo refine <input> <output>
```

## Arguments

| Argument | Description  | Required |
| -------- | ------------ | -------- |
| `input`  | 入力ファイル | Yes      |
| `output` | 出力ファイル | Yes      |

<!-- politty:command:refine:end -->
<!-- politty:command:transform:start -->

# transform-example

transformを使った変換の例

## Usage

```
validation-demo transform [options] <name>
```

## Arguments

| Argument | Description                | Required |
| -------- | -------------------------- | -------- |
| `name`   | 名前（大文字に変換される） | Yes      |

## Options

| Option          | Alias | Description        | Default |
| --------------- | ----- | ------------------ | ------- |
| `--tags <TAGS>` | `-t`  | カンマ区切りのタグ | -       |

<!-- politty:command:transform:end -->
