import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { listAccountUsers } from "@server/infrastructure/db/repositories/users";
import { listVendorsByAccount } from "@server/infrastructure/db/repositories/vendors";
import { SubscriptionForm } from "@ui/features/subscriptions/subscription-form";

export const dynamic = "force-dynamic";

export default async function NewSubscriptionPage() {
  const { account, user } = await getCurrentAccountAndUser();
  const [users, vendors] = await Promise.all([
    listAccountUsers(account.id),
    listVendorsByAccount(account.id),
  ]);
  const existingVendorNames = vendors.map((v) => v.name);

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link
          href="/subscriptions"
          className="inline-flex items-center text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to subscriptions
        </Link>
      </div>

      <header>
        <h1 className="text-2xl font-semibold">Add subscription</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Track a new SaaS subscription so we can monitor its notice deadline.
        </p>
      </header>

      <SubscriptionForm
        mode="create"
        users={users}
        currentUserId={user.id}
        existingVendorNames={existingVendorNames}
      />
    </div>
  );
}
