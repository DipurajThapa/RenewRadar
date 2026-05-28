/**
 * Renewal Prep Pack PDF template.
 *
 * Generated on demand from `/api/prep-pack/[subscriptionId]`. Built with
 * @react-pdf/renderer — a React-like JSX surface that renders to a real PDF
 * on the server.
 *
 * Structure: one page per subscription with
 *   - vendor + product header
 *   - status + risk badge
 *   - contract dates + notice deadline
 *   - owner
 *   - financial summary (per-period, annualized, total at stake)
 *   - 30-day timeline relative to notice deadline
 *   - recommended action paragraph
 *
 * Kept intentionally text-first — no fancy charts, no embedded fonts. Prints
 * cleanly, opens fast, forwards by email.
 */
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  pdf,
} from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 11,
    color: "#111827",
    padding: 40,
  },
  header: {
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    paddingBottom: 12,
    marginBottom: 16,
  },
  brand: {
    fontSize: 9,
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: "bold",
    marginTop: 6,
  },
  subtitle: {
    fontSize: 11,
    color: "#6b7280",
    marginTop: 2,
  },
  section: {
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 9,
    fontWeight: "bold",
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  row: {
    flexDirection: "row",
    marginBottom: 4,
  },
  rowLabel: {
    width: 130,
    color: "#6b7280",
  },
  rowValue: {
    flex: 1,
  },
  callout: {
    backgroundColor: "#fef3c7",
    borderWidth: 1,
    borderColor: "#fcd34d",
    padding: 10,
    borderRadius: 4,
    marginBottom: 14,
  },
  calloutTitle: {
    fontSize: 9,
    fontWeight: "bold",
    color: "#92400e",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  calloutBody: {
    fontSize: 11,
    color: "#92400e",
    marginTop: 4,
  },
  bigDate: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#dc2626",
  },
  timeline: {
    marginTop: 4,
  },
  timelineRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 3,
  },
  timelineDate: {
    width: 90,
    color: "#6b7280",
    fontSize: 10,
  },
  timelineBullet: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#9ca3af",
    marginRight: 8,
  },
  timelineLabel: {
    flex: 1,
    fontSize: 10,
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    paddingTop: 8,
    fontSize: 8,
    color: "#9ca3af",
    textAlign: "center",
  },
});

export type PrepPackData = {
  vendorName: string;
  productName: string;
  planName: string | null;
  status: string;
  ownerName: string | null;
  ownerEmail: string | null;
  termStartDate: string;
  termEndDate: string;
  noticeDeadline: string;
  noticePeriodDays: number;
  daysUntilNoticeDeadline: number;
  billingCycle: string;
  totalSeats: number;
  unitPriceCents: number;
  totalCostPerPeriodCents: number;
  annualValueCents: number;
  autoRenew: boolean;
  vendorCancellationEmail: string | null;
  vendorCancellationUrl: string | null;
  notes: string | null;
  riskScore: number;
  riskBand: "low" | "medium" | "high";
  accountName: string;
  generatedAtIso: string;
};

function formatUsd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function addDaysIso(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0]!;
}

function recommendedAction(d: PrepPackData): string {
  if (d.daysUntilNoticeDeadline < 0) {
    return `The notice deadline has passed by ${Math.abs(
      d.daysUntilNoticeDeadline
    )} days. If you haven't given written notice, ${d.vendorName} is set to auto-renew on ${d.termEndDate}. Confirm the renewal terms and update Renewal Radar with your decision.`;
  }
  if (d.daysUntilNoticeDeadline <= 7) {
    return `You have ${d.daysUntilNoticeDeadline} days to give written notice. Decide today whether to cancel, downgrade, or renew, and execute the action. After ${d.noticeDeadline} the contract auto-renews for another ${d.billingCycle.replace(/_/g, " ")} term at ${formatUsd(d.totalCostPerPeriodCents)}.`;
  }
  if (d.riskBand === "high") {
    return `This renewal is high-risk (score ${d.riskScore}). Schedule a vendor review, line up usage metrics, and confirm whether you want to renew, downgrade, or cancel before the notice window opens.`;
  }
  return `You're outside the urgent window. Use this time to review actual usage vs. seat count, benchmark the unit price, and confirm whether the contract still matches your needs.`;
}

