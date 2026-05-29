# Strategy: The Wedge and the Moat

**Status:** Active thesis for the design-partner PoC
**Audience:** Founders, eng lead, first GTM hire
**One-line thesis to test:** *A vendor-agnostic spend feed that auto-builds renewal inventory + an evidence-bound brief that names a specific negotiation — for the card-paid SaaS slice Ramp under-serves, priced against savings — is enough of a "holy shit" that 3 of 5 design partners act on a renewal and return unprompted twice a week. If that's false, we learn it in 6 weeks for the cost of one connector and one assembled view, not a year of breadth.*

---

## 0. The bottom line, stated honestly up front

Two pain points are *tractable* (no automatic ingestion; heuristic-theater AI) and two are *existential* (advisor is the commoditized middle AI eats; spend platforms absorb the category as a free feature). The PoC dents the tractable two hard and the existential two only partially — and pretending otherwise is how we die slowly instead of quickly. The commercial critique is correct that the architecture is over-invested and the **GTM data-prep is under-resourced**. The single biggest risk is not the connector or the AI: it is that we walk into 5 demos with an empty product and a fixture dataset, and the buyer clocks the difference in 90 seconds.

So this document commits to three non-negotiable pre-demo conditions (Section 3a) that the engineering specs do not, and one scope correction: **the memo dents all five pain points; the specced code dents #1 and #4.** We close that gap explicitly rather than measuring the memo instead of the build.

---

## 1. The five pain points and the concrete bet against each

### Pain 1 — No automatic ingestion; inventory rots. STATUS: directly neutralized. THIS IS THE WEDGE.

**The bet:** build *one* ingestion path that requires zero manual entry and stays live forever on a cron. The repo already has the entire spine — `createSubscriptionWithRenewalEvent` (atomic sub + renewal_event + audit + vendor_event), `subscriptionMatchKey` dedup, `listSubscriptionExistenceKeys`, the 24h `importBatchesTable` undo. CSV import already routes through it.

