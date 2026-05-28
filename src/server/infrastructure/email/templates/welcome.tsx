import {
  Heading,
  Text,
  Section,
  Button,
} from "@react-email/components";
import { render } from "@react-email/render";
import { BrandedShell } from "./_components/branded-shell";

type Props = {
  userName: string;
  appUrl: string;
};

export function WelcomeEmail({ userName, appUrl }: Props) {
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
        Welcome to Renewal Radar.
      </Heading>

      <Text style={{ fontSize: "14px", color: "#374151", marginTop: "16px" }}>
        Hi {firstName},
      </Text>

      <Text style={{ fontSize: "14px", color: "#374151" }}>
        Thanks for signing up. Renewal Radar tracks every notice deadline on
        every SaaS subscription so you never have to discover an auto-renewal
        the hard way.
      </Text>

      <Text style={{ fontSize: "14px", color: "#374151" }}>
        To get started, add your first subscription — takes under 90 seconds:
      </Text>

      <Section style={{ margin: "24px 0" }}>
        <Button
          href={`${appUrl}/subscriptions/new`}
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
          Add your first subscription →
        </Button>
      </Section>

      <Text style={{ fontSize: "14px", color: "#374151" }}>
        A few things to know:
      </Text>

      <Text
        style={{
          fontSize: "14px",
          color: "#374151",
          marginLeft: "16px",
        }}
      >
        • We never email your vendors on your behalf. When you decide to
        cancel something, we draft the letter — you send it from your own
        email client.
        <br />
        <br />
        • You're on our Free Forever plan (up to 5 subscriptions tracked).
        When you hit 5, you'll see an option to upgrade.
        <br />
        <br />
        • Got a question? Just reply to this email — it goes straight to the
        founder.
      </Text>

      <Text
        style={{
          fontSize: "14px",
          color: "#374151",
          marginTop: "24px",
        }}
      >
        Welcome aboard,
        <br />
        The Renewal Radar team
      </Text>
    </BrandedShell>
  );
}

export async function renderWelcomeEmail(props: Props): Promise<string> {
  return render(<WelcomeEmail {...props} />);
}
