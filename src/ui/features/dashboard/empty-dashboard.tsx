import Link from "next/link";
import { Plus, FileUp, Mail } from "lucide-react";
import { Button } from "@ui/components/primitives/button";
import { Card } from "@ui/components/primitives/card";

export function EmptyDashboard({ userFirstName }: { userFirstName: string }) {
  return (
    <div className="max-w-2xl mx-auto py-12 space-y-8">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          Welcome to Renewal Radar, {userFirstName}.
        </h1>
        <p className="text-muted-foreground">
          Your dashboard is empty — let's add your first subscriptions.
        </p>
      </div>

      <div className="space-y-3">
        <Link href="/subscriptions/new">
          <Card className="p-5 hover:bg-muted/20 transition-colors cursor-pointer">
            <div className="flex items-start gap-3">
              <Plus className="h-5 w-5 text-gray-700 mt-0.5 shrink-0" />
              <div>
                <div className="font-medium">Add a subscription manually</div>
                <div className="text-sm text-muted-foreground mt-1">
                  Under 90 seconds per subscription. Best for the first few
                  while you get a feel for the product.
                </div>
              </div>
            </div>
          </Card>
        </Link>

        <Card className="p-5 opacity-60">
          <div className="flex items-start gap-3">
            <FileUp className="h-5 w-5 text-gray-700 mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">
                Upload a CSV{" "}
                <span className="text-xs text-muted-foreground font-normal">
                  · Coming in V1.5
                </span>
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                Import dozens of subscriptions at once from a spreadsheet.
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-5 opacity-60">
          <div className="flex items-start gap-3">
            <Mail className="h-5 w-5 text-gray-700 mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">
                Forward vendor invoices{" "}
                <span className="text-xs text-muted-foreground font-normal">
                  · Coming in V1.5
                </span>
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                Set up email forwarding; we detect subscriptions automatically.
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div className="text-center pt-4">
        <Button asChild>
          <Link href="/subscriptions/new">
            <Plus className="mr-2 h-4 w-4" />
            Add your first subscription
          </Link>
        </Button>
        <p className="text-xs text-muted-foreground mt-4">
          Got a question? Email{" "}
          <a href="mailto:hello@renewalradar.com" className="underline">
            hello@renewalradar.com
          </a>
        </p>
      </div>
    </div>
  );
}
