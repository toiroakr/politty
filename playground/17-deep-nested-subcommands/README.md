# git-like

3階層ネストしたサブコマンドの例

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
| [`config user`](#config-user) | ユーザー設定を管理 |
| [`config core`](#config-core) | コア設定を管理 |

---

# core

コア設定を管理

## Usage

```
git-like config core [command]
```

## Commands

| Command | Description |
|---------|-------------|
| [`config core get`](#config-core-get) | コア設定値を取得 |
| [`config core set`](#config-core-set) | コア設定値を設定 |

---

# user

ユーザー設定を管理

## Usage

```
git-like config user [command]
```

## Commands

| Command | Description |
|---------|-------------|
| [`config user get`](#config-user-get) | ユーザー設定値を取得 |
| [`config user set`](#config-user-set) | ユーザー設定値を設定 |

---

# get

コア設定値を取得

## Usage

```
git-like config core get <key>
```

## Arguments

| Argument | Description | Required |
|----------|-------------|----------|
| `key` | 設定キー (editor, pager など) | Yes |

---

# set

コア設定値を設定

## Usage

```
git-like config core set <key> <value>
```

## Arguments

| Argument | Description | Required |
|----------|-------------|----------|
| `key` | 設定キー | Yes |
| `value` | 設定値 | Yes |

---

# get

ユーザー設定値を取得

## Usage

```
git-like config user get <key>
```

## Arguments

| Argument | Description | Required |
|----------|-------------|----------|
| `key` | 設定キー (name, email など) | Yes |

---

# set

ユーザー設定値を設定

## Usage

```
git-like config user set [options] <key> <value>
```

## Arguments

| Argument | Description | Required |
|----------|-------------|----------|
| `key` | 設定キー | Yes |
| `value` | 設定値 | Yes |

## Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--global` | `-g` | グローバル設定として保存 | `false` |
