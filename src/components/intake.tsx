"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  CalendarBlank,
  Globe,
  InstagramLogo,
  Sparkle,
  Spinner,
  YoutubeLogo,
} from "@phosphor-icons/react";
import { Button, cn } from "@/components/ui";
import { GrokBot, type BotMood } from "@/components/grok-bot";
import { OwnedChannelField } from "@/components/owned-channel-field";

export type IntakeValues = {
  query: string;
  platforms: "both" | "youtube" | "instagram" | "yc";
  dateRange: "30" | "90" | "365";
  ownedHandles: string;
};

const TEMPLATES = [
  {
    label: "Analyze a channel",
    query: "Analyze content for Masters Union across YouTube and Instagram",
    platforms: "both" as const,
    ownedHandles: "@MastersUnion",
  },
  {
    label: "Find external creatives",
    query: "Find high-performing external creatives about AI education for founders",
    platforms: "both" as const,
    ownedHandles: "",
  },
  {
    label: "YC fintech companies",
    query: "YC companies in fintech",
    platforms: "yc" as const,
    ownedHandles: "",
  },
  {
    label: "YC current batch + founders",
    query: "YC current batch founders",
    platforms: "yc" as const,
    ownedHandles: "",
  },
  {
    label: "Compare a market",
    query: "YC companies hiring in fintech",
    platforms: "yc" as const,
    ownedHandles: "",
  },
];

const TYPE_PHRASES = [
  "Analyze content for Acme across YouTube and Instagram…",
  "Find external creatives about AI infra for founders…",
  "What are the best-performing reels about solo travel in Japan?",
  "Compare my channel against the top three competitors…",
];

/** Types, pauses, deletes, and moves to the next phrase. */
function useTypewriter(phrases: string[]) {
  const [text, setText] = useState("");
  const state = useRef({ phrase: 0, char: 0, deleting: false });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const s = state.current;
      const full = phrases[s.phrase];
      let delay = 34;
      if (!s.deleting) {
        s.char += 1;
        if (s.char >= full.length) {
          s.deleting = true;
          delay = 2200;
        }
      } else {
        s.char -= 3;
        delay = 14;
        if (s.char <= 0) {
          s.char = 0;
          s.deleting = false;
          s.phrase = (s.phrase + 1) % phrases.length;
          delay = 500;
        }
      }
      setText(full.slice(0, Math.max(0, s.char)));
      timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, 600);
    return () => clearTimeout(timer);
  }, [phrases]);

  return text;
}

/** Compose the planner input from structured intake values. */
export function composeQuery(values: IntakeValues): string {
  const parts = [values.query.trim()];
  const scope: string[] = [];
  if (values.platforms === "youtube") scope.push("YouTube only");
  else if (values.platforms === "instagram") scope.push("Instagram only");
  else if (values.platforms === "yc") scope.push("Y Combinator companies and founders");
  if (values.platforms !== "yc" && values.dateRange !== "365") {
    scope.push(`last ${values.dateRange} days`);
  }
  if (values.platforms !== "yc" && values.ownedHandles.trim()) {
    scope.push(`owned channels: ${values.ownedHandles.trim()}`);
  }
  if (scope.length) parts.push(`Scope: ${scope.join("; ")}.`);
  return parts.join("\n\n");
}

/** Classic YC mark — icon-sized for the platform rail. */
function YcMark({ size = 14 }: { size?: number; weight?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="rounded-[2px]"
    >
      <rect width="16" height="16" rx="2" fill="#F26522" />
      <path
        d="M4.2 3.2h2.15L8 7.35 9.65 3.2H11.8L9.05 8.6V12.8H6.95V8.6L4.2 3.2Z"
        fill="#fff"
      />
    </svg>
  );
}

const PLATFORM_OPTIONS = [
  { id: "both", label: "Both", icon: Globe },
  { id: "youtube", label: "YouTube", icon: YoutubeLogo },
  { id: "instagram", label: "Instagram", icon: InstagramLogo },
  { id: "yc", label: "Y Combinator", icon: YcMark },
] as const;

