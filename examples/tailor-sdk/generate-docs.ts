/**
 * Documentation generator for tailor-sdk CLI
 * Generates docs similar to packages/sdk/docs/cli-reference.md and cli/*.md
 */
import { generateDoc } from "politty/docs";
import { tailorSdkCommand } from "./command.js";

// Output directory for generated documentation
const DOCS_DIR = "examples/tailor-sdk/packages/sdk/docs";

// Generate documentation configuration
async function main() {
  const result = await generateDoc({
    command: tailorSdkCommand,
    files: {
      // Main CLI reference - contains all top-level commands overview
      [`${DOCS_DIR}/cli-reference.md`]: {
        title: "CLI Reference",
        description: `This page provides a comprehensive reference for all Tailor Platform SDK CLI commands.

## Installation

\`\`\`bash
npm install -g @tailor-platform/sdk
\`\`\`

## Global Options

The following options are available for most commands:

| Option | Alias | Description |
|--------|-------|-------------|
| \`--workspace-id\` | \`-w\` | Target workspace ID |
| \`--profile\` | \`-p\` | Profile to use |
| \`--json\` | \`-j\` | Output in JSON format |
| \`--yes\` | \`-y\` | Skip confirmation prompts |
| \`--verbose\` | | Enable verbose output |
| \`--env-file\` | \`-e\` | Path to environment file |

## Environment Variables

| Variable | Description |
|----------|-------------|
| \`TAILOR_PLATFORM_TOKEN\` | Access token for authentication |
| \`TAILOR_WORKSPACE_ID\` | Default workspace ID |

## Commands
`,
        commands: [""],
      },

      // Application commands (init, apply, remove, show, generate)
      [`${DOCS_DIR}/cli/application.md`]: {
        title: "Application Commands",
        description: "Commands for managing Tailor Platform applications.",
        commands: ["init", "apply", "remove", "show", "generate"],
      },

      // Auth resource commands (machineuser, oauth2client)
      [`${DOCS_DIR}/cli/auth.md`]: {
        title: "Authentication Resource Commands",
        description:
          "Commands for managing authentication resources like machine users and OAuth2 clients.",
        commands: ["machineuser", "oauth2client"],
      },

      // Secret management commands
      [`${DOCS_DIR}/cli/secret.md`]: {
        title: "Secret Management Commands",
        description: "Commands for managing secrets and vaults.",
        commands: ["secret"],
      },

      // Static website commands
      [`${DOCS_DIR}/cli/staticwebsite.md`]: {
        title: "Static Website Commands",
        description: "Commands for deploying and managing static websites.",
        commands: ["staticwebsite"],
      },

      // User management commands
      [`${DOCS_DIR}/cli/user.md`]: {
        title: "User Commands",
        description: "Commands for managing users and personal access tokens.",
        commands: ["login", "logout", "user"],
      },

      // Workflow commands
      [`${DOCS_DIR}/cli/workflow.md`]: {
        title: "Workflow Commands",
        description: "Commands for managing and executing workflows.",
        commands: ["workflow"],
      },

      // Workspace and profile commands
      [`${DOCS_DIR}/cli/workspace.md`]: {
        title: "Workspace and Profile Commands",
        description: "Commands for managing workspaces and profiles.",
        commands: ["workspace", "profile"],
      },

      // Database commands
      [`${DOCS_DIR}/cli/tailordb.md`]: {
        title: "TailorDB Commands",
        description: "Commands for managing TailorDB operations.",
        commands: ["tailordb"],
      },

      // API and type generator commands
      [`${DOCS_DIR}/cli/api.md`]: {
        title: "API Commands",
        description: "Commands for API operations and type generation.",
        commands: ["api", "type-generator"],
      },
    },
    format: {
      headingLevel: 2,
      optionStyle: "table",
      generateAnchors: true,
    },
  });

  console.log("Documentation generation result:");
  console.log(`Success: ${result.success}`);

  for (const file of result.files) {
    console.log(`  ${file.path}: ${file.status}`);
    if (file.diff) {
      console.log(`    Diff: ${file.diff.substring(0, 200)}...`);
    }
  }

  if (!result.success) {
    console.error("Documentation generation failed:", result.error);
    process.exit(1);
  }
}

main().catch(console.error);
