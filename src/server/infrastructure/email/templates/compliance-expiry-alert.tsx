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
  /** Human-readable artifact kind, e.g. "SOC 2 Type II report". */
  artifactKindLabel: string;
  expiresAt: string; // YYYY-MM-DD
  daysUntilExpiry: number;
  vendorUrl: string;
};

export function ComplianceExpiryAlertEmail(props: Props) {
  const tone = toneForDays(props.daysUntilExpiry);
  const firstName = props.userName.split(" ")[0] ?? props.userName;
  const dayWord = props.daysUntilExpiry === 1 ? "day" : "days";

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
        {props.artifactKindLabel} for {props.vendorName} expires in{" "}
        {props.daysUntilExpiry} {dayWord}
      </Heading>

      <Text style={{ fontSize: "14px", color: "#374151", marginTop: "16px" }}>
        Hi {firstName},
      </Text>

      <Text style={{ fontSize: "14px", color: "#374151" }}>
        The <strong>{props.artifactKindLabel}</strong> you have on file for{" "}
        <strong>{props.vendorName}</strong> is set to expire. Once it lapses
        you may be out of compliance until a renewed document is on file.
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
          Expires
        </Text>
        <Text
          style={{
            fontSize: "18px",
            fontWeight: 600,
            color: "#111827",
            margin: "4px 0 0 0",
          }}
        >
          {formatDate(props.expiresAt)}
        </Text>
        <Hr style={{ borderTop: "1px solid #e5e7eb", margin: "12px 0" }} />
        <Text
          style={{
            fontSize: "14px",
            color: "#374151",
            margin: 0,
          }}
        >
          Request a refreshed copy from the vendor and record it on their page
          to clear this alert.
        </Text>
      </Section>

      <Section style={{ margin: "20px 0" }}>
        <Button
          href={props.vendorUrl}
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
          View vendor record →
        </Button>
      </Section>

      <Text
        style={{
          fontSize: "12px",
          color: "#6b7280",
          marginTop: "16px",
        }}
      >
        Manage which alerts you receive in{" "}
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

export async function renderComplianceExpiryEmail(
  props: Props
): Promise<string> {
  return render(<ComplianceExpiryAlertEmail {...props} />);
}

function toneForDays(days: number) {
  if (days <= 3) return { headingColor: "#b91c1c" }; // red-700
  if (days <= 7) return { headingColor: "#c2410c" }; // orange-700
  if (days <= 14) return { headingColor: "#a16207" }; // yellow-700
  return { headingColor: "#1d4ed8" }; // blue-700
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
