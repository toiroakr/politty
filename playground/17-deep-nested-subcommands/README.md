<!-- politty:command::start -->

# git-like

3階層ネストしたサブコマンドの例

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

| Command                       | Description        |
| ----------------------------- | ------------------ |
| [`config user`](#config-user) | ユーザー設定を管理 |
| [`config core`](#config-core) | コア設定を管理     |

<!-- politty:command:config:end -->
<!-- politty:command:config core:start -->

# core

コア設定を管理

## Usage

```
git-like config core [command]
```

## Commands

| Command                               | Description      |
| ------------------------------------- | ---------------- |
| [`config core get`](#config-core-get) | コア設定値を取得 |
| [`config core set`](#config-core-set) | コア設定値を設定 |

<!-- politty:command:config core:end -->
<!-- politty:command:config core get:start -->

# get

コア設定値を取得

## Usage

```
git-like config core get <key>
```

## Arguments

| Argument | Description                   | Required |
| -------- | ----------------------------- | -------- |
| `key`    | 設定キー (editor, pager など) | Yes      |

<!-- politty:command:config core get:end -->
<!-- politty:command:config core set:start -->

# set

コア設定値を設定

## Usage

```
git-like config core set <key> <value>
```

## Arguments

| Argument | Description | Required |
| -------- | ----------- | -------- |
| `key`    | 設定キー    | Yes      |
| `value`  | 設定値      | Yes      |

<!-- politty:command:config core set:end -->
<!-- politty:command:config user:start -->

# user

ユーザー設定を管理

## Usage

```
git-like config user [command]
```

## Commands

| Command                               | Description          |
| ------------------------------------- | -------------------- |
| [`config user get`](#config-user-get) | ユーザー設定値を取得 |
| [`config user set`](#config-user-set) | ユーザー設定値を設定 |

<!-- politty:command:config user:end -->
<!-- politty:command:config user get:start -->

# get

ユーザー設定値を取得

## Usage

```
git-like config user get <key>
```

## Arguments

| Argument | Description                 | Required |
| -------- | --------------------------- | -------- |
| `key`    | 設定キー (name, email など) | Yes      |

<!-- politty:command:config user get:end -->
<!-- politty:command:config user set:start -->

# set

ユーザー設定値を設定

## Usage

```
git-like config user set [options] <key> <value>
```

## Arguments

| Argument | Description | Required |
| -------- | ----------- | -------- |
| `key`    | 設定キー    | Yes      |
| `value`  | 設定値      | Yes      |

## Options

| Option     | Alias | Description              | Default |
| ---------- | ----- | ------------------------ | ------- |
| `--global` | `-g`  | グローバル設定として保存 | `false` |

<!-- politty:command:config user set:end -->
