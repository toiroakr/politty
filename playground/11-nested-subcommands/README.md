<!-- politty:command::start -->

# git-like

Git風のネストしたサブコマンドの例

## Usage

```
git-like [command]
```

## Commands

| Command             | Description |
| ------------------- | ----------- |
| [`config`](#config) | 設定を管理  |

<!-- politty:command::end -->
<!-- politty:command:config:start -->

# config

設定を管理

## Usage

```
git-like config [command]
```

## Commands

| Command                       | Description          |
| ----------------------------- | -------------------- |
| [`config get`](#config-get)   | 設定値を取得         |
| [`config set`](#config-set)   | 設定値を設定         |
| [`config list`](#config-list) | 全ての設定を一覧表示 |

<!-- politty:command:config:end -->
<!-- politty:command:config get:start -->

# get

設定値を取得

## Usage

```
git-like config get <key>
```

## Arguments

| Argument | Description | Required |
| -------- | ----------- | -------- |
| `key`    | 設定キー    | Yes      |

<!-- politty:command:config get:end -->
<!-- politty:command:config list:start -->

# list

全ての設定を一覧表示

## Usage

```
git-like config list [options]
```

## Options

| Option              | Alias | Description | Default   |
| ------------------- | ----- | ----------- | --------- |
| `--format <FORMAT>` | `-f`  | 出力形式    | `"table"` |

<!-- politty:command:config list:end -->
<!-- politty:command:config set:start -->

# set

設定値を設定

## Usage

```
git-like config set <key> <value>
```

## Arguments

| Argument | Description | Required |
| -------- | ----------- | -------- |
| `key`    | 設定キー    | Yes      |
| `value`  | 設定値      | Yes      |

<!-- politty:command:config set:end -->
