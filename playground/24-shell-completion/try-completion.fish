# Shell completion の動作確認用セットアップスクリプト (fish)
#
# 使い方:
#   source playground/24-shell-completion/try-completion.fish
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

# Resolve script directory
set -l script_dir (status dirname)
set -l project_dir (builtin realpath "$script_dir/../..")
set -g _try_comp_bin "$project_dir/.tmp-bin"

# Check tsx is available
if not command -q tsx
    echo "Error: tsx が見つかりません。npm install -g tsx でインストールしてください"
    set -e _try_comp_bin
    return 1
end

# Create bin directory and wrapper
mkdir -p $_try_comp_bin
echo "#!/usr/bin/env bash
exec tsx \"$script_dir/index.ts\" \"\$@\"" >$_try_comp_bin/myapp
chmod +x $_try_comp_bin/myapp

# Add to PATH
set -gx PATH $_try_comp_bin $PATH

# Source completion
echo "fish completion をセットアップ中..."
source (myapp completion fish | psub)
echo "セットアップ完了!"

# Cleanup function
function myapp-cleanup
    rm -rf $_try_comp_bin
    set -e _try_comp_bin
    functions -e myapp-cleanup
    echo "クリーンアップ完了 (.tmp-bin を削除しました)"
end

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
