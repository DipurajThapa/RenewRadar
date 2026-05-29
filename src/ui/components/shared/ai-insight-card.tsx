import { Sparkles } from "lucide-react";
import { Badge } from "@ui/components/primitives/badge";
import { Card, CardContent } from "@ui/components/primitives/card";
import { cn } from "@shared/utils";

/**
 * Single shared shell for every AI-generated insight surface in the product.
 *
 * Why one component:
 *   - Consistent visual treatment makes "this is AI-generated" unambiguous
 *     regardless of where in the product the user sees it.
 *   - Provider/confidence labels in the header are required by binding
 *     principle 3 (transparency) — the user should always know which model
 *     spoke and how confident it is.
 *   - The "low confidence" tone tweak ships once here, not per surface.
 *
 * Composition: every insight surface assembles its own body (headline,
 * rationale, action list) via children.
 */
export function AIInsightCard({
  title,
  meta,
  className,
  children,
}: {
  title: string;
  meta: {
    provider: string;
    model: string;
    promptVersion: string;
    confidencePct: number;
  };
  className?: string;
  children: React.ReactNode;
}) {
  const lowConfidence = meta.confidencePct < 65;
  return (
    <Card
      className={cn(
        "border-primary/30 bg-primary/[0.03] relative overflow-hidden",
        className
      )}
    >
      {/* subtle ribbon to differentiate AI surfaces from data cards */}
      <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-primary/40 via-primary/60 to-primary/40" />
      <CardContent className="py-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            <div className="text-xs font-medium uppercase tracking-wide text-primary-strong">
              {title}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Badge
              variant={lowConfidence ? "outline" : "secondary"}
              className="text-[10px] tabular-nums"
              title={`Confidence ${meta.confidencePct}% — ${meta.provider} (${meta.model}) prompt ${meta.promptVersion}`}
            >
              {meta.confidencePct}% confidence
            </Badge>
          </div>
        </div>
        <div className="space-y-2 text-sm">{children}</div>
        <p className="text-[11px] text-muted-foreground leading-snug pt-1 border-t border-border/60">
          AI-generated synthesis from your own data. Not legal or financial
          advice. Verify before acting.
        </p>
      </CardContent>
    </Card>
  );
}
