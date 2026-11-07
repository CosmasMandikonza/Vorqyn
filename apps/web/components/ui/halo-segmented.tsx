"use client";

// Cult UI Halo Segmented (MIT), adapted to mineral tokens and 44px targets.
// Removed looping rainbow halo. Keeps Base UI roving focus and measured thumb.
import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { motion, useReducedMotion } from "motion/react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

export function HaloSegmented({ value, onValueChange, disabled = false }: { value: string; onValueChange: (value: string) => void; disabled?: boolean }) {
  const track = useRef<HTMLDivElement>(null);
  const items = useRef(new Map<string, HTMLButtonElement>());
  const [thumb, setThumb] = useState({ x: 0, width: 0 });
  const reducedMotion = useReducedMotion();
  const measure = useCallback(() => {
    const active = items.current.get(value);
    const parent = track.current;
    if (!active || !parent) return;
    const a = active.getBoundingClientRect();
    const p = parent.getBoundingClientRect();
    setThumb({ x: a.left - p.left, width: a.width });
  }, [value]);
  useLayoutEffect(() => { measure(); }, [measure]);
  useLayoutEffect(() => {
    if (!track.current) return;
    const observer = new ResizeObserver(measure);
    observer.observe(track.current);
    return () => observer.disconnect();
  }, [measure]);
  return <div className="halo-segmented" ref={track}>
    <motion.span aria-hidden="true" className="halo-thumb" initial={false}
      animate={{ x: thumb.x, width: thumb.width }}
      transition={reducedMotion ? { duration: 0 } : { type: "spring", bounce: 0.12, damping: 34, stiffness: 420 }} />
    <ToggleGroup aria-label="Color theme" className="halo-options" disabled={disabled} multiple={false} value={value ? [value] : []}
      onValueChange={(next) => { if (next[0]) onValueChange(next[0]); }}>
      {["light", "dark", "system"].map((item) => <Toggle key={item} value={item}
        ref={(element) => { if (element) items.current.set(item, element); else items.current.delete(item); }}>
        {item.charAt(0).toUpperCase() + item.slice(1)}
      </Toggle>)}
    </ToggleGroup>
  </div>;
}
