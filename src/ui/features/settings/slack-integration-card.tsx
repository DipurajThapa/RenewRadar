"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Link2 } from "lucide-react";
import { Button } from "@ui/components/primitives/button";
import { Input } from "@ui/components/primitives/input";
import { Label } from "@ui/components/primitives/label";
import { useToast } from "@ui/hooks/use-toast";
import {
  disableSlackIntegrationAction,
  saveSlackIntegrationAction,
} from "@app/(app)/settings/integrations/actions";

export function SlackIntegrationCard({
  configured,
  webhookUrl,
}: {
  configured: boolean;
  webhookUrl: string;
}) {
  const [editing, setEditing] = useState(!configured);
  const [url, setUrl] = useState(webhookUrl);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const r = await saveSlackIntegrationAction(url);
      if (r.ok) {
        setEditing(false);
        router.refresh();
        toast({
          title: "Slack connected",
          description: "Daily action-queue summary will post to this channel.",
        });
      } else {
        setError(r.formError);
      }
    });
  }

  function handleDisable() {
    startTransition(async () => {
      const r = await disableSlackIntegrationAction();
      if (r.ok) {
        setUrl("");
        setEditing(true);
        router.refresh();
        toast({ title: "Slack disabled" });
      } else {
        setError(r.formError);
      }
    });
  }

  if (configured && !editing) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <Check className="h-4 w-4 text-green-600" />
          Configured — sending daily action-queue summary
        </div>
        <div className="text-xs text-muted-foreground font-mono break-all">
          {webhookUrl.replace(/(.*\/services\/)([^\/]+\/)([^\/]+\/)(.+)/, "$1$2$3****")}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            Change URL
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDisable}
            disabled={pending}
          >
            Disable
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Paste a Slack <strong>incoming webhook</strong> URL. We'll post a daily
        action-queue summary (every weekday 09:00 in your account timezone) to
        the channel the webhook targets.
      </p>
      <div className="text-xs text-muted-foreground">
        <Link2 className="inline-block h-3 w-3 mr-1" />
        Create one at{" "}
        <a
          href="https://api.slack.com/messaging/webhooks"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-4"
        >
          api.slack.com/messaging/webhooks
        </a>
      </div>
      <div>
        <Label htmlFor="slackWebhook">Webhook URL</Label>
        <Input
          id="slackWebhook"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://hooks.slack.com/services/T.../B.../..."
          disabled={pending}
          className="mt-1.5 font-mono text-xs"
        />
      </div>
      {error && (
        <div className="text-xs text-red-700">{error}</div>
      )}
      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={pending || url.trim() === ""}>
          {pending ? "Saving…" : "Connect Slack"}
        </Button>
        {configured && (
          <Button
            variant="outline"
            onClick={() => {
              setUrl(webhookUrl);
              setEditing(false);
            }}
            disabled={pending}
          >
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
