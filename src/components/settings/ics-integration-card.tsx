"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Calendar, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  disableIcsExportAction,
  rotateIcsTokenAction,
} from "@/app/(app)/settings/integrations/actions";

export function IcsIntegrationCard({
  configured,
  token,
  origin,
}: {
  configured: boolean;
  token: string | null;
  origin: string;
}) {
  const [currentToken, setCurrentToken] = useState(token);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { toast } = useToast();

  const icsUrl = currentToken ? `${origin}/api/calendar/${currentToken}.ics` : "";

  function handleGenerate() {
    startTransition(async () => {
      const r = await rotateIcsTokenAction();
      if (r.ok && r.token) {
        setCurrentToken(r.token);
        router.refresh();
        toast({
          title: token ? "Token rotated" : "Calendar URL ready",
          description: "Subscribe from Google Calendar or Outlook.",
        });
      }
    });
  }

  function handleDisable() {
    startTransition(async () => {
      const r = await disableIcsExportAction();
      if (r.ok) {
        setCurrentToken(null);
        router.refresh();
        toast({ title: "Calendar export disabled" });
      }
    });
  }

  function handleCopy() {
    if (!icsUrl) return;
    navigator.clipboard.writeText(icsUrl).then(() => {
      toast({ title: "Copied", description: "Paste it into your calendar app." });
    });
  }

  if (!configured) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Generate a private URL that any calendar app can subscribe to. The
          feed includes notice deadlines + renewal dates for every active
          subscription.
        </p>
        <Button onClick={handleGenerate} disabled={pending}>
          <Calendar className="mr-2 h-4 w-4" />
          {pending ? "Generating…" : "Generate calendar URL"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Subscribe to this URL from Google Calendar (Other calendars → From URL)
        or Outlook (Add calendar → Subscribe from web).
      </p>
      <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs font-mono break-all">
        {icsUrl}
      </div>
      <div className="flex gap-2 flex-wrap">
        <Button variant="outline" size="sm" onClick={handleCopy}>
          <Copy className="mr-2 h-3 w-3" />
          Copy URL
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleGenerate}
          disabled={pending}
        >
          <RefreshCw className="mr-2 h-3 w-3" />
          Rotate token
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
      <p className="text-xs text-muted-foreground">
        Rotating invalidates the prior URL; anyone subscribed will need the new
        one. Use this if the URL has been shared by mistake.
      </p>
    </div>
  );
}
