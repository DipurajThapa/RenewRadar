import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { getCurrentAccountAndUser } from "@/lib/auth/current-user";
import { getSubscriptionDetail } from "@/lib/db/queries/subscriptions";
import { SubscriptionDetail } from "@/components/subscriptions/subscription-detail";

export const dynamic = "force-dynamic";

export default async function SubscriptionDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { account } = await getCurrentAccountAndUser();
  const detail = await getSubscriptionDetail(account.id, params.id);

  if (!detail) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/subscriptions"
          className="inline-flex items-center text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to subscriptions
        </Link>
      </div>

      <SubscriptionDetail
        subscription={detail.subscription}
        vendor={detail.vendor}
        renewalEvent={detail.renewalEvent}
        owner={detail.owner}
      />
    </div>
  );
}