export function PrepPackDocument({ data }: { data: PrepPackData }) {
  const milestones = [
    {
      date: addDaysIso(data.noticeDeadline, -14),
      label: "Vendor outreach window opens — request usage metrics",
    },
    {
      date: addDaysIso(data.noticeDeadline, -7),
      label: "Internal decision deadline — owner aligns with stakeholders",
    },
    {
      date: addDaysIso(data.noticeDeadline, -3),
      label: "Cancellation letter drafted and reviewed (if cancelling)",
    },
    {
      date: data.noticeDeadline,
      label: "NOTICE DEADLINE — written notice must be sent on or before this date",
    },
    {
      date: data.termEndDate,
      label: "Contract end / renewal date",
    },
  ];

  return (
    <Document
      title={`Renewal Prep Pack — ${data.vendorName} — ${data.productName}`}
      author="Renewal Radar"
      subject={`Renewal Prep Pack for ${data.vendorName} — ${data.productName}`}
    >
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.brand}>Renewal Prep Pack</Text>
          <Text style={styles.title}>
            {data.vendorName} — {data.productName}
            {data.planName ? ` · ${data.planName}` : ""}
          </Text>
          <Text style={styles.subtitle}>
            Prepared for {data.accountName} · generated{" "}
            {data.generatedAtIso.split("T")[0]} UTC
          </Text>
        </View>

        <View style={styles.callout}>
          <Text style={styles.calloutTitle}>Notice deadline</Text>
          <Text style={styles.bigDate}>{data.noticeDeadline}</Text>
          <Text style={styles.calloutBody}>
            {data.daysUntilNoticeDeadline < 0
              ? `${Math.abs(data.daysUntilNoticeDeadline)} days overdue`
              : `${data.daysUntilNoticeDeadline} days from today`}{" "}
            · Risk score {data.riskScore} ({data.riskBand.toUpperCase()})
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Contract</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Term</Text>
            <Text style={styles.rowValue}>
              {data.termStartDate} → {data.termEndDate}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Billing cycle</Text>
            <Text style={styles.rowValue}>
              {data.billingCycle.replace(/_/g, " ")}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Notice period</Text>
            <Text style={styles.rowValue}>{data.noticePeriodDays} days</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Auto-renew</Text>
            <Text style={styles.rowValue}>{data.autoRenew ? "Yes" : "No"}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Status</Text>
            <Text style={styles.rowValue}>
              {data.status.replace(/_/g, " ")}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Financials</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Seats</Text>
            <Text style={styles.rowValue}>{data.totalSeats}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Unit price</Text>
            <Text style={styles.rowValue}>
              {formatUsd(data.unitPriceCents)}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Per period</Text>
            <Text style={styles.rowValue}>
              {formatUsd(data.totalCostPerPeriodCents)}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Annualized</Text>
            <Text style={styles.rowValue}>
              {formatUsd(data.annualValueCents)}
            </Text>
          </View>
          {data.vendorCancellationEmail && (
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Cancellation email</Text>
              <Text style={styles.rowValue}>
                {data.vendorCancellationEmail}
              </Text>
            </View>
          )}
          {data.vendorCancellationUrl && (
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Cancellation URL</Text>
              <Text style={styles.rowValue}>{data.vendorCancellationUrl}</Text>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Ownership</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Owner</Text>
            <Text style={styles.rowValue}>
              {data.ownerName ?? data.ownerEmail ?? "Unassigned"}
              {data.ownerEmail && data.ownerName ? ` <${data.ownerEmail}>` : ""}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recommended action</Text>
          <Text style={{ lineHeight: 1.4 }}>{recommendedAction(data)}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>30-day timeline</Text>
          <View style={styles.timeline}>
            {milestones.map((m, idx) => (
              <View key={idx} style={styles.timelineRow}>
                <Text style={styles.timelineDate}>{m.date}</Text>
                <View style={styles.timelineBullet} />
                <Text style={styles.timelineLabel}>{m.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {data.notes && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Notes</Text>
            <Text style={{ lineHeight: 1.4 }}>{data.notes}</Text>
          </View>
        )}

        <Text style={styles.footer}>
          Renewal Radar — Prepare. Decide. Save. · Confidential ·{" "}
          {data.accountName} · {data.generatedAtIso}
        </Text>
      </Page>
    </Document>
  );
}

/**
 * Render the PDF document to a Buffer for HTTP delivery.
 */
export async function renderPrepPackPdf(data: PrepPackData): Promise<Buffer> {
  const stream = await pdf(<PrepPackDocument data={data} />).toBuffer();
  // toBuffer returns a Node Readable; collect into a Buffer.
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}
