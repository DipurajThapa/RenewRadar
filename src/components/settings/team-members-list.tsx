import { Badge } from "@/components/ui/badge";
import type { AccountUserOption } from "@/lib/db/queries/users";

/**
 * Read-only list of current account members. Role-change controls land in
 * a follow-up — V1 ships with the read view + invitation flow.
 */
export function TeamMembersList({
  members,
  currentUserId,
}: {
  members: AccountUserOption[];
  currentUserId: string;
}) {
  return (
    <ul className="divide-y">
      {members.map((m) => (
        <li key={m.id} className="py-2.5 flex items-center justify-between">
          <div className="min-w-0">
            <div className="font-medium text-sm">
              {m.fullName ?? m.workEmail}
              {m.id === currentUserId && (
                <span className="ml-2 text-xs text-muted-foreground">
                  (you)
                </span>
              )}
            </div>
            {m.fullName && (
              <div className="text-xs text-muted-foreground truncate">
                {m.workEmail}
              </div>
            )}
          </div>
          <Badge variant="secondary" className="capitalize">
            {/* Role isn't on AccountUserOption today; surface as "member" by
                default. Real role display lands when the user query returns it. */}
            member
          </Badge>
        </li>
      ))}
    </ul>
  );
}
