"use client";

import { useEffect, useRef, useState } from "react";
import {
  registerCommands,
  subscribeCommands,
  type RegisteredCommand,
} from "@/lib/commands/registry";

/**
 * Surface-side: register commands while this component is mounted.
 *
 * The commands array may be recomputed every render without penalty —
 * we re-register only when the set of ids changes, so stable action
 * closures don't churn the palette.
 */
export function useCommands(commands: RegisteredCommand[]): void {
  const tokenRef = useRef<symbol>(Symbol("commands-owner"));
  const latestRef = useRef<RegisteredCommand[]>(commands);
  latestRef.current = commands;

  const key = commands.map((c) => c.id).join("|");

  useEffect(() => {
    return registerCommands(tokenRef.current, latestRef.current);
    // Re-register only when the shape of the command set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/**
 * Palette-side: observe the live set of registered commands.
 */
export function useRegisteredCommands(): RegisteredCommand[] {
  const [cmds, setCmds] = useState<RegisteredCommand[]>(() => []);
  useEffect(() => subscribeCommands(setCmds), []);
  return cmds;
}
