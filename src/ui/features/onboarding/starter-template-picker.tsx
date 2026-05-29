"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ArrowRight } from "lucide-react";
import { Button } from "@ui/components/primitives/button";
import { Card } from "@ui/components/primitives/card";
import { useToast } from "@ui/hooks/use-toast";
import { applyStarterTemplateAction } from "@app/(app)/subscriptions/starter/actions";
import type {
  StarterTemplate,
  StarterTemplateItem,
  StarterTemplateProfile,
} from "@server/domain/onboarding/starter-templates";

/**
 * Two-step picker:
 *   1. Profile select — three big cards, one click chooses
 *   2. Item check-off — grouped by category, individual rows with checkboxes,
 *      plus "Select all in category" / "Clear all" quick actions
 *
 * Submitting calls the server action which creates drafts via the existing
 * `createSubscriptionDraft` path; the user is redirected to `/subscriptions`
 * on success so they see what landed.
 */
export function StarterTemplatePicker({
  templates,
}: {
  templates: StarterTemplate[];
}) {
  const [profile, setProfile] = useState<StarterTemplateProfile | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { toast } = useToast();

  const active = useMemo(
    () => templates.find((t) => t.profile === profile) ?? null,
    [templates, profile]
  );

  const itemsByCategory = useMemo(() => {
    if (!active) return [] as Array<{ category: string; items: StarterTemplateItem[] }>;
    const map = new Map<string, StarterTemplateItem[]>();
    for (const item of active.items) {
      const existing = map.get(item.category) ?? [];
      existing.push(item);
      map.set(item.category, existing);
    }
    return Array.from(map.entries()).map(([category, items]) => ({
      category,
      items,
    }));
  }, [active]);

  const totalAnnualUsd = useMemo(() => {
    if (!active) return 0;
    let sum = 0;
    for (const item of active.items) {
      if (selectedKeys.has(item.key)) sum += item.annualUsd;
    }
    return sum;
  }, [active, selectedKeys]);

  function toggle(key: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectCategory(category: string) {
    if (!active) return;
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      for (const item of active.items) {
        if (item.category === category) next.add(item.key);
      }
      return next;
    });
  }

  function clearAll() {
    setSelectedKeys(new Set());
  }

  function handleApply() {
    if (!profile || selectedKeys.size === 0) return;
    startTransition(async () => {
      const r = await applyStarterTemplateAction({
        profile,
        selectedKeys: Array.from(selectedKeys),
      });
      if (!r.ok) {
        toast({ title: "Couldn't apply template", description: r.formError });
        return;
      }
      router.push("/subscriptions");
      router.refresh();
      toast({
        title: `Created ${r.created} draft${r.created === 1 ? "" : "s"}`,
        description:
          r.skipped > 0
            ? `${r.skipped} skipped — see details on the subscriptions page.`
            : "Open each draft to fill in real term dates and turn it into a tracked renewal.",
      });
    });
  }

  if (!profile) {
    // Step 1 — pick a profile.
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {templates.map((t) => (
          <Card
            key={t.profile}
            className="p-6 cursor-pointer hover:border-primary hover:shadow-card-lg transition"
            role="button"
            tabIndex={0}
            onClick={() => setProfile(t.profile)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") setProfile(t.profile);
            }}
          >
            <div className="space-y-2">
              <div className="font-semibold text-base">{t.label}</div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {t.description}
              </p>
              <div className="text-xs text-muted-foreground pt-1">
                {t.items.length} suggested items
              </div>
            </div>
            <div className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary">
              Choose this
              <ArrowRight className="h-3.5 w-3.5" />
            </div>
          </Card>
        ))}
      </div>
    );
  }

  // Step 2 — pick items within the selected profile.
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2 text-xs">
        <div className="space-y-0.5">
          <div className="font-medium text-sm">{active?.label}</div>
          <div className="text-muted-foreground">
            {selectedKeys.size} selected ·{" "}
            {totalAnnualUsd > 0
              ? `~$${totalAnnualUsd.toLocaleString("en-US")} / year`
              : "no annual cost yet"}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setProfile(null)}
            disabled={pending}
          >
            Switch profile
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={clearAll}
            disabled={pending || selectedKeys.size === 0}
          >
            Clear all
          </Button>
        </div>
      </div>

      <ul className="space-y-4">
        {itemsByCategory.map(({ category, items }) => (
          <li key={category}>
            <div className="flex items-baseline justify-between gap-3 pb-1.5">
              <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                {category}
              </h3>
              <button
                type="button"
                onClick={() => selectCategory(category)}
                disabled={pending}
                className="text-[11px] text-primary hover:underline underline-offset-2"
              >
                Select all in {category}
              </button>
            </div>
            <ul className="space-y-1.5">
              {items.map((item) => {
                const checked = selectedKeys.has(item.key);
                return (
                  <li key={item.key}>
                    <label className="flex items-start gap-3 rounded-md border bg-background px-3 py-2 cursor-pointer hover:bg-muted/30">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(item.key)}
                        disabled={pending}
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm">
                          {item.vendor}{" "}
                          <span className="text-muted-foreground">
                            · {item.product}
                          </span>
                        </div>
                        {item.note && (
                          <div className="text-[11px] text-muted-foreground">
                            {item.note}
                          </div>
                        )}
                      </div>
                      <div className="text-xs tabular-nums text-muted-foreground shrink-0">
                        {item.annualUsd > 0
                          ? `~$${item.annualUsd.toLocaleString("en-US")} /yr`
                          : "—"}
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>

      <div className="flex justify-end gap-3 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => setProfile(null)}
          disabled={pending}
        >
          Back
        </Button>
        <Button
          type="button"
          onClick={handleApply}
          disabled={pending || selectedKeys.size === 0}
        >
          {pending ? "Creating drafts…" : (
            <>
              <Check className="mr-2 h-4 w-4" />
              Create {selectedKeys.size} draft
              {selectedKeys.size === 1 ? "" : "s"}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
