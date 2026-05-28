import {
  Heading,
  Text,
  Section,
  Button,
  Hr,
  Link,
} from "@react-email/components";
import { render } from "@react-email/render";
import { BrandedShell } from "./_components/branded-shell";

type Props = {
  userName: string;
  vendorName: string;
  productName: string;
  annualValueCents: number;
  renewalDate: string;
  noticeDeadline: string; // YYYY-MM-DD
  daysUntilDeadline: 30 | 14 | 7 | 3 | 1;
  decisionUrl: string;
};

export function NoticeDeadlineAlertEmail(props: Props) {
  const tone = toneForDays(props.daysUntilDeadline);
  const firstName = props.userName.split(" ")[0] ?? props.userName;

  return (
    <BrandedShell>
      <Heading
        style={{
          fontSize: "20px",
          fontWeight: 600,
          color: tone.headingColor,
          margin: 0,
        }}
      >
        {headingForDays(props.daysUntilDeadline, props.vendorName)}
      </Heading>

      <Text style={{ fontSize: "14px", color: "#374151", marginTop: "16px" }}>
        Hi {firstName},
      </Text>

      <Text style={{ fontSize: "14px", color: "#374151" }}>
        Your{" "}
        <strong>
          {props.vendorName} — {props.productName}
        </strong>{" "}
        subscription has a notice deadline in{" "}
        <strong>
          {props.daysUntilDeadline}{" "}
          {props.daysUntilDeadline === 1 ? "day" : "days"}
        </strong>
        .
      </Text>

      <Section
        style={{
          backgroundColor: "#f9fafb",
          border: "1px solid #e5e7eb",
          borderRadius: "6px",
          padding: "16px",
          margin: "16px 0",
        }}
      >
        <Text
          style={{
            fontSize: "11px",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            color: "#6b7280",
            margin: 0,
          }}
        >
          Notice deadline
        </Text>
        <Text
          style={{
            fontSize: "18px",
            fontWeight: 600,
            color: "#111827",
            margin: "4px 0 0 0",
          }}
        >
          {formatDate(props.noticeDeadline)}
        </Text>
        <Hr style={{ borderTop: "1px solid #e5e7eb", margin: "12px 0" }} />
        <Text
          style={{
            fontSize: "11px",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            color: "#6b7280",
            margin: 0,
          }}
        >
          If you do nothing
        </Text>
        <Text
          style={{
            fontSize: "14px",
            color: "#374151",
            margin: "4px 0 0 0",
          }}
        >
          Renews automatically on{" "}
          <strong>{formatDate(props.renewalDate)}</strong> for{" "}
          <strong>
            ${(props.annualValueCents / 100).toLocaleString("en-US")}/year
          </strong>
          .
        </Text>
      </Section>

      <Section style={{ margin: "20px 0" }}>
        <Button
          href={props.decisionUrl}
          style={{
            backgroundColor: "#111827",
            color: "#ffffff",
            padding: "12px 20px",
            borderRadius: "6px",
            fontSize: "14px",
            fontWeight: 500,
            textDecoration: "none",
            display: "inline-block",
          }}
        >
          Review and decide →
        </Button>
      </Section>

      <Text
        style={{
          fontSize: "12px",
          color: "#6b7280",
          marginTop: "16px",
        }}
      >
        Alerts at 7, 3, and 1 days before the deadline are non-mutable — they
        exist to make sure you don't miss the window. Update other preferences
        in{" "}
        <Link
          href={`${process.env.NEXT_PUBLIC_APP_URL ?? "https://renewalradar.com"}/settings/notifications`}
          style={{ color: "#374151", textDecoration: "underline" }}
        >
          settings
        </Link>
        .
      </Text>
    </BrandedShell>
  );
}

export async function renderNoticeDeadlineEmail(props: Props): Promise<string> {
  return render(<NoticeDeadlineAlertEmail {...props} />);
}

function toneForDays(days: number) {
  if (days <= 3) return { headingColor: "#b91c1c" }; // red-700
  if (days <= 7) return { headingColor: "#c2410c" }; // orange-700
  if (days <= 14) return { headingColor: "#a16207" }; // yellow-700
  return { headingColor: "#1d4ed8" }; // blue-700
}

function headingForDays(days: number, vendor: string): string {
  if (days === 1) return `FINAL DAY: ${vendor} notice deadline tomorrow`;
  if (days <= 3)
    return `ACTION NEEDED: ${vendor} notice deadline in ${days} days`;
  if (days === 7) return `${vendor} notice deadline in 7 days`;
  if (days === 14) return `${vendor} notice deadline in 14 days — log a decision`;
  return `Notice window opens for ${vendor}`;
}

function formatDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
