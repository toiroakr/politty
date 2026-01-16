/**
 * tailor-sdk CLI entry point
 */
import { runMain } from "politty";
import { tailorSdkCommand } from "./command.js";

// Run the CLI
runMain(tailorSdkCommand, { version: "1.0.0" });
