"use client";

import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { HaloSegmented } from "./ui/halo-segmented";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function ThemeSelector() {
  const mounted = useSyncExternalStore(
    subscribe,
    clientSnapshot,
    serverSnapshot,
  );
  const { theme, setTheme } = useTheme();
  return (
    <HaloSegmented
      value={mounted ? (theme ?? "system") : ""}
      disabled={!mounted}
      onValueChange={setTheme}
    />
  );
}