export function ResearchIntake({
  onSubmit,
  pending,
  mood = "idle",
}: {
  onSubmit: (values: IntakeValues) => void;
  pending: boolean;
  mood?: BotMood;
}) {
  const [values, setValues] = useState<IntakeValues>({
    query: "",
    platforms: "both",
    dateRange: "90",
    ownedHandles: "",
  });
  const [focused, setFocused] = useState(false);
  const typed = useTypewriter(TYPE_PHRASES);

  function applyTemplate(template: (typeof TEMPLATES)[number]) {
    setValues((current) => ({
      ...current,
      query: template.query,
      platforms: template.platforms,
      ownedHandles: template.ownedHandles,
    }));
  }

  const valid = values.query.trim().length >= 3;
  const botMood: BotMood =
    mood !== "idle" ? mood : focused ? "typing" : "idle";

  return (
    <section className="space-y-4">
          <div className="flex flex-col items-center pt-4 text-center">
            <div
              className="mascot-float appear appear--pop"
              style={{ "--d": "0.05s" } as CSSProperties}
            >
              <GrokBot mood={botMood} />
            </div>
        <h1 className="mt-2 text-[34px] leading-[1.12] font-medium tracking-[-0.045em]">
          <span className="headline-line appear appear--mask" style={{ "--d": "0.22s" } as CSSProperties}>
            What should we <em className="display text-secondary">go find</em>?
          </span>
        </h1>
      </div>

      <div className="intake-shell card-lift appear appear--btn rounded-lg border border-stroke bg-elevated" style={{ "--d": "0.4s" } as CSSProperties}>
        <div className="relative">
          <textarea
            value={values.query}
            onChange={(event) =>
              setValues((current) => ({ ...current, query: event.target.value }))
            }
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            rows={3}
            aria-label="Research query"
            className="w-full resize-none rounded-t-lg bg-transparent px-4 py-3.5 text-[14px] leading-6 focus:outline-none"
          />
          {values.query === "" && !focused ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-4 top-3.5 text-[14px] leading-6 text-faint"
            >
              {typed}
              <span className="caret-blink ml-px inline-block h-[15px] w-[1.5px] translate-y-[2px] bg-accent" />
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-stroke px-4 py-3">
          <div className="flex rounded-md border border-stroke">
            {PLATFORM_OPTIONS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() =>
                  setValues((current) => ({ ...current, platforms: id }))
                }
                aria-label={`${label} platforms`}
                data-tip={label === "Both" ? "YouTube + Instagram" : label}
                className={cn(
                  "tip press grid h-7 w-8 place-items-center transition-colors first:rounded-l-md last:rounded-r-md",
                  values.platforms === id
                    ? "bg-active text-foreground"
                    : "text-muted hover:text-foreground",
                )}
              >
                <Icon size={14} weight={values.platforms === id ? "fill" : "regular"} />
              </button>
            ))}
          </div>

          <label className="flex h-7 items-center gap-1.5 rounded-md border border-stroke pl-2 pr-1">
            <CalendarBlank size={13} className="shrink-0 text-faint" />
            <select
              value={values.dateRange}
              aria-label="Recency"
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  dateRange: event.target.value as IntakeValues["dateRange"],
                }))
              }
              className="h-full bg-transparent pr-1 text-xs text-foreground focus:outline-none"
            >
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="365">Last year</option>
            </select>
          </label>

          <OwnedChannelField
            value={values.ownedHandles}
            onChange={(ownedHandles) =>
              setValues((current) => ({ ...current, ownedHandles }))
            }
            className="w-[13.5rem] max-w-[13.5rem] flex-none"
          />

          <Button
            onClick={() => onSubmit(values)}
            disabled={!valid || pending}
            className="btn-cta ml-auto font-semibold"
          >
            {pending ? (
              <>
                <Spinner size={13} className="animate-spin" />
                Generating plan…
              </>
            ) : (
              <>
                <Sparkle size={13} weight="fill" />
                Generate plan
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="appear appear--soft flex flex-wrap items-center justify-center gap-2" style={{ "--d": "0.56s" } as CSSProperties}>
        {TEMPLATES.map((template) => (
          <button
            key={template.label}
            type="button"
            onClick={() => applyTemplate(template)}
            className="press template-chip rounded-md border border-stroke-strong px-2.5 py-1 text-xs text-secondary transition-[color,background-color,box-shadow,border-color,transform] duration-200 hover:bg-hover hover:text-foreground"
          >
            {template.label}
          </button>
        ))}
      </div>
    </section>
  );
}
