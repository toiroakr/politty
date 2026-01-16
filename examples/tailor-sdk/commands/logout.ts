import { defineCommand } from "politty";

/**
 * End your Tailor Platform session
 */
export const logoutCommand = defineCommand({
  name: "logout",
  description: "End your Tailor Platform session",
  notes: "This invalidates your OAuth2 token and removes local credentials.",
  examples: [
    {
      description: "Logout from Tailor Platform",
      input: "tailor-sdk logout",
    },
  ],
  run: () => {
    console.log("logout");
  },
});
