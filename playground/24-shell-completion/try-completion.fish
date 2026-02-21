# Setup script for testing shell completion interactively (fish)
#
# Usage:
#   source playground/24-shell-completion/try-completion.fish
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

# Resolve script directory
set -l script_dir (status dirname)
set -l project_dir (builtin realpath "$script_dir/../..")
set -g _try_comp_bin "$project_dir/.tmp-bin"

# Check tsx is available
if not command -q tsx
    echo "Error: tsx not found. Install it with: npm install -g tsx"
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
echo "Setting up fish completion..."
source (myapp completion fish | psub)
echo "Setup complete!"

# Cleanup function
function myapp-cleanup
    rm -rf $_try_comp_bin
    set -e _try_comp_bin
    functions -e myapp-cleanup
    echo "Cleanup complete (removed .tmp-bin)"
end

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
