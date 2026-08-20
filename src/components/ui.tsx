import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import type { RecordRole, StatusTone } from "@/lib/view-model";
import { GrokBot } from "@/components/grok-bot";
import { UfoBeam } from "@/components/ufo-beam";

export function cn(...inputs: Parameters<typeof clsx>) {
  return twMerge(clsx(inputs));
}

/* ---------- Button ---------- */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "press inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45",
        size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-[13px]",
        variant === "primary" && "btn-solid",
        variant === "secondary" &&
          "btn-ghost border border-stroke-strong bg-transparent text-foreground hover:bg-hover",
        variant === "ghost" && "text-muted hover:bg-hover hover:text-foreground",
        variant === "danger" &&
          "border border-danger/30 bg-transparent text-danger hover:bg-danger/10",
        className,
      )}
      {...props}
    />
  );
}

/* ---------- Card ---------- */

export function Card({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("card-lift rounded-lg border border-stroke bg-elevated", className)}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  trailing,
  className,
}: {
  title: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-9 items-center justify-between border-b border-stroke px-3.5",
        className,
      )}
    >
      <span className="text-xs font-medium text-muted">{title}</span>
      {trailing}
    </div>
  );
}

/* ---------- Status badge ---------- */

const toneDot: Record<StatusTone, string> = {
  neutral: "bg-faint",
  active: "bg-accent animate-pulse-dot",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

const toneText: Record<StatusTone, string> = {
  neutral: "text-muted",
  active: "text-accent",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

export function StatusBadge({
  label,
  tone,
  className,
}: {
  label: string;
  tone: StatusTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-stroke px-2 py-0.5 text-[11px] font-medium",
        toneText[tone],
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", toneDot[tone])} />
      {label}
    </span>
  );
}

/* ---------- Evidence role badge: shape + fill differ, not just hue ---------- */

export function RoleBadge({ role }: { role: RecordRole }) {
  if (role === "owned") {
    return (
      <span className="inline-flex items-center rounded-md bg-foreground px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-background uppercase">
        Owned
      </span>
    );
  }
  if (role === "external") {
    return (
      <span className="inline-flex items-center rounded-md border border-stroke-strong px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted uppercase">
        External
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-md border border-stroke px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-faint uppercase">
      Reference
    </span>
  );
}

/* ---------- Platform wordmark (text, no colored squircle) ---------- */

export function PlatformMark({ platform }: { platform: string }) {
  return (
    <span className="text-[11px] font-medium tracking-wide text-faint">
      {platform}
    </span>
  );
}

/* ---------- Stat ---------- */

export function Stat({
  value,
  label,
  className,
}: {
  value: ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="tnum text-lg font-semibold tracking-tight">{value}</p>
      <p className="text-[11px] text-faint">{label}</p>
    </div>
  );
}

/* ---------- Empty state ---------- */

export function EmptyState({
  title,
  body,
  action,
  icon = "bot",
}: {
  title: string;
  body?: string;
  action?: ReactNode;
  icon?: "bot" | "ufo";
}) {
  return (
    <div className="rounded-lg border border-dashed border-stroke-strong px-6 py-10 text-center">
      {icon === "ufo" ? (
        <UfoBeam className="mascot-float mx-auto mb-4 size-14 text-accent" />
      ) : (
        <GrokBot className="mascot-float mx-auto mb-4 size-16 opacity-90" />
      )}
      <p className="text-sm font-medium">{title}</p>
      {body ? (
        <p className="mx-auto mt-1.5 max-w-md text-xs leading-5 text-muted">{body}</p>
      ) : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

/* ---------- Section heading ---------- */

export function SectionHeading({
  title,
  meta,
  className,
}: {
  title: ReactNode;
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-end justify-between gap-4", className)}>
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      {meta ? <span className="text-[11px] text-faint">{meta}</span> : null}
    </div>
  );
}
