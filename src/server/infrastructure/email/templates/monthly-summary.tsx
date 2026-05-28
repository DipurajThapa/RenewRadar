import {
  Heading,
  Text,
  Section,
  Hr,
} from "@react-email/components";
import { render } from "@react-email/render";
import { BrandedShell } from "./_components/branded-shell";

type Props = {
  userName: string;
  appUrl: string;
  monthLabel: string;
  totalSavedYtdCents: number;
  decisionsCountMonth: number;
  decisionsCountYtd: number;
  missedCountYtd: number;
  upcomingNext30Count: number;
  upcomingNext30ValueCents: number;
};

function formatUsd(cents: number): string {
  const dollars = Math.round(cents / 100);
  return `$${dollars.toLocaleString("en-US")}`;
}

export function MonthlySummaryEmail({
  userName,
  appUrl,
  monthLabel,
  totalSavedYtdCents,
  decisionsCountMonth,
  decisionsCountYtd,
  missedCountYtd,
  upcomingNext30Count,
  upcomingNext30ValueCents,
}: Props) {
  const firstName = userName.split(" ")[0] ?? userName;
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
        {monthLabel} renewal summary
      </Heading>

      <Text style={{ fontSize: "14px", color: "#374151", marginTop: "16px" }}>
        Hi {firstName},
      </Text>

      <Section
        style={{
          padding: "16px",
          border: "1px solid #d1fae5",
          backgroundColor: "#ecfdf5",
          borderRadius: "8px",
          margin: "16px 0",
        }}
      >
        <Text
          style={{
            fontSize: "12px",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            color: "#065f46",
            margin: 0,
          }}
        >
          Saved year-to-date
        </Text>
        <Text
          style={{
            fontSize: "28px",
            fontWeight: 700,
            color: "#047857",
            margin: "4px 0 0 0",
          }}
        >
          {formatUsd(totalSavedYtdCents)}
        </Text>
        <Text style={{ fontSize: "12px", color: "#065f46", margin: 0 }}>
          {decisionsCountYtd} decision{decisionsCountYtd === 1 ? "" : "s"}{" "}
          logged · {decisionsCountMonth} this month
        </Text>
      </Section>

      <Hr style={{ borderColor: "#e5e7eb", margin: "16px 0" }} />

      <Text style={{ fontSize: "14px", color: "#374151", margin: "0 0 12px 0" }}>
        Next 30 days
      </Text>
      <Text style={{ fontSize: "14px", color: "#111827", margin: 0 }}>
        <strong>{upcomingNext30Count}</strong> notice deadlines coming up ·{" "}
        <strong>{formatUsd(upcomingNext30ValueCents)}</strong> at stake
      </Text>

      {missedCountYtd > 0 && (
        <>
          <Hr style={{ borderColor: "#e5e7eb", margin: "16px 0" }} />
          <Text
            style={{
              fontSize: "13px",
              color: "#991b1b",
              margin: 0,
            }}
          >
            ⚠ {missedCountYtd} missed deadline{missedCountYtd === 1 ? "" : "s"}{" "}
            YTD. Review them in the audit log so you know what happened.
          </Text>
        </>
      )}

      <Text style={{ fontSize: "12px", color: "#6b7280", marginTop: "32px" }}>
        Full breakdown in{" "}
        <a href={`${appUrl}/reports`} style={{ color: "#374151" }}>
          Reports
        </a>
        . Forward this email to anyone on your finance team — it's safe to share.
      </Text>
    </BrandedShell>
  );
}

export async function renderMonthlySummaryEmail(props: Props): Promise<string> {
  return render(<MonthlySummaryEmail {...props} />);
}
