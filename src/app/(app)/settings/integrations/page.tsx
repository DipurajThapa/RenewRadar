import { headers } from "next/headers";
import { Card, CardContent, CardHeader, CardTitle } from "@ui/components/primitives/card";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import {
  getIcsIntegration,
  getSlackIntegration,
} from "@server/infrastructure/db/repositories/integrations";
import { SlackIntegrationCard } from "@ui/features/settings/slack-integration-card";
import { IcsIntegrationCard } from "@ui/features/settings/ics-integration-card";

export const dynamic = "force-dynamic";

export default async function IntegrationsSettingsPage() {
  const { account } = await getCurrentAccountAndUser();

  const [slack, ics] = await Promise.all([
    getSlackIntegration(account.id),
    getIcsIntegration(account.id),
  ]);

  // Resolve the public origin for the ICS URL hint.
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const origin = `${proto}://${host}`;

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-semibold">Integrations</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Send alerts to Slack and subscribe to your renewal calendar from
          Google Calendar or Outlook. Secrets are encrypted at rest.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Slack</CardTitle>
        </CardHeader>
        <CardContent>
          <SlackIntegrationCard
            configured={slack !== null && slack.enabled}
            webhookUrl={slack?.config.webhookUrl ?? ""}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Calendar (ICS)</CardTitle>
        </CardHeader>
        <CardContent>
          <IcsIntegrationCard
            configured={ics !== null && ics.enabled}
            token={ics?.config.token ?? null}
            origin={origin}
          />
        </CardContent>
      </Card>
    </div>
  );
}
