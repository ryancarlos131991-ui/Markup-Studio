import { useSyncExternalStore } from "react";
import { createRegistry } from "../cli/commands";
import { CommandEngine } from "../cli/engine";
import type { EngineSnapshot } from "../cli/types";
import { setWorkspaceLogger } from "../store/workspace";
import { createEngineHost } from "./engineHost";

/** The single CLI engine for the app window. */
export const engine = new CommandEngine(createEngineHost(), createRegistry());

setWorkspaceLogger((text, kind) => engine.print(text, kind));

export function useEngine(): EngineSnapshot {
  return useSyncExternalStore(engine.subscribe, engine.getSnapshot);
}
