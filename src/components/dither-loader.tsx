"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/components/ui";

/* 4x4 Bayer threshold matrix — the classic ordered-dither pattern */
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/* Cheap deterministic value noise */
function noise(x: number, y: number, t: number): number {
  const s = Math.sin(x * 0.9 + t * 0.7) * Math.cos(y * 0.7 - t * 0.5);
  const r = Math.sin((x + y) * 0.35 + t * 0.9) * 0.5;
  return (s + r + 1.5) / 3;
}

/**
 * Ordered-dither particle field. Renders a low-res Bayer-dithered
 * noise field onto a canvas, scaled up with pixelated rendering.
 * Used wherever the product is thinking: planning, running, writing.
 */
export function DitherField({
  className,
  cells = 96,
  rows = 20,
  fps = 14,
}: {
  className?: string;
  cells?: number;
  rows?: number;
  fps?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = cells;
    canvas.height = rows;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const accent = getComputedStyle(document.documentElement)
      .getPropertyValue("--accent")
      .trim() || "#c9a25a";

    let raf = 0;
    let last = 0;
    const frame = (now: number) => {
      if (now - last >= 1000 / fps) {
        last = now;
        const t = now / 1000;
        ctx.clearRect(0, 0, cells, rows);
        ctx.fillStyle = accent;
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cells; x++) {
            const v = noise(x, y, reduced ? 0 : t);
            const threshold = (BAYER[y % 4][x % 4] + 0.5) / 16;
            if (v > threshold) {
              ctx.fillRect(x, y, 1, 1);
            }
          }
        }
      }
      if (!reduced) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [cells, rows, fps]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={cn("h-5 w-24 [image-rendering:pixelated]", className)}
    />
  );
}

/** Full-block loading state: dither field + label with trailing-dot pulse. */
export function DitherLoader({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-stroke-strong px-6 py-10",
        className,
      )}
    >
      <DitherField cells={112} rows={22} className="h-8 w-40" />
      <p className="text-xs text-muted">
        {label}
        <span className="animate-pulse-dot">…</span>
      </p>
    </div>
  );
}