The PoC does **not** add a CSV importer (that's still manual). It adds **one real feed**: a `SpendConnector` built on the exact `getCrmProvider()` / `buildXxxOrFallback()` template — interface, default offline impl, env-gated factory, `_resetForTests`. Recurring charges → auto-detected `recurring_charge` suggestions → human-confirmed subscriptions → renewal_events → alerts, on a cron, forever. **The human stops being the data pipe.** That is the holy-shit moment and the entire reason to do the PoC.

**The honest caveat (say it out loud):** a card/bank feed only sees *what hit a card*. Wire-paid enterprise contracts, procurement-PO vendors, and reseller-bundled SaaS are invisible to it. We neutralize rot for the long tail of card-paid SaaS, not for the whole estate. In a real pilot the card feed will surface ~40% of the estate, not the clean 23 subs of the demo, and it will normalize messily. That's fine for a wedge — but the partner must be told, and the detector must bias toward silence (Section 3d).

### Pain 2 — "Advisor not agent" is the commoditized middle AI is eating. STATUS: barely dented by the PoC as scoped; this is where we reposition (Section 2).

**The bet the PoC makes:** prove the advisor output is *not generic GPT prose* — it is evidence-bound reasoning over the customer's own private structured data. `recommendRenewalDecision` doesn't say "consider negotiating." It returns `renewed_with_adjustments` when `riskBand==="high" && hasPriceIncreaseClause`, cites `$X/yr` and `daysUntilNoticeDeadline`, and returns concrete `negotiationLevers` ("push back on the price-increase clause," "anchor with a competing quote"). The moat seed is the memory branch: *"You've successfully renegotiated with ${vendor} before ($X saved). The pattern is reproducible"* — reasoning over the account's own `savings_records` and `vendor_events`, which a stateless chatbot cannot reproduce.

**But the critique is right and we must own it:** an output that *only recommends* is exactly the middle AI eats. The honest answer to Pain 2 is the **safe agentic actions** in Section 2 — and as the specs stand, *none of those four actions are in the build scope*. The ingestion spec and reasoning spec build inventory + brief; the agent is described in this memo but not specced as code. **Scope correction:** put at least one safe-agent action (the auto-drafted internal notice, Section 2 item 1) into PoC scope, OR be explicit with partners that the agent is the committed next milestone they can see on a roadmap. Do not score the memo and ship the dashboard.

### Pain 3 — Category becoming a free feature of spend platforms that own the transaction data. STATUS: not dented by this PoC, and cannot be. Honest.

This is the pain we cannot engineer our way out of in a PoC. Ramp/Brex own the card. If renewal tracking becomes a checkbox in their product, our card-feed wedge is *their* native advantage, not ours.

- **We are not betting we'll out-ingest Ramp.** We can't. They have the rails.
- **We are betting on the customers Ramp doesn't serve and the data Ramp doesn't have.** Choose design partners to expose this: companies on Bill.com/Brex/Mercury/manual-AP who are *not* all-in on Ramp's card, or mid-market with split spend across cards + wire + PO. For them, a vendor-agnostic feed + cross-account benchmark + negotiation memory is not a free Ramp feature.
- **The real defense is structural misalignment, not tech.** Ramp/Brex monetize interchange and float — their P&L *increases* with card spend. Our entire value is to help a customer **spend less and sometimes cancel.** A card issuer building a tool whose success metric is "reduce the volume flowing across our card" is fighting its own revenue. That misalignment is the moat. And our pricing model (against savings, Section 5) is *structurally unavailable* to Ramp because Ramp can't charge you for cutting the spend it processes.
- **The data they don't have:** the charge is exhaust; the *decision* is intelligence. They see "$50k charged to Datadog." They do not see `rationaleCodesJson`, `negotiationLever`, `alternativesConsidered`, `negotiationOutcomeSummary`. And the value moment is **30–90 days before the charge** (the notice window) — card data only exists *after* money moves, structurally too late for the decision that matters.

**Honest verdict:** the PoC reduces but does not eliminate this risk; it buys ~18 months to build the memory/benchmark asset that *is* defensible. Design the connector interface so a "Ramp export" provider is just another factory case — if the partner test shows customers would happily take this free inside Ramp, pivot to being the intelligence layer *on top of* spend platforms (ingest *their* export), not a competitor to the rails.

### Pain 4 — No moat: heuristic-theater AI + benchmark cold-start. STATUS: moderately dented; honest about cold-start.

Two sub-bets:

- **Heuristic-theater killed by the seam, not the stub.** The heuristic/deterministic provider is genuinely evidence-bound: every extracted field carries `evidenceQuote` + `evidencePageNumber` or is rejected; confidence is an integer; output is deterministic and testable. When `ANTHROPIC_API_KEY` lands, the factory swaps in Claude behind *the same interface and the same evidence-binding contract*. The moat isn't "we have AI" — it's "our AI reasons over private, evidence-bound, account-specific structured data and must cite its source." **Non-negotiable: at least one partner must run real Claude extraction during the pilot, or the "the swap is real, not a forever-stub" claim is unproven and Pain 4 is unaddressed.**
- **Benchmark cold-start: unsolved by design, and we instrument it hardest.** `getVendorBenchmark` returns null below N≥3 accounts (`MIN_BENCHMARK_SAMPLE = 3`). With 5 partners we will barely clear the floor on the most common vendors. The bet: **seed the benchmark from the design partners' own historical contracts** (back-loaded via the existing import path) so by demo time the 5–8 highest-overlap vendors have N≥3 and produce a *real* benchmark line. Everything else stays honestly null. If even the top vendors don't clear N≥3 with 5 partners, the benchmark moat is further out than we think — and we want to know that in week 6, not month 12.

### Pain 5 — Effort misallocated to breadth (vendor portal/intake) over the wedge. STATUS: directly neutralized — this PoC IS the correction.

The bet is the scope discipline itself. The vendor portal (its own auth/tables/`writeVendorAuditLog`) and intake breadth are **frozen.** Zero new feature code outside the two wedge surfaces until the 5-company test reads out. The repo's guardrails make this enforceable, not aspirational: any new table needs a tenant-isolation block, any mutation needs `writeAuditLog`, so "just one more feature" carries real cost — use that friction as a forcing function. **If we ship anything in the vendor portal during this window, we have failed our own thesis.**

---

## 2. Repositioning: advisor → safe agent, without ever emailing vendors

The commoditized middle is "AI that tells you what to do." The defensible position is **"AI that does the reversible, internal, human-approved work for you, and never touches the vendor relationship."** The never-email-vendors principle is not a limitation to apologize for — it is the *trust boundary that makes the agency safe enough to enable.* We are an agent **inside your org's four walls**, an advisor **at the vendor boundary.**

**Reframe:** *"We don't negotiate for you. We make sure you never lose a negotiation by default."* The enemy isn't the vendor — it's silent auto-renewal and inertia. Every safe action attacks inertia; none touch the vendor.

Four SAFE agentic actions, all human-approved, reversible, audited via `writeAuditLog`, all *internal*:

1. **Auto-draft the cancellation/renegotiation notice — to the customer, never sent to the vendor.** The brief already knows `cancellation_method`, `notice_period_days`, and the deadline. The agent drafts the notice text and a calendar-ready task ("send by May 14 via the vendor's portal"). Human reviews, human sends. Reversible: it's a draft until they act. **This is the single highest-value safe action and the one to pull into PoC scope** — it converts "you should give notice" into "here's the notice, one click to queue it."
2. **Auto-create and auto-assign the renewal decision task to the product owner.** We already resolve `ownerUserId`. The agent opens the decide-now task, routes it, sets the due date to `noticeDeadline`. Fully internal, fully reversible, audited.
3. **Auto-flag and stage seat right-sizing.** When the feed shows seat count > active-user signal, the agent *stages* a downgrade recommendation with the dollar delta pre-computed. It does not change the plan. Human approves; even then we only produce the internal task, never contact the vendor.
4. **Auto-snooze / auto-escalate on the state machine.** `runRenewalStateTransitions` already moves upcoming → notice_window → action_needed → missed. The agent auto-escalates an unattended `action_needed` to the account owner (the Slack webhook connector kind already exists). Internal notification, reversible.

**The principle to put in the product:** *the agent acts on your data, your tasks, and your people — autonomously and reversibly. It only ever advises at the vendor boundary, and a human is always the one who touches the vendor.* That climbs us out of the middle (we *do* things, not just *say* things) while "this thing will never go rogue and email my vendor" becomes the trust story enterprise buyers actually want.

---

## 3. Design-partner demo script — the 5-minute "holy shit"

### 3a. THREE COMMITMENTS BEFORE ANY DEMO (the GTM conditions, not the engineering ones)

The architecture is over-prepared; the data prep is under-resourced. The demo's wow is contingent on data we don't have on day one, and the specs quietly assume it away. Lock these into the runbook:

1. **Forbid the fixture connector in any partner-facing session.** The fixture connector is a CI test harness and a keys-not-yet fallback — full stop. A partner does not buy a replay of `FIXTURE_TRANSACTIONS`. Pre-load each partner's *real* spend export (sanitized CSV is fine) into a dedicated tenant ≥48h before the demo, so the inventory that fills is *their* Datadog, *their* renewal in 9 days, *their* $84k. If you can't get a partner's export before the demo, that partner isn't a design partner — they're a tire-kicker, and you've learned something.
2. **Seed ≥1 prior negotiation outcome per partner** so the memory + BATNA passes are non-null in the very first brief on their own top renewal. This requires *no new code* (`decisionContextsTable` + `savingsRecordsTable` exist). Sit with the partner for 20 minutes, reconstruct 1–3 past renewals ("what did you pay, what did you do, what did it save?"), and log them as decision_contexts with realized savings. This is the smallest thing that flips "meh" → "take my money" (Section 4) — it converts the brief from "a chart and a deadline" into *"you saved $12k on this exact vendor last year with a competing quote; do it again, here's your $4k floor."* That sentence is the only thing in the product a buyer cannot get from a spend platform, a spreadsheet, or ChatGPT. It also trains the partner in the decision-logging habit that *is the moat.*
3. **Run ≥1 partner on real Claude extraction.** Otherwise the "the stub-to-Claude swap is real" claim (Pain 4) is unproven and a reviewer correctly says "so it's still a stub in every deployment."

Miss any one and the corresponding pain point is unproven.

### 3b. The script

**[0:00–0:30] The empty promise everyone else makes.** "Every renewal tool starts with you typing in your vendors. Ours starts empty too. Watch what happens when I connect your spend." Show the empty inventory. Set the expectation you're about to violate.

**[0:30–1:30] Connect the feed → inventory auto-populates. (The wedge.)** Click "Connect spend feed," authorize. The inventory fills itself — recurring charges resolve into subscriptions via `subscriptionMatchKey`, each gets a `renewal_event` with a computed `noticeDeadline`. "You typed nothing. Twenty-three subscriptions, eleven with renewal dates we inferred, three already inside their notice window — including one you were about to auto-renew in nine days." **This is the holy-shit beat.** The room realizes the inventory will never rot because they're not maintaining it. (Pre-loaded with *their* data per 3a.1.)

**[1:30–3:00] The AI brief recommends a specific negotiation, with evidence.** Open the highest-risk renewal. Show the assembled brief:
- *"Datadog renews in 41 days. $84K/yr. Risk: high — price-increase clause present, auto-renew on."* — each claim links to its `evidenceQuote` and page number. Not "AI says so." *Receipts.*
- *"You're paying 38% above the median across the accounts tracking Datadog (including yours)."* The benchmark line — real because we pre-seeded N≥3. **Phrase it honestly:** the benchmark includes the calling account; never say "5 *other* accounts."
- *"Last time you renegotiated GitLab you saved $12K via a competing quote. The same lever applies here."* The memory branch — reasoning over *their* `savings_records`, which no chatbot can reproduce. (Non-null because of 3a.2.)
- Negotiation levers, concrete: push back on the uplift clause; anchor with a competing quote; trade a multi-year commit for a price hold.

**[3:00–4:00] The safe agent acts — internally.** "Here's the part where most tools stop and you go do the work. Watch." One click: the agent drafts the renegotiation-notice text (correct method, correct deadline), opens a decision task assigned to the Datadog owner due on the notice deadline, and stages the right-sizing delta. "It drafted everything. It assigned the work. It will never email Datadog — that's your move, always. But you will never miss this window again, and you'll walk in with a number." (Requires the scope correction in Pain 2 / Section 2 item 1.)

**[4:00–5:00] The compounding pitch.** "Today this ran on the slice of spend that hits a card. Every renewal you decide here builds your vendor memory — next year the brief is sharper, and once a few of you are on it, the benchmark gets sharper for all of you. The tool gets *more* valuable the longer you use it. That's the opposite of a spreadsheet." Close on the asset that compounds: memory + benchmark.

### 3c. The failure movie to design against (most likely tab-close)

**Empty-product abandonment after the demo high.** (1) Demo wows because you pre-loaded. (2) Pilot starts; the real card feed sees ~40% of the estate and normalizes messily. (3) The brief for their *actual* top renewal is benchmark-null (N<3 for their specific vendors at their size) and memory-null (no prior logged decision) → it's a deadline reminder with a chart. (4) BATNA degrades to "renew at projected price." (5) They got one good auto-renewal catch in week 1, set a calendar reminder, and stopped logging in. **The "unprompted 2x/week" metric flatlines.** The killer isn't a bug — it's that the product is most valuable after months of decision-logging and at N≥3 density, and a 6-week/5-partner pilot delivers neither. The defense is 3a.2 (seed the gap) and Section 5 (annual contracts so the flywheel has time to turn).

### 3d. Tune the detector conservative

A false subscription in front of finance ("it thinks my coffee is a SaaS renewal") torches credibility instantly — finance people are professionally allergic to systems confidently wrong about money. A *missed* recurring charge is invisible. **Bias the detector toward silence:** a missed recurring charge is invisible; a false one is a tab-ender. Step E rejection thresholds (in the ingestion spec) are the single most important thing to get right.

---

## 4. Success metric for the 5-company test — what "they keep the tab open" means, measurably

"Keep the tab open" is the right instinct but unmeasurable as stated. The PoC passes only if, across the 5 partners over a **6-week** window:

**Primary (the wedge works):**
- **Ingestion durability:** ≥80% of each partner's card-paid recurring SaaS auto-appears as a subscription with a renewal_event, with **zero manual subscription creation** by the customer. (Measured: subs created via connector vs. manual/CSV path. If they're hand-entering, the wedge failed.)
- **Inventory stays live:** the feed runs on cron for the full 6 weeks; net-new recurring charges auto-appear without a human touching it. Rot rate (stale subs / total) trends to ~0.

