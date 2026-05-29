/**
 * T3.8 — Multi-language CSV header aliases.
 *
 * European procurement teams routinely use German/French/Spanish column
 * names. The parser accepts them transparently — same downstream contract,
 * same row classification.
 *
 * These tests pin the alias contract so adding/removing aliases is an
 * intentional act backed by a green/red diff.
 */
import { describe, expect, it } from "vitest";
import { parseSubscriptionCsv } from "@server/infrastructure/csv/subscriptions-format";

function row(): string {
  return [
    "Slack",
    "Business+",
    "annual",
    "2026-01-01",
    "2027-01-01",
    "30",
    "10",
    "100",
    "true",
  ].join(",");
}

describe("parseSubscriptionCsv with non-English headers", () => {
  it("accepts a German header row", () => {
    const csv = [
      "lieferant,produkt,abrechnungszyklus,vertragsbeginn,vertragsende,kundigungsfrist,platze,stuckpreis,automatische verlangerung",
      row(),
    ].join("\n");
    const parsed = parseSubscriptionCsv(csv);
    expect(parsed.headerOk).toBe(true);
    expect(parsed.missingColumns).toEqual([]);
    expect(parsed.rows.length).toBe(1);
    expect(parsed.rows[0]?.ok).toBe(true);
  });

  it("accepts a French header row", () => {
    const csv = [
      "fournisseur,produit,cycle de facturation,debut du contrat,fin du contrat,preavis,sieges,prix unitaire,renouvellement automatique",
      row(),
    ].join("\n");
    const parsed = parseSubscriptionCsv(csv);
    expect(parsed.headerOk).toBe(true);
    expect(parsed.rows[0]?.ok).toBe(true);
  });

  it("accepts a Spanish header row", () => {
    const csv = [
      "proveedor,producto,ciclo de facturacion,inicio del contrato,fin del contrato,preaviso,asientos,precio unitario,renovacion automatica",
      row(),
    ].join("\n");
    const parsed = parseSubscriptionCsv(csv);
    expect(parsed.headerOk).toBe(true);
    expect(parsed.rows[0]?.ok).toBe(true);
  });

  it("accepts a Japanese header row", () => {
    const csv = [
      "ベンダー,製品,請求サイクル,契約開始日,契約終了日,通知期間,ライセンス数,単価,自動更新",
      row(),
    ].join("\n");
    const parsed = parseSubscriptionCsv(csv);
    expect(parsed.headerOk).toBe(true);
    expect(parsed.rows[0]?.ok).toBe(true);
  });

  it("is diacritics-insensitive (préavis matches preavis)", () => {
    const csv = [
      "fournisseur,produit,cycle de facturation,debut du contrat,fin du contrat,préavis,sieges,prix unitaire,renouvellement automatique",
      row(),
    ].join("\n");
    const parsed = parseSubscriptionCsv(csv);
    expect(parsed.headerOk).toBe(true);
  });

  it("treats whitespace, underscore, and hyphen as the same", () => {
    const csv = [
      "vendor,product,billing-cycle,term start,term_end,notice_period_days,seats,unit price usd,auto-renew",
      row(),
    ].join("\n");
    const parsed = parseSubscriptionCsv(csv);
    expect(parsed.headerOk).toBe(true);
  });

  it("still rejects a header that's missing a required column", () => {
    // German aliases for everything EXCEPT vertragsende.
    const csv = [
      "lieferant,produkt,abrechnungszyklus,vertragsbeginn,kundigungsfrist,platze,stuckpreis,automatische verlangerung",
      "Slack,Business+,annual,2026-01-01,30,10,100,true",
    ].join("\n");
    const parsed = parseSubscriptionCsv(csv);
    expect(parsed.headerOk).toBe(false);
    expect(parsed.missingColumns).toContain("term_end");
  });

  it("mixed-language headers are tolerated (mixed company spreadsheets exist)", () => {
    // Some columns English, some German.
    const csv = [
      "vendor,produkt,billing_cycle,vertragsbeginn,term_end,notice_period_days,seats,unit_price_usd,auto_renew",
      row(),
    ].join("\n");
    const parsed = parseSubscriptionCsv(csv);
    expect(parsed.headerOk).toBe(true);
    expect(parsed.rows[0]?.ok).toBe(true);
  });
});
