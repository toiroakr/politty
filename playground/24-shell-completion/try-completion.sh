#!/usr/bin/env bash
#
# Shell completion の動作確認用セットアップスクリプト
#
# 使い方:
#   source playground/24-shell-completion/try-completion.sh
#
# セットアップ後、以下を試してください:
#   myapp <TAB>           → サブコマンド一覧 (build, deploy, test, ...)
#   myapp build --<TAB>   → build のオプション (--format, --output, ...)
#   myapp build -f <TAB>  → format の値 (json, yaml, xml)
#   myapp deploy -e <TAB> → env の値 (development, staging, production)
#   myapp test <TAB>      → test suite の値 (unit, integration, e2e)
#
# クリーンアップ:
#   myapp-cleanup

# Resolve script directory (works in both bash and zsh)
if [ -n "$BASH_VERSION" ]; then
    _try_comp_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
elif [ -n "$ZSH_VERSION" ]; then
    _try_comp_dir="$(cd "$(dirname "${0}")" && pwd)"
else
    echo "Error: bash or zsh が必要です"
    return 1 2>/dev/null || exit 1
fi

_try_comp_project="$(cd "$_try_comp_dir/../.." && pwd)"
_try_comp_bin="$_try_comp_project/.tmp-bin"

# Check tsx is available
if ! command -v tsx >/dev/null 2>&1; then
    echo "Error: tsx が見つかりません。npm install -g tsx でインストールしてください"
    unset _try_comp_dir _try_comp_project _try_comp_bin
    return 1 2>/dev/null || exit 1
fi

# Create bin directory and wrapper
mkdir -p "$_try_comp_bin"
cat > "$_try_comp_bin/myapp" << WRAPPER
#!/usr/bin/env bash
exec tsx "$_try_comp_dir/index.ts" "\$@"
WRAPPER
chmod +x "$_try_comp_bin/myapp"

# Add to PATH
export PATH="$_try_comp_bin:$PATH"

# Detect shell and source completion
if [ -n "$ZSH_VERSION" ]; then
    echo "zsh completion をセットアップ中..."
    eval "$(myapp completion zsh)"
    echo "セットアップ完了!"
elif [ -n "$BASH_VERSION" ]; then
    echo "bash completion をセットアップ中..."
    eval "$(myapp completion bash)"
    echo "セットアップ完了!"
fi

# Cleanup function
myapp-cleanup() {
    rm -rf "$_try_comp_bin"
    unset -f myapp-cleanup
    unset _try_comp_dir _try_comp_project _try_comp_bin
    echo "クリーンアップ完了 (.tmp-bin を削除しました)"
}

# Clean up temp variables (keep _try_comp_bin for cleanup function)
unset _try_comp_dir _try_comp_project

echo ""
echo "以下を試してください:"
echo "  myapp <TAB>              サブコマンド補完"
echo "  myapp build -f <TAB>     enum値補完 (json/yaml/xml)"
echo "  myapp deploy -e <TAB>    カスタム値補完 (development/staging/production)"
echo "  myapp deploy -c <TAB>    ファイル補完"
echo "  myapp build -o <TAB>     ディレクトリ補完"
echo "  myapp test <TAB>         positional enum補完 (unit/integration/e2e)"
echo ""
echo "クリーンアップ: myapp-cleanup"
