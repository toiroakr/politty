# Design: Skill Install / Update Command

## 概要

Coding agent（Claude Code 等）向けの **skill**（拡張機能）を簡単にインストール・更新するためのコマンド機能を politty で提供する。
`withCompletionCommand()` と同様のパターンで、CLI に `skill` サブコマンド群を追加できるようにする。

### ゴール

1. `mycli skill install <source>` でスキルをインストールできる
2. `mycli skill update [name]` で更新できる
3. `mycli skill list` で一覧表示できる
4. `mycli skill remove <name>` で削除できる
5. スキルのソースとして npm パッケージ、Git リポジトリ、ローカルパスをサポート
6. 型安全なAPIとして `politty/skill` サブモジュールから公開

### 非ゴール

- スキルのレジストリサーバーの構築（将来拡張）
- スキルの実行ランタイム（スキルの実行方法はCLI利用者が決定する）
- セキュリティ審査の自動化

---

## 1. スキルの定義

### 1.1 スキルとは

coding agent におけるスキルは以下のいずれか、またはその組み合わせ：

| 種類 | 説明 | 例 |
|------|------|-----|
| **Prompt** | Markdown ファイルによる指示・テンプレート | `/commit`, `/review-pr` |
| **Tool** | エージェントが利用するツール定義 | MCP server, function tool |
| **Hook** | イベントに応じて実行されるスクリプト | pre-commit, session-start |
| **Config** | 設定ファイルのプリセット | `.claude/settings.json` のテンプレート |

### 1.2 スキルマニフェスト (`skill.json`)

各スキルはルートに `skill.json` マニフェストを持つ：

```jsonc
{
  // 必須
  "name": "commit",
  "version": "1.2.0",
  "description": "Git commit message generation skill",

  // スキルの種類と対応ファイル
  "prompts": ["prompts/commit.md"],
  "tools": ["tools/git-diff.json"],
  "hooks": {
    "pre-commit": "hooks/lint-check.sh"
  },
  "config": ["config/settings.json"],

  // メタデータ（任意）
  "author": "example",
  "license": "MIT",
  "tags": ["git", "commit"],
  "agent": "claude-code",      // 対象エージェント（フィルタ用）
  "requires": {                 // 依存スキル
    "git-utils": ">=0.2.0"
  }
}
```

### 1.3 ディレクトリ構造

```
my-skill/
├── skill.json          # マニフェスト（必須）
├── prompts/
│   └── commit.md       # プロンプトファイル
├── tools/
│   └── git-diff.json   # ツール定義
├── hooks/
│   └── lint-check.sh   # フックスクリプト
└── config/
    └── settings.json   # 設定テンプレート
```

---

## 2. スキルソース

スキルのインストール元として以下をサポートする：

### 2.1 ソースの種類

| ソース | コマンド例 | 解決方法 |
|--------|-----------|----------|
| **npm パッケージ** | `skill install @agent-skills/commit` | `npm pack` + 展開 |
| **Git リポジトリ** | `skill install github:user/repo` | `git clone --depth 1` |
| **ローカルパス** | `skill install ./my-skill` | シンボリックリンク or コピー |
| **URL (tarball)** | `skill install https://example.com/skill.tar.gz` | HTTP fetch + 展開 |

### 2.2 ソース解決ロジック

```typescript
interface SkillSource {
  type: "npm" | "git" | "local" | "url";
  raw: string;          // ユーザー入力のまま
  resolved: string;     // 解決済みパス/URL
  version?: string;     // バージョン指定（あれば）
}

function resolveSource(input: string): SkillSource {
  if (input.startsWith("github:") || input.startsWith("git+"))
    return { type: "git", ... };
  if (input.startsWith("http://") || input.startsWith("https://"))
    return { type: "url", ... };
  if (input.startsWith(".") || input.startsWith("/"))
    return { type: "local", ... };
  // デフォルト: npm パッケージ
  return { type: "npm", ... };
}
```

---

## 3. スキルストレージ

### 3.1 ストレージ階層

