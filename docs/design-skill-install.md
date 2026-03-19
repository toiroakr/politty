# Design: Skill Install / Update Command

## 概要

Coding agent（Claude Code 等）向けの **skill**（拡張機能）を簡単にインストール・更新するためのコマンド機能を politty で提供する。

スキルは **npm パッケージに同梱して配布** される。ユーザーは `npm install` でパッケージを取得し、CLI コマンドでスキルをプロジェクトに展開する。

```bash
# 1. npm パッケージとしてインストール
npm install @my-agent/skills

# 2. CLI コマンドでプロジェクトに展開
mycli skill install commit
mycli skill install --all
```

### ゴール

1. パッケージ同梱のスキルを `skill install <name>` でプロジェクトに展開できる
2. `skill update [name]` でパッケージ側の最新版に同期できる
3. `skill list` でインストール済み・利用可能なスキルを一覧表示できる
4. `skill remove <name>` で展開済みスキルを削除できる
5. `withCompletionCommand()` と同様のパターンで CLI に組み込める

### 非ゴール

- リモートレジストリからの直接フェッチ（npm/git/URL）
- スキルの実行ランタイム（実行方法はCLI利用者が決定する）
- スキル間の依存解決

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
  "name": "commit",
  "version": "1.2.0",
  "description": "Git commit message generation skill",

  // スキルの構成ファイル
  "files": [
    "prompts/commit.md",
    "tools/git-diff.json",
    "hooks/lint-check.sh"
  ],

  // メタデータ（任意）
  "author": "example",
  "tags": ["git", "commit"]
}
```

最小マニフェストは `name` と `version` のみ：

```json
{ "name": "commit", "version": "1.0.0" }
```

### 1.3 スキルパッケージの構造

npm パッケージ内にスキルをまとめて配置：

```
@my-agent/skills/              # npm パッケージ
├── package.json
└── skills/                    # スキル群のルート ← このパスを withSkillCommand に渡す
    ├── commit/
    │   ├── skill.json
    │   └── prompts/
    │       └── commit.md
    ├── review-pr/
    │   ├── skill.json
    │   └── prompts/
    │       └── review.md
    └── test-gen/
        ├── skill.json
        └── prompts/
            └── test-gen.md
```

パッケージ側は `skill.json` を含むディレクトリを配置するだけ。
特別なエクスポートやカタログ定義は不要。

---

## 2. インストールフロー

### 2.1 全体フロー

```
npm install @my-agent/skills     ← npm が node_modules に配置
    ↓
mycli skill install commit       ← ソースディレクトリからプロジェクトに展開
    ↓
.skills/commit/                  ← プロジェクト内にコピーされる
├── skill.json
└── prompts/commit.md
```

### 2.2 インストール処理の詳細

```
skill install <name>
  1. ソースディレクトリ群から <name>/ を検索
  2. skill.json を読み込み・バリデーション
  3. インストール先にすでに存在するか確認
     - 存在する場合: エラー（--force で上書き）
  4. スキルディレクトリをインストール先にコピー
  5. 完了メッセージ表示
```

### 2.3 更新処理

```
skill update [name]
  1. インストール済みスキルの skill.json からバージョンを取得
  2. ソースディレクトリの skill.json からバージョンを取得
  3. バージョンが異なる場合、上書きコピー
  4. 差分サマリーを表示
```

更新 = ソースディレクトリ（node_modules 内）の最新をプロジェクトに再コピー。
npm パッケージ自体の更新は `npm update` で行う。

---

## 3. スキルストレージ

### 3.1 インストール先

```
project-root/
└── .skills/                     # デフォルトのインストール先
    ├── commit/
    │   ├── skill.json
    │   └── prompts/commit.md
    └── review-pr/
        ├── skill.json
        └── prompts/review.md
```

インストール先ディレクトリは `withSkillCommand()` のオプションでカスタマイズ可能。

### 3.2 .gitignore の扱い

スキルをプロジェクトにコピーするため、git 管理するかどうかはユーザーの判断。

- **git 管理する**: チーム全体でスキルを共有。`npm install` 不要
- **git 管理しない**: `.gitignore` に `.skills/` を追加。CI で `skill install --all` を実行

---

## 4. CLI コマンド設計

### 4.1 コマンドツリー

```
mycli skill
├── install <name> [--force]        # ソースからプロジェクトに展開
├── install --all [--force]         # 全スキルをインストール
├── update [name]                   # ソース側の最新に同期
├── update --all                    # 全スキルを更新
├── list [--available] [--json]     # インストール済み一覧（--available でソースも表示）
├── remove <name>                   # 展開済みスキルを削除
└── info <name>                     # 詳細表示
```

### 4.2 各コマンドの引数定義

```typescript
// skill install
const installArgs = z.object({
  name: arg(z.string().optional(), {
    positional: true,
    description: "Skill name to install",
    placeholder: "NAME",
  }),
  all: arg(z.boolean().default(false), {
    description: "Install all available skills",
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
    description: "Skill name to update",
    placeholder: "NAME",
  }),
  all: arg(z.boolean().default(false), {
    description: "Update all installed skills",
  }),
});