**Primary (the intelligence is acted on — this IS "they keep the tab open"):**
- **Decision conversion:** ≥1 renewal per partner where the customer **takes a real action that originated in our brief** — logs a decision, sends the drafted notice through their own channel, or stages a downgrade. **Target: ≥3 of 5 partners** convert at least one. Zero conversions = we're a dashboard they admire and ignore.
- **Unprompted return:** ≥3 of 5 partners log in **≥2×/week without us prompting** (no nudge email triggered the session). Pull from audit-log / session timestamps. This is the literal, measurable form of "keep the tab open."

**Secondary (the moat is forming):**
- **Benchmark fires for real:** ≥5 vendors clear N≥3 across the cohort and produce a non-null benchmark that at least one partner cites as decision-relevant in an interview. If the benchmark never clears the floor with 5 partners, the cold-start is harder than scoped — a critical finding.
- **Evidence trust:** in exit interviews, ≥3 of 5 partners say the evidence-linked brief made them trust a recommendation they'd otherwise have second-guessed.

**Kill criteria (we want these as much as the wins):** if <2 partners convert a decision, OR partners keep hand-entering vendors despite the feed, OR the benchmark never clears N≥3 — the wedge thesis is wrong and we pivot *before* writing more feature code. That is the entire point of a 5-company test.