| レベル | パス | 用途 |
|--------|------|------|
| **プロジェクト** | `.skills/` | プロジェクト固有のスキル |
| **ユーザー** | `~/.config/<agent>/skills/` | ユーザー全体で共有 |

デフォルトはプロジェクトレベル。`--global` フラグでユーザーレベルに切り替え。

### 3.2 ストレージ構造

```
.skills/
├── skill-lock.json              # ロックファイル（再現性確保）
├── commit/                      # インストール済みスキル
│   ├── skill.json
│   ├── prompts/
│   └── ...
└── review-pr/
    ├── skill.json
    └── ...
```

### 3.3 ロックファイル (`skill-lock.json`)

```jsonc
{
  "version": 1,
  "skills": {
    "commit": {
      "version": "1.2.0",
      "source": {
        "type": "npm",
        "raw": "@agent-skills/commit@1.2.0",
        "integrity": "sha256-abc123..."
      },
      "installedAt": "2026-03-19T00:00:00Z"
    }
  }
}
```

---

## 4. CLI コマンド設計

### 4.1 コマンドツリー

```
mycli skill
├── install <source> [--global] [--force]    # インストール
├── update [name] [--all]                    # 更新
├── list [--global] [--json]                 # 一覧
├── remove <name> [--global]                 # 削除
└── info <name>                              # 詳細表示
```

### 4.2 各コマンドの引数定義

```typescript
// skill install
const installArgs = z.object({
  source: arg(z.string(), {
    positional: true,
    description: "Skill source (npm package, git repo, local path, or URL)",
    placeholder: "SOURCE",
  }),
  global: arg(z.boolean().default(false), {
    alias: "g",
    description: "Install to user-level directory",
  }),
  force: arg(z.boolean().default(false), {
    alias: "f",
    description: "Overwrite existing skill",
  }),
});

// skill update
const updateArgs = z.object({
  name: arg(z.string().optional(), {
    positional: true,
    description: "Skill name to update (updates all if omitted)",
    placeholder: "NAME",
  }),
  all: arg(z.boolean().default(false), {
    description: "Update all installed skills",
  }),
});

// skill list
const listArgs = z.object({
  global: arg(z.boolean().default(false), {
    alias: "g",
    description: "List user-level skills",
  }),
  json: arg(z.boolean().default(false), {
    description: "Output as JSON",
  }),
});

// skill remove
const removeArgs = z.object({
  name: arg(z.string(), {
    positional: true,
    description: "Skill name to remove",
    placeholder: "NAME",
  }),
  global: arg(z.boolean().default(false), {
    alias: "g",
    description: "Remove from user-level directory",
  }),
});

// skill info
const infoArgs = z.object({
  name: arg(z.string(), {
    positional: true,
    description: "Skill name",
    placeholder: "NAME",
  }),
});
```

### 4.3 コマンド出力例

```bash
# インストール
$ mycli skill install @agent-skills/commit
✓ Installed commit@1.2.0 from npm:@agent-skills/commit

# 一覧
$ mycli skill list
Installed skills (.skills/):
  commit      1.2.0   Git commit message generation
  review-pr   0.5.1   PR review automation

# 更新
$ mycli skill update commit
✓ Updated commit: 1.2.0 → 1.3.0

# 削除
$ mycli skill remove commit
✓ Removed commit@1.2.0

# 詳細
$ mycli skill info commit
Name:        commit
Version:     1.2.0
Description: Git commit message generation skill
Author:      example
Source:      npm:@agent-skills/commit@1.2.0
Prompts:     prompts/commit.md
Tags:        git, commit
```

---

## 5. API 設計

### 5.1 公開API (`politty/skill`)

`withCompletionCommand()` パターンに倣い、以下のAPIを提供する：

