import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function SubscriptionsEmptyState() {
  return (
    <Card>
      <CardContent className="py-16 text-center space-y-4">
        <div className="text-5xl" aria-hidden>
          📋
        </div>
        <h2 className="text-lg font-semibold">No subscriptions yet</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Add your first subscription to start tracking notice deadlines.
          Under 90 seconds per subscription.
        </p>
        <Button asChild>
          <Link href="/subscriptions/new">
            <Plus className="mr-2 h-4 w-4" />
            Add your first subscription
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