---

## 5. Moat / flywheel + cold-start answer

### The flywheel — what proprietary data accrues, and how it compounds

Four proprietary asset classes accrue per customer per renewal cycle, each already homed in the schema; the value is in fusing them.

- **A. Normalized vendor map** — the *join key* for the entire network. Every ingested row resolves a free-text vendor string to a canonical key. The unglamorous asset that takes years of messy real-world strings to harden ("Slack", "Slack Technologies", "slack.com"). **It gets monotonically better with every customer's misspelling.** (Caution: there are already two `normalizeVendorName` implementations in the repo — do not add a third; see the spec's H1 fix.)
- **B. Price trajectories** — `price_changed` / `seat_count_changed` vendor events, append-only and immutable, each carrying before/after cents + `deltaPct`. Across accounts this becomes a real renewal-uplift distribution.
- **C. Decision outcomes** — `decisionContextsTable`: `rationaleCodesJson` (14-value enum), `negotiationLever` (9-value enum), `negotiationOutcomeSummary`. **The crown jewel** — structured, multi-select labels on every renewal decision. Ramp sees "card charged $X"; we see "they threatened cancellation, cited a competing quote, and downgraded."
- **D. Negotiation results** — `savingsRecordsTable` (1:1 per renewal_event): baseline/new/saved annual cents. The *ground-truth label* that resolves whether a lever worked.

