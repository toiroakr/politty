# git-like

サブコマンドのオプションをまとめて表示する例

## Usage

```
git-like [command]
```

## Commands

| Command | Description |
|---------|-------------|
| [`config`](#config) | 設定を管理 |
| [`remote`](#remote) | リモートを管理 |

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
| `--global` | `-g` | グローバル設定を表示 | `false` |

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

---

# remote

リモートを管理

## Usage

```
git-like remote [command]
```

## Commands

| Command | Description |
|---------|-------------|
| [`remote add`](#remote-add) | リモートを追加 |
| [`remote remove`](#remote-remove) | リモートを削除 |

---

# add

リモートを追加

## Usage

```
git-like remote add <name> <url>
```

## Arguments

| Argument | Description | Required |
|----------|-------------|----------|
| `name` | リモート名 | Yes |
| `url` | リモートURL | Yes |

---

# remove

リモートを削除

## Usage

```
git-like remote remove [options] <name>
```

## Arguments

| Argument | Description | Required |
|----------|-------------|----------|
| `name` | リモート名 | Yes |

## Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--force` | `-f` | 強制削除 | `false` |
