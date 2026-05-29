import {
  Heading,
  Text,
  Section,
  Button,
  Hr,
} from "@react-email/components";
import { render } from "@react-email/render";
import { BrandedShell } from "./_components/branded-shell";

type DigestRow = {
  vendorName: string;
  productName: string;
  noticeDeadline: string;
  daysUntil: number;
  annualValueCents: number;
  decideUrl: string;
};

type Props = {
  userName: string;
  appUrl: string;
  weekStartIso: string;
  actionQueueRows: DigestRow[];
  decisionsThisWeek: number;
  savedThisWeekUsdCents: number;
  /**
   * Total saved across all time for this account. Drives the "you've saved
   * $X total with Renewal Radar" hero at the top of the digest — ROI made
   * visible at every touch.
   */
  savedAllTimeUsdCents: number;
};

function formatUsd(cents: number): string {
  const dollars = Math.round(cents / 100);
  return `$${dollars.toLocaleString("en-US")}`;
}

export function WeeklyDigestEmail({
  userName,
  appUrl,
  weekStartIso,
  actionQueueRows,
  decisionsThisWeek,
  savedThisWeekUsdCents,
  savedAllTimeUsdCents,
}: Props) {
  const firstName = userName.split(" ")[0] ?? userName;
  const top = actionQueueRows.slice(0, 8);
  // Only show the ROI hero once there's something to brag about. If the
  // account hasn't recorded any savings yet, the digest skips the strip
  // rather than showing "$0 saved" which would feel like an indictment.
  const showSavingsHero = savedAllTimeUsdCents > 0;

  return (
    <BrandedShell>
      <Heading
        style={{
          fontSize: "20px",
          fontWeight: 600,
          color: "#111827",
          margin: 0,
        }}
      >
        Your week in renewals · {weekStartIso}
      </Heading>

      <Text style={{ fontSize: "14px", color: "#374151", marginTop: "16px" }}>
        Hi {firstName},
      </Text>

      {showSavingsHero && (
        <Section
          style={{
            backgroundColor: "#ecfdf5",
            border: "1px solid #a7f3d0",
            borderRadius: "8px",
            padding: "16px 18px",
            margin: "0 0 20px 0",
          }}
        >
          <Text
            style={{
              fontSize: "11px",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              color: "#047857",
              fontWeight: 600,
              margin: 0,
            }}
          >
            Saved with Renewal Radar
          </Text>
          <Text
            style={{
              fontSize: "28px",
              fontWeight: 700,
              color: "#065f46",
              margin: "4px 0 6px 0",
              lineHeight: 1.1,
            }}
          >
            {formatUsd(savedAllTimeUsdCents)}{" "}
            <span style={{ fontSize: "13px", fontWeight: 500 }}>all-time</span>
          </Text>
          <Text
            style={{
              fontSize: "13px",
              color: "#047857",
              margin: 0,
            }}
          >
            Annualized savings from every decision you've logged.
            {savedThisWeekUsdCents > 0 &&
              ` ${formatUsd(savedThisWeekUsdCents)} of that was booked this week.`}
          </Text>
        </Section>
      )}

      {top.length === 0 ? (
        <Text style={{ fontSize: "14px", color: "#374151" }}>
          Nothing needs a decision this week. Your action queue is clear.
        </Text>
      ) : (
        <>
          <Text style={{ fontSize: "14px", color: "#374151" }}>
            {top.length} renewal{top.length === 1 ? "" : "s"} need
            {top.length === 1 ? "s" : ""} attention this week. Highest-risk
            first:
          </Text>

          <Section style={{ margin: "16px 0" }}>
            {top.map((row, idx) => (
              <Section
                key={idx}
                style={{
                  padding: "12px 14px",
                  border: "1px solid #e5e7eb",
                  borderRadius: "6px",
                  marginBottom: "8px",
                  backgroundColor: row.daysUntil <= 7 ? "#fef2f2" : "#ffffff",
                }}
              >
                <Text
                  style={{
                    fontSize: "14px",
                    fontWeight: 600,
                    color: "#111827",
                    margin: 0,
                  }}
                >
                  {row.vendorName} — {row.productName}
                </Text>
                <Text
                  style={{
                    fontSize: "13px",
                    color: row.daysUntil <= 7 ? "#991b1b" : "#374151",
                    margin: "4px 0 8px 0",
                  }}
                >
                  Notice deadline{" "}
                  {row.daysUntil <= 0
                    ? `${Math.abs(row.daysUntil)} days overdue`
                    : `in ${row.daysUntil} days`}{" "}
                  ({row.noticeDeadline}) · {formatUsd(row.annualValueCents)}/yr
                </Text>
                <Button
                  href={row.decideUrl}
                  style={{
                    backgroundColor: "#111827",
                    color: "#ffffff",
                    padding: "8px 14px",
                    borderRadius: "4px",
                    fontSize: "13px",
                    fontWeight: 500,
                    textDecoration: "none",
                    display: "inline-block",
                  }}
                >
                  Open decision
                </Button>
              </Section>
            ))}
          </Section>
        </>
      )}

      <Hr style={{ borderColor: "#e5e7eb", margin: "24px 0" }} />

      <Text style={{ fontSize: "13px", color: "#6b7280", margin: 0 }}>
        Last week:{" "}
        <strong style={{ color: "#111827" }}>{decisionsThisWeek}</strong>{" "}
        decision{decisionsThisWeek === 1 ? "" : "s"} logged ·{" "}
        <strong style={{ color: "#047857" }}>
          {formatUsd(savedThisWeekUsdCents)}
        </strong>{" "}
        booked to the savings ledger.
      </Text>

      <Section style={{ margin: "24px 0 0 0" }}>
        <Button
          href={`${appUrl}/action-queue`}
          style={{
            backgroundColor: "#ffffff",
            color: "#111827",
            border: "1px solid #d1d5db",
            padding: "10px 16px",
            borderRadius: "6px",
            fontSize: "14px",
            fontWeight: 500,
            textDecoration: "none",
            display: "inline-block",
          }}
        >
          View action queue →
        </Button>
      </Section>

      <Text style={{ fontSize: "12px", color: "#6b7280", marginTop: "24px" }}>
        You can change which digests you receive in{" "}
        <a
          href={`${appUrl}/settings/notifications`}
          style={{ color: "#374151" }}
        >
          Notification settings
        </a>
        .
      </Text>
    </BrandedShell>
  );
}

export async function renderWeeklyDigestEmail(props: Props): Promise<string> {
  return render(<WeeklyDigestEmail {...props} />);
}
