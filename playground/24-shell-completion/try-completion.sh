#!/usr/bin/env bash
#
# Setup script for testing shell completion interactively
#
# Usage:
#   source playground/24-shell-completion/try-completion.sh
#
# After setup, try the following:
#   myapp <TAB>           → subcommands (build, deploy, test, ...)
#   myapp build --<TAB>   → build options (--format, --output, ...)
#   myapp build -f <TAB>  → format values (json, yaml, xml)
#   myapp deploy -e <TAB> → env values (development, staging, production)
#   myapp test <TAB>      → test suite values (unit, integration, e2e)
#
# Cleanup:
#   myapp-cleanup

# Resolve script directory (works in both bash and zsh)
if [ -n "$BASH_VERSION" ]; then
    _try_comp_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
elif [ -n "$ZSH_VERSION" ]; then
    _try_comp_dir="$(cd "$(dirname "${0}")" && pwd)"
else
    echo "Error: bash or zsh is required"
    return 1 2>/dev/null || exit 1
fi

_try_comp_project="$(cd "$_try_comp_dir/../.." && pwd)"
_try_comp_bin="$_try_comp_project/.tmp-bin"

# Check tsx is available
if ! command -v tsx >/dev/null 2>&1; then
    echo "Error: tsx not found. Install it with: npm install -g tsx"
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
    echo "Setting up zsh completion..."
    eval "$(myapp completion zsh)"
    echo "Setup complete!"
elif [ -n "$BASH_VERSION" ]; then
    echo "Setting up bash completion..."
    eval "$(myapp completion bash)"
    echo "Setup complete!"
else
    echo "Error: bash or zsh is required (for fish, use try-completion.fish)"
    return 1 2>/dev/null || exit 1
fi

# Cleanup function
myapp-cleanup() {
    rm -rf "$_try_comp_bin"
    unset -f myapp-cleanup
    unset _try_comp_dir _try_comp_project _try_comp_bin
    echo "Cleanup complete (removed .tmp-bin)"
}

# Clean up temp variables (keep _try_comp_bin for cleanup function)
unset _try_comp_dir _try_comp_project

echo ""
echo "Try the following:"
echo "  myapp <TAB>              subcommand completion"
echo "  myapp build -f <TAB>     enum value completion (json/yaml/xml)"
echo "  myapp deploy -e <TAB>    custom value completion (development/staging/production)"
echo "  myapp deploy -c <TAB>    file completion"
echo "  myapp build -o <TAB>     directory completion"
echo "  myapp test <TAB>         positional enum completion (unit/integration/e2e)"
echo ""
echo "Cleanup: myapp-cleanup"