// skill list
const listArgs = z.object({
  available: arg(z.boolean().default(false), {
    alias: "a",
    description: "Show available skills from source directories",
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
$ mycli skill install commit
✓ Installed commit@1.2.0

# 全スキルインストール
$ mycli skill install --all
✓ Installed commit@1.2.0
✓ Installed review-pr@0.5.1
✓ Installed test-gen@0.3.0
Installed 3 skills

# 一覧（インストール済み）
$ mycli skill list
Installed skills:
  commit      1.2.0   Git commit message generation
  review-pr   0.5.1   PR review automation

# 一覧（利用可能なスキルも含む）
$ mycli skill list --available
Installed:
  commit      1.2.0   Git commit message generation
  review-pr   0.5.1   PR review automation

Available:
  test-gen    0.3.0   Test generation skill

# 更新
$ mycli skill update commit
✓ Updated commit: 1.2.0 → 1.3.0

# 更新（変更なし）
$ mycli skill update commit
  commit@1.2.0 is up to date

# 削除
$ mycli skill remove commit
✓ Removed commit

# 詳細
$ mycli skill info commit
Name:        commit
Version:     1.2.0
Description: Git commit message generation skill
Author:      example
Files:       prompts/commit.md
Tags:        git, commit
Installed:   .skills/commit/
```

---

## 5. API 設計

### 5.1 公開API (`politty/skill`)

```typescript
// politty/skill (新規サブモジュール)

/**
 * スキルコマンドを追加するラッパー
 */
export function withSkillCommand<T extends AnyCommand>(
  command: T,
  options: SkillCommandOptions,
): T;

/**
 * オプション
 */
export interface SkillCommandOptions {
  /**
   * スキルのソースディレクトリ一覧
   * 各ディレクトリ配下の skill.json を持つサブディレクトリがスキルとして認識される
   */
  sourceDirs: string[];
  /** スキルのインストール先ディレクトリ（デフォルト: ".skills"） */
  installDir?: string;
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
  files?: string[];
  author?: string;
  tags?: string[];
}

/**
 * インストール済みスキル情報
 */
export interface InstalledSkill {
  manifest: SkillManifest;
  /** インストール先のパス */
  installedPath: string;
}

/**
 * ソースディレクトリ上のスキル情報
 */
export interface AvailableSkill {
  manifest: SkillManifest;
  /** ソースディレクトリ内のパス */
  sourcePath: string;
}

/**
 * プログラマティックAPI
 */
export function createSkillManager(options: SkillManagerOptions): SkillManager;

export interface SkillManagerOptions {
  sourceDirs: string[];
  installDir: string;
}

export interface SkillManager {
  /** ソースからスキルをインストール */
  install(name: string, options?: { force?: boolean }): Promise<InstalledSkill>;
  /** 全スキルをインストール */
  installAll(options?: { force?: boolean }): Promise<InstalledSkill[]>;
  /** ソース側の最新に更新 */
  update(name: string): Promise<InstalledSkill | null>;
  /** 全スキルを更新 */
  updateAll(): Promise<InstalledSkill[]>;
  /** インストール済みスキルを削除 */
  remove(name: string): Promise<void>;
  /** インストール済みスキルの一覧 */
  list(): Promise<InstalledSkill[]>;
  /** ソースディレクトリの利用可能なスキル一覧 */
  available(): Promise<AvailableSkill[]>;
  /** スキルの詳細情報 */
  info(name: string): Promise<InstalledSkill | null>;
}
```

### 5.2 利用例（CLI ツール作者）

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
    // node_modules 内のスキルディレクトリを直接指定
    sourceDirs: [
      require.resolve("@my-agent/skills/skills"),     // 公式スキル
      require.resolve("@my-agent/community/skills"),   // コミュニティスキル
    ],
    installDir: ".agent/skills",
  },
);

runMain(cli, { version: "1.0.0" });
```

### 5.3 プログラマティック利用

```typescript
import { createSkillManager } from "politty/skill";

const manager = createSkillManager({
  sourceDirs: [require.resolve("@my-agent/skills/skills")],
  installDir: ".skills",
});

// インストール
await manager.install("commit");

// 利用可能なスキルを確認
const available = await manager.available();
console.log(available.map(s => s.manifest.name));

// インストール済みスキルのプロンプトを読み込む
const skill = await manager.info("commit");
if (skill) {
  const promptPath = join(skill.installedPath, "prompts/commit.md");
  const prompt = await readFile(promptPath, "utf-8");
}
```

---

## 6. 内部処理

### 6.1 ソースディレクトリスキャン

```typescript
async function scanSourceDirs(sourceDirs: string[]): Promise<AvailableSkill[]> {
  const skills: AvailableSkill[] = [];

  for (const dir of sourceDirs) {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const manifestPath = join(dir, entry.name, "skill.json");
      if (!existsSync(manifestPath)) continue;

      const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
      const parsed = skillManifestSchema.parse(manifest);

      skills.push({
        manifest: parsed,
        sourcePath: join(dir, entry.name),
      });
    }
  }

  return skills;
}
```

### 6.2 インストール処理

```typescript
async function installSkill(
  source: AvailableSkill,
  installDir: string,
  options?: { force?: boolean },
): Promise<InstalledSkill> {
  const destDir = join(installDir, source.manifest.name);

  if (existsSync(destDir) && !options?.force) {
    throw new Error(
      `Skill "${source.manifest.name}" already installed. Use --force to overwrite.`,
    );
  }

  // ディレクトリごとコピー
  await cp(source.sourcePath, destDir, { recursive: true });

  return {
    manifest: source.manifest,
    installedPath: destDir,
  };
}
```

### 6.3 更新判定

```typescript
async function checkUpdate(
  installed: InstalledSkill,
  source: AvailableSkill,
): Promise<boolean> {
  // バージョン文字列の単純比較
  return installed.manifest.version !== source.manifest.version;
}
```

---

## 7. 実装計画

### Phase 1: MVP

1. **`src/skill/types.ts`** — 型定義（`SkillManifest`, `InstalledSkill`, `AvailableSkill`）
2. **`src/skill/manifest.ts`** — マニフェスト読み込み・Zod バリデーション
3. **`src/skill/scanner.ts`** — ソースディレクトリスキャン
4. **`src/skill/manager.ts`** — `SkillManager` 実装（install, list, remove, info）
5. **`src/skill/commands.ts`** — CLI サブコマンド定義
6. **`src/skill/index.ts`** — `withSkillCommand()`, `createSkillManager()` 公開API
7. **ビルド設定** — `tsdown.config.ts` / `package.json` の exports 追加

### Phase 2: 更新機能

8. **update コマンド** — バージョン比較 + 再コピー
9. **`--all` フラグ** — 全スキル一括操作

### Phase 3: DX 改善

10. **シェル補完** — インストール済み/利用可能スキル名の補完
11. **`--json` 出力** — スクリプト連携用

---

## 8. ファイル構成

```
src/skill/
├── index.ts              # 公開API（withSkillCommand, createSkillManager, 型）
├── types.ts              # 型定義
├── manifest.ts           # マニフェストスキーマ・バリデーション
├── scanner.ts            # ソースディレクトリスキャン
├── manager.ts            # SkillManager 実装
├── commands.ts           # CLI サブコマンド定義
└── __tests__/
    ├── manifest.test.ts
    ├── scanner.test.ts
    ├── manager.test.ts
    └── commands.test.ts
```

---

## 9. 設計上の判断ポイント

### Q1: なぜ `node_modules` から直接参照せずコピーするのか？

- ユーザーがスキルをカスタマイズ（プロンプトの微調整等）できるようにするため
- `node_modules` は `npm install` で上書きされる可能性がある
- プロジェクトに展開することで git 管理・チーム共有が可能

### Q2: スキルの実行は politty が担うか？

**No** — politty はスキルの「管理」（インストール・更新・削除・一覧）のみを提供する。
スキルの「実行」はCLI利用者側の責任。
理由：スキルの実行方法はエージェントごとに大きく異なる。

### Q3: 複数ソースディレクトリで名前が衝突した場合は？

先に指定されたディレクトリが優先される。`skill list --available` で各スキルのソースパスも表示して透明性を確保する。

### Q4: マニフェストの最小要件

`name` と `version` のみ必須。`files` は省略可能（省略時はディレクトリ内の全ファイルがスキルの構成要素）。
