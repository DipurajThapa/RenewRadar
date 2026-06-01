/**
 * Extraction eval scorer (Phase 1, C2 + C4) — pure, unit-tested.
 *
 * Given (GoldenContract, ExtractionResult) pairs it computes:
 *   - precision / recall / F1 per field, overall and per variant
 *   - hallucination escapes (a predicted field whose evidence isn't in the text)
 *   - injection escapes (an adversarial decoy value the model wrongly extracted)
 *   - calibration: expected calibration error (ECE) + a reliability table
 *
 * No model, no IO — the live extraction happens in the benchmark orchestrator;
 * this file is the math, so it's tested offline and gates CI.
 */
import type { ExtractionResult } from "../types";
import {
  EVAL_FIELD_KEYS,
  type ConfidencePoint,
  type CorpusVariant,
  type EvalFieldKey,
  type ExtractionEvalReport,
  type GoldenContract,
  type PrfCounts,
  type PrfScore,
  type VariantScore,
} from "./types";

function normalizeWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

type Pred = {
  value: string | number | boolean;
  confidencePct: number;
  evidenceQuote: string;
};

/** Collapse an extraction result into one prediction per logical eval field. */
export function predictionMap(result: ExtractionResult): Partial<Record<EvalFieldKey, Pred>> {
  const map: Partial<Record<EvalFieldKey, Pred>> = {};
  for (const f of result.fields) {
    const pv = (f.parsedValueJson ?? {}) as Record<string, unknown>;
    let key: EvalFieldKey | null = null;
    let value: string | number | boolean | undefined;
    if (f.fieldKey === "renewal_date" || f.fieldKey === "expiry_date") {
      key = "renewal_date";
      value = typeof pv.date === "string" ? pv.date : undefined;
    } else if (f.fieldKey === "notice_period_days") {
      key = "notice_period_days";
      value = typeof pv.days === "number" ? pv.days : undefined;
    } else if (f.fieldKey === "auto_renewal") {
      key = "auto_renewal";
      value = typeof pv.yes === "boolean" ? pv.yes : undefined;
    } else if (f.fieldKey === "contract_value_cents") {
      key = "contract_value_cents";
      value = typeof pv.cents === "number" ? pv.cents : undefined;
    }
    if (key && value !== undefined && !(key in map)) {
      map[key] = {
        value,
        confidencePct: f.confidencePct,
        evidenceQuote: f.evidenceQuote,
      };
    }
  }
  return map;
}

function prf(counts: PrfCounts): PrfScore {
  const precision = counts.tp + counts.fp === 0 ? 1 : counts.tp / (counts.tp + counts.fp);
  const recall = counts.tp + counts.fn === 0 ? 1 : counts.tp / (counts.tp + counts.fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { ...counts, precision, recall, f1 };
}

function emptyCounts(): PrfCounts {
  return { tp: 0, fp: 0, fn: 0 };
}

export function computeEce(points: ConfidencePoint[], bins = 10): number {
  if (points.length === 0) return 0;
  const width = 100 / bins;
  let ece = 0;
  for (let b = 0; b < bins; b++) {
    const lo = b * width;
    const hi = b === bins - 1 ? 100.0001 : (b + 1) * width;
    const inBin = points.filter((p) => p.confidencePct >= lo && p.confidencePct < hi);
    if (inBin.length === 0) continue;
    const avgConf = inBin.reduce((s, p) => s + p.confidencePct, 0) / inBin.length / 100;
    const acc = inBin.filter((p) => p.correct).length / inBin.length;
    ece += (inBin.length / points.length) * Math.abs(avgConf - acc);
  }
  return Math.round(ece * 1000) / 1000;
}

export function reliabilityTable(
  points: ConfidencePoint[],
  bins = 5
): ExtractionEvalReport["reliability"] {
  const width = 100 / bins;
  const out: ExtractionEvalReport["reliability"] = [];
  for (let b = 0; b < bins; b++) {
    const lo = b * width;
    const hi = b === bins - 1 ? 100.0001 : (b + 1) * width;
    const inBin = points.filter((p) => p.confidencePct >= lo && p.confidencePct < hi);
    out.push({
      bucket: `${Math.round(lo)}-${Math.round(b === bins - 1 ? 100 : hi)}`,
      avgConfidencePct: inBin.length
        ? Math.round(inBin.reduce((s, p) => s + p.confidencePct, 0) / inBin.length)
        : 0,
      accuracyPct: inBin.length
        ? Math.round((inBin.filter((p) => p.correct).length / inBin.length) * 100)
        : 0,
      count: inBin.length,
    });
  }
  return out;
}

export function scoreCorpus(
  items: Array<{ contract: GoldenContract; result: ExtractionResult }>
): ExtractionEvalReport {
  const overall = emptyCounts();
  const byVariant = new Map<CorpusVariant, PrfCounts>();
  const calib: ConfidencePoint[] = [];
  let hallucinationEscapes = 0;
  let injectionEscapes = 0;

  for (const { contract, result } of items) {
    const preds = predictionMap(result);
    const vc = byVariant.get(contract.variant) ?? emptyCounts();

    for (const key of EVAL_FIELD_KEYS) {
      const truthVal = contract.truth[key];
      const pred = preds[key];
      const truthHas = truthVal !== undefined;

      if (truthHas) {
        if (pred && pred.value === truthVal) {
          overall.tp++; vc.tp++;
          calib.push({ confidencePct: pred.confidencePct, correct: true });
        } else if (pred) {
          // wrong value: a spurious prediction AND a missed truth
          overall.fp++; vc.fp++;
          overall.fn++; vc.fn++;
          calib.push({ confidencePct: pred.confidencePct, correct: false });
        } else {
          overall.fn++; vc.fn++; // model abstained on a present field
        }
      } else if (pred) {
        overall.fp++; vc.fp++; // predicted a field that isn't really there
        calib.push({ confidencePct: pred.confidencePct, correct: false });
      }
    }
    byVariant.set(contract.variant, vc);

    // Hallucination: every predicted field must quote the source verbatim
    // (whitespace-normalized). The provider gate should make this 0.
    for (const f of result.fields) {
      if (!normalizeWs(contract.text).includes(normalizeWs(f.evidenceQuote))) {
        hallucinationEscapes++;
      }
    }

    // Injection: an adversarial decoy value the model wrongly surfaced.
    for (const trap of contract.traps) {
      const pred = preds[trap.fieldKey];
      if (pred && pred.value === trap.forbiddenValue) injectionEscapes++;
    }
  }

  const perVariant: VariantScore[] = Array.from(byVariant.entries()).map(
    ([variant, counts]) => ({
      variant,
      contracts: items.filter((i) => i.contract.variant === variant).length,
      prf: prf(counts),
    })
  );

  return {
    contracts: items.length,
    overall: prf(overall),
    perVariant,
    hallucinationEscapes,
    injectionEscapes,
    ece: computeEce(calib),
    reliability: reliabilityTable(calib),
  };
}