```typescript
// politty/skill (新規サブモジュール)

/**
 * スキルコマンドを追加するラッパー
 * withCompletionCommand() と同じパターン
 */
export function withSkillCommand<T extends AnyCommand>(
  command: T,
  options?: SkillCommandOptions,
): T;

/**
 * オプション
 */
export interface SkillCommandOptions {
  /** スキルの保存ディレクトリ（デフォルト: ".skills"） */
  skillDir?: string;
  /** ユーザーレベルのスキルディレクトリ */
  globalSkillDir?: string;
  /** ソースリゾルバーのカスタマイズ */
  resolvers?: SkillResolver[];
  /** インストール後のフック */
  onInstall?: (skill: InstalledSkill) => void | Promise<void>;
  /** 削除前のフック */
  onRemove?: (skill: InstalledSkill) => void | Promise<void>;
}

/**
 * スキルマニフェストの型定義
 */
export interface SkillManifest {
  name: string;
  version: string;
  description?: string;
  prompts?: string[];
  tools?: string[];
  hooks?: Record<string, string>;
  config?: string[];
  author?: string;
  license?: string;
  tags?: string[];
  agent?: string;
  requires?: Record<string, string>;
}

/**
 * インストール済みスキル情報
 */
export interface InstalledSkill {
  manifest: SkillManifest;
  path: string;
  source: SkillSource;
  installedAt: Date;
}

/**
 * プログラマティックAPI（コマンド経由ではなくコードから直接操作）
 */
export function createSkillManager(options?: SkillManagerOptions): SkillManager;

export interface SkillManager {
  install(source: string, options?: InstallOptions): Promise<InstalledSkill>;
  update(name?: string): Promise<InstalledSkill[]>;
  remove(name: string): Promise<void>;
  list(): Promise<InstalledSkill[]>;
  info(name: string): Promise<InstalledSkill | null>;
  resolve(name: string): Promise<string | null>;  // スキルのパスを解決
}
```

### 5.2 利用例

```typescript
import { defineCommand, runMain } from "politty";
import { withSkillCommand } from "politty/skill";

const cli = withSkillCommand(
  defineCommand({
    name: "my-agent",
    description: "My coding agent CLI",
    subCommands: {
      run: runCommand,
      config: configCommand,
    },
  }),
  {
    skillDir: ".agent/skills",
    onInstall: (skill) => {
      console.log(`Post-install: registering ${skill.manifest.name}`);
    },
  },
);

runMain(cli, { version: "1.0.0" });
```

```bash
# 利用
$ my-agent skill install @agent-skills/commit
$ my-agent skill list
$ my-agent skill update --all
```

### 5.3 プログラマティック利用

```typescript
import { createSkillManager } from "politty/skill";

const manager = createSkillManager({
  skillDir: ".agent/skills",
});

// スキルの一覧取得
const skills = await manager.list();

// 特定スキルのプロンプトファイルを読み込む
const commitSkill = await manager.info("commit");
if (commitSkill) {
  const promptPath = path.join(
    commitSkill.path,
    commitSkill.manifest.prompts[0]
  );
  const prompt = await fs.readFile(promptPath, "utf-8");
}
```

---

## 6. ソースリゾルバー拡張

### 6.1 リゾルバーインターフェース

```typescript
/**
 * スキルソースを解決・取得するプラグイン
 */
export interface SkillResolver {
  /** このリゾルバーが処理可能か判定 */
  canResolve(source: string): boolean;
  /** スキルをダウンロード・展開して一時ディレクトリに配置 */
  fetch(source: string, options: FetchOptions): Promise<FetchResult>;
  /** 更新可能なバージョンがあるか確認 */
  checkUpdate?(current: InstalledSkill): Promise<UpdateInfo | null>;
}

export interface FetchResult {
  /** 展開先ディレクトリパス */
  dir: string;
  /** 解決されたバージョン */
  version: string;
  /** ソース情報 */
  source: SkillSource;
}
```

### 6.2 組み込みリゾルバー

| リゾルバー | 対象 | 依存 |
|-----------|------|------|
| `NpmResolver` | npm パッケージ | `npm` CLI |
| `GitResolver` | Git リポジトリ | `git` CLI |
| `LocalResolver` | ローカルパス | なし |
| `UrlResolver` | HTTP(S) tarball | `fetch` API |

### 6.3 カスタムリゾルバー例