**The network effect (how C+D make reasoning better for everyone):** `getVendorBenchmark` already cross-joins decision_context → renewal_event → subscription by vendor and emits `topRationaleCodes`, `topLevers`, `medianSavingsAnnualCents`, gated at N≥3 distinct accounts. The compounding move is to **fuse lever × outcome:** not "30% pulled `competing_quote`" but "`competing_quote` on this vendor produced a median 14% reduction; `multi_year_commit` produced 9%." Every customer who logs a decision sharpens the lever-efficacy table that feeds the *next* customer's recommendation. A genuine N→N+1 effect — my Figma negotiation makes your Figma recommendation better, and neither of us sees the other's contract value (privacy floor + medians/modes only).

**The loop:** ingest → normalize to vendor map → log decision + lever → record realized savings → aggregate lever-efficacy per vendor → feed a better recommendation to the next customer → they renew better → they log → repeat. Each turn the engine moves from generic ("notice deadline in 12 days") to specific-and-earned ("on Datadog, accounts your size that pulled a competing quote 60 days out cut 14%").

### The keystone to build first (corrected from the moat critique)

The forecast half of the predict→outcome loop **already exists**: `expectedAnnualSavingsUsdCents` is persisted at decision time (in `notice-deadlines/actions.ts`). The **unbuilt keystone is the reconciliation:** stamp `expectedSavingsRealizedAt` and compare expected vs `savings_records.savedAnnualUsdCents` when the next cycle's savings lands. That comparison is what turns the benchmark from *descriptive* ("levers seen") into *predictive* ("levers that worked"). Build this before broadening anything — it is the highest-leverage instrumentation gap.

Also instrument now (cheap, impossible to backfill): make decision-context logging the default path (an unlabeled decision is a lost training row forever — events are append-only); capture the *initial renewal ask* alongside the agreed price so you can measure the negotiation delta (ask → close); persist account size band for cohort benchmarks ("this vendor for accounts your size").

### Cold-start — single-tenant value with ZERO network data

Design-partner #1 gets value before any benchmark exists, from **their own ingested history**, three layers, all already wired:

