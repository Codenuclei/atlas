"use client";

import { useEffect, useRef } from "react";

export type BotMood = "idle" | "typing" | "thinking" | "working" | "done" | "error";

const MOOD_CLASS: Record<BotMood, string> = {
  idle: "",
  typing: "bot-typing",
  thinking: "bot-thinking",
  working: "bot-working",
  done: "bot-done",
  error: "bot-error",
};

// Eye centers in the 512×512 viewBox — levelled to the same axis
const EYES = [
  { cx: 190, cy: 288 },
  { cx: 297, cy: 288 },
];

function EyeShape({ mood, cx, cy }: { mood: BotMood; cx: number; cy: number }) {
  if (mood === "done") {
    return (
      <path
        d={`M ${cx - 22} ${cy + 8} Q ${cx} ${cy - 26} ${cx + 22} ${cy + 8}`}
        stroke="#303001"
        strokeWidth={11}
        strokeLinecap="round"
        fill="none"
      />
    );
  }
  if (mood === "error") {
    return (
      <g stroke="#303001" strokeWidth={10} strokeLinecap="round">
        <line x1={cx - 15} y1={cy - 15} x2={cx + 15} y2={cy + 15} />
        <line x1={cx - 15} y1={cy + 15} x2={cx + 15} y2={cy - 15} />
      </g>
    );
  }
  return <rect x={cx - 20} y={cy - 35} width={40} height={70} rx={20} fill="#303001" />;
}

/**
 * The dithered grok-bot cloud with live eyes. Cursor tracking and mood
 * animations share one stable DOM tree — mood changes never remount the
 * tilt / eye nodes (that was freezing the bot after typing).
 */
export function GrokBot({
  mood = "idle",
  className,
}: {
  mood?: BotMood;
  className?: string;
}) {
  const tiltRef = useRef<HTMLDivElement>(null);
  const moodElRef = useRef<HTMLDivElement>(null);
  const gazeRef = useRef<SVGGElement>(null);
  const eyeRefs = useRef<Array<SVGGElement | null>>([]);
  const look = useRef({ x: 0, y: 0 });
  const smooth = useRef({ x: 0, y: 0 });
  const moodRef = useRef<BotMood>(mood);
  moodRef.current = mood;

  // Restart CSS mood animation without remounting (keeps eye refs alive)
  useEffect(() => {
    const el = moodElRef.current;
    if (!el) return;
    el.className = MOOD_CLASS[mood];
    el.style.animation = "none";
    // force reflow so the next animation frame restarts cleanly
    void el.offsetWidth;
    el.style.animation = "";
  }, [mood]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    function onMove(event: MouseEvent) {
      const node = tiltRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      look.current = {
        x: Math.max(-1, Math.min(1, (event.clientX - cx) / 320)),
        y: Math.max(-1, Math.min(1, (event.clientY - cy) / 320)),
      };
    }
    window.addEventListener("mousemove", onMove);

    let raf = 0;
    const loop = (now: number) => {
      const node = tiltRef.current;
      const t = now / 1000;
      const m = moodRef.current;

      smooth.current.x += (look.current.x - smooth.current.x) * 0.1;
      smooth.current.y += (look.current.y - smooth.current.y) * 0.1;
      const { x, y } = smooth.current;

      if (node) {
        node.style.transform = `translate(${x * 7}px, ${y * 5}px) rotate(${x * 5}deg)`;
      }

      let gx = x * 14;
      let gy = y * 10;
      if (m === "typing") {
        gx = x * 7;
        gy = 13;
      } else if (m === "thinking") {
        gx = -9;
        gy = -13;
      } else if (m === "working") {
        gx = Math.sin(t * 2.6) * 13;
        gy = -2;
      }
      gazeRef.current?.setAttribute("transform", `translate(${gx} ${gy})`);

      const blink = (m === "idle" || m === "typing") && t % 4.2 > 4.02;
      EYES.forEach(({ cx, cy }, i) => {
        eyeRefs.current[i]?.setAttribute(
          "transform",
          blink ? `translate(${cx} ${cy}) scale(1 0.15) translate(${-cx} ${-cy})` : "",
        );
      });

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  return (
    <div ref={tiltRef} className="will-change-transform">
      <div ref={moodElRef}>
        <div
          role="img"
          aria-label={`Atlas, the research bot — ${mood}`}
          className={`relative size-36 select-none${className ? ` ${className}` : ""}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/grok-bot-body.svg"
            alt=""
            className="absolute inset-0 size-full"
            draggable={false}
          />
          <svg viewBox="0 0 512 512" className="absolute inset-0 size-full" aria-hidden="true">
            <g ref={gazeRef}>
              {EYES.map(({ cx, cy }, i) => (
                <g
                  key={i}
                  ref={(el) => {
                    eyeRefs.current[i] = el;
                  }}
                >
                  <EyeShape mood={mood} cx={cx} cy={cy} />
                </g>
              ))}
            </g>
          </svg>
        </div>
      </div>
    </div>
  );
}
