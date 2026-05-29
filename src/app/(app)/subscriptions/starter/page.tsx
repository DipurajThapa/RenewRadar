import { Sparkles } from "lucide-react";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { PageHeader } from "@ui/components/shared/page-header";
import { STARTER_TEMPLATES } from "@server/domain/onboarding/starter-templates";
import { StarterTemplatePicker } from "@ui/features/onboarding/starter-template-picker";

/**
 * T3.6 — Starter template picker page.
 *
 * Lets a brand-new user pick a profile ("SaaS startup, 20 people") and
 * check off which of the common SaaS at that size they actually use. Each
 * selected row is created as a draft so renewal alerts don't fire on the
 * placeholder term dates.
 */
export const dynamic = "force-dynamic";

export default async function StarterTemplatePage() {
  await getCurrentAccountAndUser();

  return (
    <div className="space-y-8 max-w-5xl">
      <PageHeader>
        <PageHeader.Title>
          <span className="inline-flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Start from a template
          </span>
        </PageHeader.Title>
        <PageHeader.Description>
          Pick the closest match to your company. We&apos;ll show you the SaaS
          most teams at that stage use — check off the ones you have. We
          create them as drafts you can finish later.
        </PageHeader.Description>
      </PageHeader>

      <StarterTemplatePicker templates={[...STARTER_TEMPLATES]} />
    </div>
  );
}