1. **Compliance/operational value on day one, no AI, no network.** The instant a sub is created, a `renewal_event` with a computed `noticeDeadline` enters the action queue. The highest-ROI moment: **catching one auto-renewal before its notice window closes.** One avoided unwanted auto-renewal pays for the product. Zero other customers required.
2. **Self-benchmarking off their own corpus** — spend concentration, which vendors auto-renew, price trajectory *within their own account* (`price_changed` across their own cycles), notice-deadline exposure. The deterministic engine produces these offline, today, with no API key.
3. **The contract-extraction wedge** — turn a pile of PDFs into structured renewal dates, notice periods, and price-increase clauses *with citations.* Pure single-tenant value, and it *seeds the vendor map and price baseline* the network later needs.

**Framing:** the benchmark is the *upsell*, not the wedge. Partner #1 buys "never miss a notice deadline + see your own renewal history structured." Benchmarks light up as a free upgrade at N≥3 — and partner #1's logged decisions are already in the corpus, so they're a contributor, not just a beneficiary.

---

## 6. Pricing / wedge implication

- **Price the outcome, not the seats or the inventory.** Inventory tracking is the thing becoming free inside Ramp — never anchor price to "number of subscriptions tracked." Anchor to **renewal value under management** and **savings captured.** `savingsRecordsTable` already computes realized savings per renewal; that number is the invoice justification. A platform fee + a success component ("you keep most of what we save you") aligns us against vendor spend — the exact opposite of a spend platform's incentive, and the cleanest answer to Pain 3: *our pricing model is structurally unavailable to Ramp* because Ramp can't charge you for cutting the spend it processes.
- **The connector is the wedge; the brief + safe-agent is the upsell.** Free/cheap tier: connect feed, auto-inventory, deadline alerts (the never-miss-a-renewal floor — cheap because it's the commoditizing layer, riding the deterministic/offline default). Paid tier: the AI brief with benchmark + memory + the safe agentic actions (the defensible layer, riding Claude + the cross-account benchmark). This mirrors the architecture.
- **Land via the wedge, expand via memory.** First invoice justified by one prevented auto-renewal or one renegotiation — a single Datadog-class save pays for a year. Expansion is automatic and defensible: the longer they stay, the more vendor memory and benchmark coverage compounds, and switching cost becomes "I lose my entire negotiation history and benchmark position." That compounding switching cost — not the feature set — is the real moat. Price to let it accrue: **annual, not monthly** (so the flywheel has time to turn); memory-portability as a retention lever.

---

## Appendix — ground-truth files reused (absolute paths)

- **Ingestion spine:** `/Users/dipurajthapa/Work/Renew/renewal-radar/src/server/application/subscriptions/index.ts`, `/Users/dipurajthapa/Work/Renew/renewal-radar/src/app/(app)/subscriptions/import-actions.ts`, `/Users/dipurajthapa/Work/Renew/renewal-radar/src/server/infrastructure/db/repositories/subscriptions.ts`
- **Connector template to clone:** `/Users/dipurajthapa/Work/Renew/renewal-radar/src/server/infrastructure/crm/index.ts`, `/Users/dipurajthapa/Work/Renew/renewal-radar/src/server/application/integrations/index.ts`, `/Users/dipurajthapa/Work/Renew/renewal-radar/src/server/infrastructure/crypto/envelope.ts`
- **AI brief surface:** `/Users/dipurajthapa/Work/Renew/renewal-radar/src/server/infrastructure/ai/heuristic-stub-provider.ts` (genuine evidence-bound `recommendRenewalDecision`), `/Users/dipurajthapa/Work/Renew/renewal-radar/src/server/infrastructure/ai/index.ts`
- **Moat data:** `/Users/dipurajthapa/Work/Renew/renewal-radar/src/server/application/vendor-benchmarks/index.ts` (N≥3 floor, `getVendorBenchmark` takes `vendorName` only), `/Users/dipurajthapa/Work/Renew/renewal-radar/src/server/application/vendor-memory/recorder.ts`, `/Users/dipurajthapa/Work/Renew/renewal-radar/src/app/(app)/notice-deadlines/actions.ts` (`expectedAnnualSavingsUsdCents` is already written; `expectedSavingsRealizedAt` is not)
- **Safe-agent state machine + notify:** `/Users/dipurajthapa/Work/Renew/renewal-radar/src/server/jobs/functions/renewal-event-state.ts`
