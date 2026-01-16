/**
 * tailor-sdk CLI command definition
 * This demonstrates that politty can replicate citty's command structure
 */
import { defineCommand } from "politty";

// Import all commands
import { apiCommand } from "./commands/api.js";
import { applyCommand } from "./commands/apply.js";
import { generateCommand } from "./commands/generate.js";
import { initCommand } from "./commands/init.js";
import { loginCommand } from "./commands/login.js";
import { logoutCommand } from "./commands/logout.js";
import { machineuserCommand } from "./commands/machineuser/index.js";
import { oauth2clientCommand } from "./commands/oauth2client/index.js";
import { profileCommand } from "./commands/profile/index.js";
import { removeCommand } from "./commands/remove.js";
import { secretCommand } from "./commands/secret/index.js";
import { showCommand } from "./commands/show.js";
import { staticwebsiteCommand } from "./commands/staticwebsite/index.js";
import { tailordbCommand } from "./commands/tailordb/index.js";
import { typeGeneratorCommand } from "./commands/type-generator.js";
import { userCommand } from "./commands/user/index.js";
import { workflowCommand } from "./commands/workflow/index.js";
import { workspaceCommand } from "./commands/workspace/index.js";

/**
 * tailor-sdk main command
 */
export const tailorSdkCommand = defineCommand({
  name: "tailor-sdk",
  description: "Tailor Platform SDK CLI - Build and deploy applications on Tailor Platform",
  notes: `For more information, visit https://docs.tailor.tech

Environment Variables:
  TAILOR_PLATFORM_TOKEN  Access token for authentication
  TAILOR_WORKSPACE_ID    Default workspace ID`,
  subCommands: {
    login: loginCommand,
    logout: logoutCommand,
    init: initCommand,
    generate: generateCommand,
    apply: applyCommand,
    remove: removeCommand,
    show: showCommand,
    user: userCommand,
    workspace: workspaceCommand,
    profile: profileCommand,
    workflow: workflowCommand,
    secret: secretCommand,
    staticwebsite: staticwebsiteCommand,
    machineuser: machineuserCommand,
    oauth2client: oauth2clientCommand,
    tailordb: tailordbCommand,
    api: apiCommand,
    "type-generator": typeGeneratorCommand,
  },
});
