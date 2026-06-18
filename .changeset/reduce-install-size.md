---
"politty": minor
---

インストールサイズを削減（2.9MB → 約630KB、約78%減）

- ソースマップ（`.map`）を配布物から除外
- ビルドキャッシュ（`tsconfig.tsbuildinfo`）などの副産物を `files` で明示的に除外
- **BREAKING**: CJS 配布を廃止し ESM-only に変更（`require()` での読み込み不可、`.cjs` / `index.d.cts` を廃止）
