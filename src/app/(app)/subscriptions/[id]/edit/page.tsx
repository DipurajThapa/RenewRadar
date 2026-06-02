import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { getSubscriptionDetail } from "@server/infrastructure/db/repositories/subscriptions";
import { listAccountUsers } from "@server/infrastructure/db/repositories/users";
import { SubscriptionForm } from "@ui/features/subscriptions/subscription-form";
import { isUuid } from "@shared/utils";

export const dynamic = "force-dynamic";

export default async function EditSubscriptionPage({
  params,
}: {
  params: { id: string };
}) {
  if (!isUuid(params.id)) {
    notFound();
  }
  const { account, user } = await getCurrentAccountAndUser();
  const [detail, users] = await Promise.all([
    getSubscriptionDetail(account.id, params.id),
    listAccountUsers(account.id),
  ]);

  if (!detail) {
    notFound();
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link
          href={`/subscriptions/${detail.subscription.id}`}
          className="inline-flex items-center text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to {detail.vendor.name} — {detail.subscription.productName}
        </Link>
      </div>

      <header>
        <h1 className="text-2xl font-semibold">Edit subscription</h1>
      </header>

      <SubscriptionForm
        mode="edit"
        subscription={detail.subscription}
        vendorName={detail.vendor.name}
        users={users}
        currentUserId={user.id}
      />
    </div>
  );
}
