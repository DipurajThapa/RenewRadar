import {
  Heading,
  Text,
  Section,
  Button,
} from "@react-email/components";
import { render } from "@react-email/render";
import { BrandedShell } from "./_components/branded-shell";

type Props = {
  accountName: string;
  inviterName: string;
  acceptUrl: string;
  expiresAt: string;
};

export function InvitationEmail({
  accountName,
  inviterName,
  acceptUrl,
  expiresAt,
}: Props) {
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
        {inviterName} invited you to {accountName} on Renewal Radar
      </Heading>

      <Text style={{ fontSize: "14px", color: "#374151", marginTop: "16px" }}>
        Renewal Radar tracks every SaaS subscription's notice deadline so the
        team never discovers an auto-renewal too late. {inviterName} has added
        you to {accountName}.
      </Text>

      <Section style={{ margin: "24px 0" }}>
        <Button
          href={acceptUrl}
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
          Accept invitation →
        </Button>
      </Section>

      <Text style={{ fontSize: "13px", color: "#6b7280" }}>
        Link expires {expiresAt}. If you weren't expecting this, just ignore
        the email — no account is created until you accept.
      </Text>
    </BrandedShell>
  );
}

export async function renderInvitationEmail(props: Props): Promise<string> {
  return render(<InvitationEmail {...props} />);
}
