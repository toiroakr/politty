import { defineCommand } from "politty";

/**
 * Login to Tailor Platform using OAuth2 authentication
 */
export const loginCommand = defineCommand({
  name: "login",
  description: "Authenticate with Tailor Platform",
  notes: `This command starts an OAuth2 authentication flow:
1. Opens your browser to the Tailor Platform login page
2. Waits for authentication to complete
3. Stores the access token locally`,
  examples: [
    {
      description: "Login to Tailor Platform",
      input: "tailor-sdk login",
    },
  ],
  run: () => {
    console.log("login");
  },
});
