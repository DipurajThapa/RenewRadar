"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { useToast } from "@ui/hooks/use-toast";
import { publishAnnouncementAction } from "@app/vendor/announcements/actions";

export function PublishButton({ announcementId }: { announcementId: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { toast } = useToast();

  function publish() {
    if (!confirm("Publish this announcement to all connected customers?")) return;
    startTransition(async () => {
      const r = await publishAnnouncementAction(announcementId);
      if (!r.ok) {
        toast({ title: "Couldn't publish", description: r.error });
        return;
      }
      router.refresh();
      toast({ title: "Published", description: "Connected customers were notified." });
    });
  }

  return (
    <button
      type="button"
      onClick={publish}
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-md bg-teal-600 hover:bg-teal-700 text-white px-3 py-1.5 text-sm font-medium"
    >
      <Send className="h-3.5 w-3.5" />
      {pending ? "Publishing…" : "Publish"}
    </button>
  );
}