```typescript
import { withSkillCommand, type SkillResolver } from "politty/skill";

const gistResolver: SkillResolver = {
  canResolve: (source) => source.startsWith("gist:"),
  async fetch(source) {
    const gistId = source.replace("gist:", "");
    // GitHub Gist API から取得...
    return { dir: tmpDir, version: "latest", source: { ... } };
  },
};

const cli = withSkillCommand(myCommand, {
  resolvers: [gistResolver],  // 組み込みに加えてカスタムリゾルバーも登録
});
```

---

## 7. 実装計画

### Phase 1: 基盤（MVP）

1. **`src/skill/` ディレクトリ作成**
   - `types.ts` - スキル関連の型定義
   - `manifest.ts` - マニフェスト読み込み・バリデーション（Zod）
   - `storage.ts` - インストール先の管理、ロックファイル
   - `manager.ts` - `SkillManager` 実装

2. **ローカルリゾルバー**
   - `resolvers/local.ts` - ローカルパスからのインストール

3. **CLI コマンド**
   - `commands.ts` - `install`, `list`, `remove`, `info` サブコマンド
   - `index.ts` - `withSkillCommand()` 公開API

4. **エクスポート設定**
   - `tsdown.config.ts` に `src/skill/index.ts` エントリ追加
   - `package.json` の `exports` に `politty/skill` 追加

### Phase 2: リモートソース

5. **npm リゾルバー**
   - `resolvers/npm.ts` - npm pack + 展開

6. **Git リゾルバー**
   - `resolvers/git.ts` - shallow clone

7. **URL リゾルバー**
   - `resolvers/url.ts` - HTTP fetch + tarball 展開

### Phase 3: 更新・依存解決

8. **更新機能**
   - `update` コマンドの実装
   - バージョン比較ロジック

9. **依存解決**
   - `requires` フィールドの解決
   - 循環依存の検出

### Phase 4: DX 改善

10. **シェル補完**
    - インストール済みスキル名の補完
    - ソース種別の補完

11. **`--dry-run` サポート**
    - インストール前にどのファイルが追加されるか確認

---

## 8. ファイル構成（予定）

```
src/skill/
├── index.ts                    # 公開API（withSkillCommand, createSkillManager）
├── types.ts                    # 型定義（SkillManifest, InstalledSkill, etc.）
├── manifest.ts                 # マニフェスト読み込み・バリデーション
├── storage.ts                  # ストレージ管理・ロックファイル
├── manager.ts                  # SkillManager 実装
├── source-resolver.ts          # ソース解決ロジック
├── commands.ts                 # CLI サブコマンド定義
├── resolvers/
│   ├── local.ts                # ローカルパスリゾルバー
│   ├── npm.ts                  # npm リゾルバー
│   ├── git.ts                  # Git リゾルバー
│   └── url.ts                  # URL リゾルバー
└── __tests__/
    ├── manifest.test.ts
    ├── storage.test.ts
    ├── manager.test.ts
    └── commands.test.ts
```

---

## 9. 設計上の判断ポイント

### Q1: スキルの実行は politty が担うか？

**A: No** — politty はスキルの「管理」（インストール・更新・削除・一覧）のみを提供する。
スキルの「実行」はCLI利用者側の責任。
理由：スキルの実行方法はエージェントごとに大きく異なる（Claude Code はプロンプト注入、他はツール呼び出し等）。

### Q2: npm の `node_modules` を使わないのか？

**A: 独自ディレクトリ** — `.skills/` を使う。
理由：
- スキルは Node.js モジュールに限らない（Markdown, JSON, Shell script）
- `node_modules` はアプリの依存と混在して管理が複雑になる
- ロックファイルで独立した再現性を確保できる

### Q3: マニフェストの必須性

**A: 必須** — `skill.json` がないディレクトリはスキルとして認識しない。
理由：メタデータなしでは一覧表示・更新・依存解決が不可能。
最小マニフェストは `name` と `version` のみ。

### Q4: バージョニング戦略

**A: semver** — npm と同じ semver を採用。
`requires` フィールドでの範囲指定もsemver rangeをサポート。
