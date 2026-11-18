import type { AnyCommand, MainOptions, RunCommandOptions } from "../types.js";

export const RECORDED_CLI_KEY = "politty.recordedCli";

export interface RecordedCli {
  command: AnyCommand;
  options: MainOptions;
}

interface RecordedCliSlot {
  capturing?: boolean;
  recorded?: RecordedCli;
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

export function clearRecordedCli(): void {
  const current = slot();
  delete current.recorded;
  delete current.capturing;
  delete current.onRecord;
}

export function inheritableRunOptions(recorded: RecordedCli): RunCommandOptions {
  const { globalArgs, setup, cleanup } = recorded.options;
  return {
    ...(globalArgs ? { globalArgs } : {}),
    ...(setup ? { setup } : {}),
    ...(cleanup ? { cleanup } : {}),
  };
}
