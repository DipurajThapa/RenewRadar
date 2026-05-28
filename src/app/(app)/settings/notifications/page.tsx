import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentAccountAndUser } from "@/lib/auth/current-user";
import { NotificationPrefsForm } from "@/components/settings/notification-prefs-form";

export const dynamic = "force-dynamic";

export default async function NotificationSettingsPage() {
  const { user } = await getCurrentAccountAndUser();

  const currentPrefs =
    (user.notificationPrefs as Record<
      string,
      { email: boolean; in_app: boolean }
    >) ?? {};

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notification preferences</CardTitle>
        <p className="text-sm text-muted-foreground">
          Choose which alerts you want to receive. The 7, 3, and 1-day notice
          deadline alerts are non-mutable — they exist to keep the wedge
          feature working.
        </p>
      </CardHeader>
      <CardContent>
        <NotificationPrefsForm currentPrefs={currentPrefs} />
      </CardContent>
    </Card>
  );
}
