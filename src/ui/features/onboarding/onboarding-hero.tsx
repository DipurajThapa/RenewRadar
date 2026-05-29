import Link from "next/link";
import {
  ArrowRight,
  CheckSquare,
  FileSpreadsheet,
  FileText,
  Mail,
  Pencil,
  Sparkles,
  Upload,
} from "lucide-react";
import { Button } from "@ui/components/primitives/button";
import { Card } from "@ui/components/primitives/card";
import { Badge } from "@ui/components/primitives/badge";

/**
 * First-run onboarding hero — replaces the empty-dashboard state when an
 * account has zero subscriptions.
 *
 * Design intent (P8.4):
 *   - Upload-first remains the dominant CTA because contract upload is the
 *     highest-correlated activation event in the data. It's the visual
 *     centerpiece.
 *   - The three alternative paths (spreadsheet, manual, sample) are now
 *     first-class tiles instead of buried links. The previous hero pushed
 *     CSV users through a small footnote card; this version honors the
 *     "I have a spreadsheet" persona at the same priority as "I have
 *     contracts."
 *   - The 4-step explainer (Upload → Extract → Review → Track) stays
 *     because it's the single best activation primer.
 */
export function OnboardingHero({ userFirstName }: { userFirstName: string }) {
  return (
    <div className="max-w-5xl mx-auto pt-2 pb-16 space-y-10">
      <div className="text-center space-y-4">
        <Badge variant="primary-soft" className="gap-1.5 px-3 py-1">
          <Sparkles className="h-3.5 w-3.5" />
          Welcome
        </Badge>
        <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">
          Welcome to Renewal Radar, {userFirstName}.
        </h1>
        <p className="text-base sm:text-lg text-muted-foreground leading-relaxed max-w-2xl mx-auto">
          Pick the path that matches the data you have. Most teams are
          tracking their first renewal in under five minutes.
        </p>
      </div>

      {/* Primary lane — uploading a contract has the highest activation
          correlation, so it stays as the lead card with its own visual
          treatment. */}
      <Card className="relative overflow-hidden border-primary/20 shadow-card-lg">
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-primary-soft to-transparent"
        />
        <div className="relative p-7 sm:p-8 space-y-7">
          <div className="flex items-start gap-4">
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-card shrink-0">
              <Upload className="h-5 w-5" />
            </div>
            <div className="flex-1 space-y-1">
              <h2 className="font-display text-xl font-semibold tracking-tight">
                I have contracts (PDFs)
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Upload one or many. AI extracts the renewal date, notice
                period, auto-renewal terms, contract value, and cancellation
                method — you review every field before anything is applied.
              </p>
            </div>
          </div>

          <OnboardingSteps />

          <div className="flex flex-wrap gap-3 pt-1">
            <Button asChild size="lg">
              <Link href="/documents">
                <Upload />
                Upload contracts
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/documents">
                See how extraction works
                <ArrowRight />
              </Link>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground italic leading-relaxed">
            AI extraction is a draft, not legal advice — you always review
            before anything is applied. Nothing is sent to vendors on your
            behalf.
          </p>
        </div>
      </Card>

      {/* The three other paths, sized as equals so spreadsheet / manual /
          sample-template users don't feel like second-class onboarders. */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Other ways to start
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <PathTile
            icon={<FileSpreadsheet className="h-4 w-4" />}
            title="I have a spreadsheet"
            blurb="Paste straight from Excel or Google Sheets, or upload a CSV. We detect the format automatically."
            ctaLabel="Open importer"
            href="/subscriptions"
          />
          <PathTile
            icon={<FileText className="h-4 w-4" />}
            title="Start from a template"
            blurb="Pick a company profile (small startup, growth, enterprise) and we'll show you the SaaS most teams use — check off what you have."
            ctaLabel="Pick a template"
            href="/subscriptions/starter"
          />
          <PathTile
            icon={<Pencil className="h-4 w-4" />}
            title="Add one manually"
            blurb="Type in a single subscription. Useful for testing or your biggest renewal you don't want to wait for."
            ctaLabel="New subscription"
            href="/subscriptions/new"
          />
        </div>
      </div>

      {/* Quiet "we read every message" support line — kept small so it
          doesn't compete with the action tiles. */}
      <div className="text-center text-sm text-muted-foreground">
        Stuck on something?{" "}
        <a
          href="mailto:hello@renewalradar.com"
          className="inline-flex items-center gap-1.5 underline underline-offset-2 hover:text-foreground"
        >
          <Mail className="h-3.5 w-3.5" />
          hello@renewalradar.com
        </a>{" "}
        — no bots, no tier-gated support.
      </div>
    </div>
  );
}

function PathTile({
  icon,
  title,
  blurb,
  ctaLabel,
  href,
  download = false,
}: {
  icon: React.ReactNode;
  title: string;
  blurb: string;
  ctaLabel: string;
  href: string;
  download?: boolean;
}) {
  const cta = download ? (
    <a
      href={href}
      download
      className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline underline-offset-2"
    >
      {ctaLabel}
      <ArrowRight className="h-3.5 w-3.5" />
    </a>
  ) : (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline underline-offset-2"
    >
      {ctaLabel}
      <ArrowRight className="h-3.5 w-3.5" />
    </Link>
  );

  return (
    <Card className="p-6 h-full flex flex-col hover:shadow-card-lg transition-shadow">
      <div className="flex items-start gap-3 flex-1">
        <div className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-secondary text-foreground/80 shrink-0">
          {icon}
        </div>
        <div className="space-y-2 flex-1">
          <div className="font-medium text-sm">{title}</div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {blurb}
          </p>
        </div>
      </div>
      <div className="pt-4">{cta}</div>
    </Card>
  );
}

function OnboardingSteps() {
  const steps = [
    {
      icon: Upload,
      label: "Upload",
      blurb: "PDF / DOCX / XLSX / CSV",
    },
    {
      icon: Sparkles,
      label: "AI extracts",
      blurb: "Dates, terms, pricing",
    },
    {
      icon: CheckSquare,
      label: "You review",
      blurb: "Accept, edit, or reject",
    },
    {
      icon: Mail,
      label: "We track",
      blurb: "Alerts begin",
    },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {steps.map((s, i) => (
        <div
          key={s.label}
          className="rounded-lg border border-border/70 bg-background p-4 text-center space-y-2"
        >
          <div className="mx-auto inline-flex h-9 w-9 items-center justify-center rounded-md bg-primary-soft text-primary-strong">
            <s.icon className="h-4 w-4" />
          </div>
          <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-medium">
            Step {i + 1}
          </div>
          <div className="text-sm font-semibold">{s.label}</div>
          <div className="text-[12px] text-muted-foreground leading-tight">
            {s.blurb}
          </div>
        </div>
      ))}
    </div>
  );
}
