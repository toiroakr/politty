# greet

挨拶を表示するCLIツール

## Usage

```
greet [options] <name>
```

## Arguments

| Argument | Description | Required |
|----------|-------------|----------|
| `name` | 挨拶する相手の名前 | Yes |

## Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--greeting <GREETING>` | `-g` | 挨拶のフレーズ | `"Hello"` |
| `--loud` | `-l` | 大文字で出力 | `false` |

## Examples

Basic greeting

```bash
$ greet World
Hello, World!
```

Custom greeting

```bash
$ greet World -g Hi
Hi, World!
```

Loud greeting

```bash
$ greet World -l
HELLO, WORLD!
```
