"use client";

import { useState, useTransition } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { saveNotificationPrefsAction } from "@/app/(app)/settings/notifications/actions";

type Prefs = Record<string, { email: boolean; in_app: boolean }>;

type PrefRow = {
  trigger: string;
  label: string;
  description: string;
  inAppApplicable: boolean;
  locked?: boolean;
};

type PrefGroup = {
  label: string;
  rows: PrefRow[];
};

const GROUPS: PrefGroup[] = [
  {
    label: "Notice deadline alerts",
    rows: [
      {
        trigger: "notice_window_30",
        label: "30 days before notice deadline",
        description: "Early heads-up that the notice window is opening",
        inAppApplicable: true,
      },
      {
        trigger: "notice_window_14",
        label: "14 days before notice deadline",
        description: "Time to think about it before the urgency hits",
        inAppApplicable: true,
      },
      {
        trigger: "notice_window_7",
        label: "7 days before notice deadline",
        description: "Action needed — non-mutable wedge protection",
        inAppApplicable: true,
        locked: true,
      },
      {
        trigger: "notice_window_3",
        label: "3 days before notice deadline",
        description: "Final week — non-mutable",
        inAppApplicable: true,
        locked: true,
      },
      {
        trigger: "notice_window_1",
        label: "1 day before notice deadline",
        description: "Last chance — non-mutable",
        inAppApplicable: true,
        locked: true,
      },
    ],
  },
  {
    label: "Digests and summaries",
    rows: [
      {
        trigger: "weekly_digest",
        label: "Weekly digest",
        description: "Friday morning summary of the week ahead",
        inAppApplicable: false,
      },
      {
        trigger: "monthly_summary",
        label: "Monthly summary PDF",
        description: "First-of-month report you can forward to finance",
        inAppApplicable: false,
      },
    ],
  },
];

export function NotificationPrefsForm({
  currentPrefs,
}: {
  currentPrefs: Prefs;
}) {
  const [prefs, setPrefs] = useState<Prefs>(() => mergeDefaults(currentPrefs));
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<
    | { kind: "success" }
    | { kind: "error"; message: string }
    | null
  >(null);

  function toggle(
    trigger: string,
    channel: "email" | "in_app",
    value: boolean
  ) {
    setPrefs((prev) => ({
      ...prev,
      [trigger]: {
        email: prev[trigger]?.email ?? true,
        in_app: prev[trigger]?.in_app ?? true,
        [channel]: value,
      },
    }));
  }

  function handleSave() {
    setFeedback(null);
    startTransition(async () => {
      const result = await saveNotificationPrefsAction(prefs);
      if (result.ok) {
        setFeedback({ kind: "success" });
        setTimeout(() => setFeedback(null), 3000);
      } else {
        setFeedback({ kind: "error", message: result.error });
      }
    });
  }

  return (
    <div className="space-y-8">
      {GROUPS.map((group) => (
        <section key={group.label}>
          <h3 className="font-semibold text-sm mb-3">{group.label}</h3>
          <div className="space-y-3">
            {group.rows.map((row) => {
              const pref = prefs[row.trigger] ?? {
                email: true,
                in_app: true,
              };
              return (
                <div
                  key={row.trigger}
                  className={cn(
                    "flex items-start justify-between gap-4 py-2 border-b border-gray-100 last:border-0",
                    row.locked && "bg-muted/20 rounded-md px-2 -mx-2"
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Label className="text-sm font-medium">
                        {row.label}
                      </Label>
                      {row.locked && (
                        <span className="inline-flex items-center text-xs text-muted-foreground gap-1">
                          <Lock className="h-3 w-3" />
                          required
                        </span>
                      )}
                    </div>
                    {row.description && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {row.description}
                      </p>
                    )}
                  </div>

                  <div className="flex gap-4 shrink-0 pt-1">
                    <CheckboxToggle
                      label="Email"
                      checked={pref.email}
                      disabled={row.locked}
                      onChange={(v) =>
                        !row.locked && toggle(row.trigger, "email", v)
                      }
                    />
                    {row.inAppApplicable && (
                      <CheckboxToggle
                        label="In-app"
                        checked={pref.in_app}
                        disabled={row.locked}
                        onChange={(v) =>
                          !row.locked && toggle(row.trigger, "in_app", v)
                        }
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <div className="flex items-center gap-3 pt-2 border-t">
        <Button onClick={handleSave} disabled={pending}>
          {pending ? "Saving..." : "Save preferences"}
        </Button>
        {feedback?.kind === "success" && (
          <span className="text-sm text-green-700">Preferences saved</span>
        )}
        {feedback?.kind === "error" && (
          <span className="text-sm text-red-600">{feedback.message}</span>
        )}
      </div>
    </div>
  );
}

function CheckboxToggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "flex items-center gap-2 text-sm select-none",
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="h-4 w-4 rounded border-input"
      />
      <span>{label}</span>
    </label>
  );
}

function mergeDefaults(existing: Prefs): Prefs {
  // Ensure every trigger in our UI has a value, defaulting to "on"
  const merged: Prefs = { ...existing };
  for (const group of GROUPS) {
    for (const row of group.rows) {
      if (!merged[row.trigger]) {
        merged[row.trigger] = { email: true, in_app: true };
      }
    }
  }
  return merged;
}
