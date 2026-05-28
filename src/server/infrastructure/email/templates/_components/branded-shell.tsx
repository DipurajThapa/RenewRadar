import {
  Body,
  Container,
  Head,
  Html,
  Hr,
  Text,
  Link,
} from "@react-email/components";

export function BrandedShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Html>
      <Head>
        <title>Renewal Radar</title>
      </Head>
      <Body
        style={{
          backgroundColor: "#f9fafb",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          margin: 0,
          padding: "40px 0",
        }}
      >
        <Container
          style={{
            backgroundColor: "#ffffff",
            border: "1px solid #e5e7eb",
            borderRadius: "8px",
            maxWidth: "576px",
            margin: "0 auto",
            padding: "32px",
          }}
        >
          <Text
            style={{
              fontSize: "14px",
              fontWeight: 600,
              color: "#111827",
              margin: "0 0 24px 0",
            }}
          >
            ⚡ Renewal Radar
          </Text>
          {children}
          <Hr
            style={{
              borderTop: "1px solid #e5e7eb",
              margin: "24px 0",
            }}
          />
          <Text
            style={{
              fontSize: "12px",
              color: "#9ca3af",
              margin: 0,
            }}
          >
            Renewal Radar · We never send emails to your vendors on your behalf.
            You always click send.
          </Text>
          <Text
            style={{
              fontSize: "12px",
              color: "#9ca3af",
              marginTop: "8px",
            }}
          >
            Update your{" "}
            <Link
              href={`${process.env.NEXT_PUBLIC_APP_URL ?? "https://renewalradar.com"}/settings/notifications`}
              style={{ color: "#6b7280", textDecoration: "underline" }}
            >
              notification preferences
            </Link>
            .
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
