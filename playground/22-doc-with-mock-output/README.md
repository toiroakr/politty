# user-info

ユーザー情報を表示するCLIツール

## Usage

```
user-info [options] <name>
```

## Arguments

| Argument | Description | Required |
|----------|-------------|----------|
| `name` | ユーザー名 | Yes |

## Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--format <FORMAT>` | `-f` | 出力フォーマット | `"text"` |
| `--verbose` | `-v` | 詳細情報を表示 | `false` |

## Examples

### 基本的な使用例

```bash
$ user-info Alice
User: Alice
Role: developer
Created: 2024-01-15
```

### JSON形式での出力

```bash
$ user-info Bob -f json
{
  "name": "Bob",
  "createdAt": "2024-01-15",
  "role": "developer"
}
```

### 詳細情報の表示

```bash
$ user-info Charlie --verbose
User: Charlie
Role: developer
Created: 2024-01-15
Email: charlie@example.com
Last Login: 2024-03-20
```
