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

---

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

---

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
