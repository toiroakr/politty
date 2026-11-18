import { AsyncLocalStorage } from "node:async_hooks";
import type { AnyCommand, MainOptions, RunCommandOptions } from "../types.js";

export const RECORDED_CLI_KEY = "politty.recordedCli";

export interface RecordedCli {
  command: AnyCommand;
  options: MainOptions;
}

interface RecordedCliSlot {
  capturing?: boolean;
  recorded?: RecordedCli;
  entry?: string;
  loader?: () => Promise<void>;
  loading?: Promise<void>;
  onRecord?: () => void;
}

const slot = (): RecordedCliSlot => {
  const holder = globalThis as unknown as Record<symbol, RecordedCliSlot | undefined>;
  return (holder[Symbol.for(RECORDED_CLI_KEY)] ??= {});
};

export function isRecordingCli(): boolean {
  return slot().capturing === true;
}

export function recordCli(command: AnyCommand, options: MainOptions): void {
  const current = slot();
  current.recorded = { command, options };
  current.onRecord?.();
}

export function getRecordedCli(): RecordedCli | undefined {
  return slot().recorded;
}

export function ensureRecordedCli(): Promise<void> {
  const current = slot();
  if (current.recorded || !current.loader) return Promise.resolve();
  current.loading ??= current.loader().catch((error: unknown) => {
    delete current.loading;
    throw error;
  });
  return current.loading;
}

export function clearRecordedCli(): void {
  const current = slot();
  delete current.recorded;
  delete current.entry;
  delete current.loader;
  delete current.loading;
  delete current.capturing;
  delete current.onRecord;
}

const hookScope = new AsyncLocalStorage<true>();

export function isInRecordedHook(): boolean {
  return hookScope.getStore() === true;
}

export function inheritableRunOptions(recorded: RecordedCli): RunCommandOptions {
  const { globalArgs, setup, cleanup } = recorded.options;
  return {
    ...(globalArgs ? { globalArgs } : {}),
    ...(setup ? { setup: (context) => hookScope.run(true, () => setup(context)) } : {}),
    ...(cleanup ? { cleanup: (context) => hookScope.run(true, () => cleanup(context)) } : {}),
  };
}
