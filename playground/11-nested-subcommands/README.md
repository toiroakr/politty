# git-like

Git風のネストしたサブコマンドの例

## Usage

```
git-like [command]
```

## Commands

| Command | Description |
|---------|-------------|
| [`config`](#config) | 設定を管理 |

---

# config

設定を管理

## Usage

```
git-like config [command]
```

## Commands

| Command | Description |
|---------|-------------|
| [`config get`](#config-get) | 設定値を取得 |
| [`config set`](#config-set) | 設定値を設定 |
| [`config list`](#config-list) | 全ての設定を一覧表示 |

---

# get

設定値を取得

## Usage

```
git-like config get <key>
```

## Arguments

| Argument | Description | Required |
|----------|-------------|----------|
| `key` | 設定キー | Yes |

---

# list

全ての設定を一覧表示

## Usage

```
git-like config list [options]
```

## Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--format <FORMAT>` | `-f` | 出力形式 | `"table"` |

---

# set

設定値を設定

## Usage

```
git-like config set <key> <value>
```

## Arguments

| Argument | Description | Required |
|----------|-------------|----------|
| `key` | 設定キー | Yes |
| `value` | 設定値 | Yes |
