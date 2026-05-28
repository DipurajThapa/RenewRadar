/**
 * Human-readable labels for vendor events. Used by the timeline UI; no
 * business logic.
 */
import type { VendorEventKind } from "@server/infrastructure/db/schema";

export const VENDOR_EVENT_LABEL: Record<VendorEventKind, string> = {
  subscription_created: "Subscription tracked",
  subscription_updated: "Subscription updated",
  subscription_cancelled: "Subscription cancelled",
  contract_uploaded: "Contract uploaded",
  contract_field_applied: "Contract field applied",
  renewal_decision_logged: "Renewal decision logged",
  renewal_decision_approved: "Decision approved",
  renewal_decision_rejected: "Decision rejected",
  savings_recorded: "Savings recorded",
  price_changed: "Price changed",
  seat_count_changed: "Seats changed",
  owner_changed: "Owner reassigned",
  compliance_doc_received: "Compliance doc received",
  compliance_doc_expired: "Compliance doc expired",
  notice_deadline_missed: "Notice deadline missed",
  user_note_added: "Note added",
};

export const RATIONALE_LABEL: Record<string, string> = {
  cost_reduction: "Cost reduction",
  low_usage: "Low usage",
  poor_performance: "Poor performance",
  no_longer_needed: "No longer needed",
  found_alternative: "Found alternative",
  strategic_pivot: "Strategic pivot",
  security_concern: "Security concern",
  compliance_concern: "Compliance concern",
  consolidation: "Tool consolidation",
  team_change: "Team change",
  vendor_acquired: "Vendor acquired",
  price_too_high: "Price too high",
  missing_features: "Missing features",
  support_issues: "Support issues",
};

export const NEGOTIATION_LEVER_LABEL: Record<string, string> = {
  none: "No lever used",
  multi_year_commit: "Multi-year commitment",
  payment_terms: "Payment terms",
  volume_increase: "Volume increase",
  competing_quote: "Competing quote",
  executive_escalation: "Executive escalation",
  consolidated_with_other_products: "Bundled with other products",
  threatened_cancellation: "Threatened cancellation",
  other: "Other",
};

export const COMPLIANCE_ARTIFACT_LABEL: Record<string, string> = {
  dpa: "Data Processing Addendum",
  msa: "Master Service Agreement",
  nda: "Non-Disclosure Agreement",
  soc2_type_ii_report: "SOC 2 Type II report",
  soc2_type_i_report: "SOC 2 Type I report",
  iso_27001: "ISO 27001 certification",
  iso_27018: "ISO 27018 certification",
  iso_27701: "ISO 27701 certification",
  hipaa_baa: "HIPAA Business Associate Agreement",
  pci_aoc: "PCI DSS Attestation of Compliance",
  gdpr_addendum: "GDPR addendum",
  insurance_certificate: "Insurance certificate",
  w9: "W-9 form (US tax)",
  w8_ben_e: "W-8BEN-E form (international tax)",
  vendor_security_questionnaire: "Security questionnaire",
  subprocessor_list: "Subprocessor list",
  penetration_test_summary: "Penetration test summary",
  incident_response_plan: "Incident response plan",
  other: "Other",
};
