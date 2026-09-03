"use client";

import { Warning, WarningCircle } from "@phosphor-icons/react";
import { cn } from "@/components/ui";
import type { ServiceAlert } from "@/lib/service-errors";

export function ServiceAlertBanner({ alerts }: { alerts: ServiceAlert[] }) {
  if (!alerts.length) return null;
  return (
    <div className="space-y-2">
      {alerts.map((alert) => (
        <div
          key={alert.service}
          className={cn(
            "flex gap-3 rounded-lg border px-3.5 py-3 text-xs leading-5",
            alert.tone === "danger"
              ? "border-danger/30 bg-danger-muted text-danger"
              : "border-warning/30 bg-warning-muted text-warning",
          )}
          role="alert"
        >
          {alert.tone === "danger" ? (
            <WarningCircle size={16} className="mt-0.5 shrink-0" />
          ) : (
            <Warning size={16} className="mt-0.5 shrink-0" />
          )}
          <div className="min-w-0">
            <p className="font-medium">{alert.title}</p>
            <p className="mt-0.5 text-muted">{alert.message}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
