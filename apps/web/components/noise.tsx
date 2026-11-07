"use client";

// React Bits Noise, static tile adaptation (MIT + Commons Clause).
// Uses its seeded grain generator; no frame loop, dust or flicker.
import { useEffect, useRef } from "react";

export function Noise() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const context = canvas.getContext("2d");
    if (!context || !ref.current) return;
    const image = context.createImageData(128, 128);
    let state = 1013904223;
    const random = () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < image.data.length; i += 4) {
      const value = (random() + random()) * 127;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = value;
      image.data[i + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    ref.current.style.backgroundImage = `url(${canvas.toDataURL()})`;
  }, []);
  return <div ref={ref} className="noise" aria-hidden="true" />;
}
