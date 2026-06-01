# Renewal Radar — "How to use" demo script

A record-ready shooting script for a ~2-minute product walkthrough. Each scene
lists the on-screen action, the voiceover (VO), and what to point at. The flow
mirrors the real product running in **demo mode** (`pnpm dev`, `DEMO_MODE=1`,
http://localhost:3000) — every number below is what the seeded demo actually
shows after the brief fixes landed.

> Record it in one take with any screen recorder (Loom, QuickTime, Screen
> Studio), or hand this script + the captured stills to an editor, or feed the
> VO blocks to a narration tool. Keep the browser at 1440×900 for clean framing.

**Pre-flight**
- Dev server up on `:3000`, demo mode on, seeded data loaded.
- Briefs regenerated (`pnpm exec dotenv -e .env.local -- tsx scripts/db/regen-briefs.ts`)
  so every Renewal Intelligence Brief reflects current logic.
- Dismiss the onboarding tour ("Skip tour") before recording for a clean frame.

---

## Scene 1 — The dashboard (≈25s)

**Screen:** `/dashboard`. Land on the greeting + KPI row + action band + the
"Your biggest renewal risk" card.

**VO:**
> "This is Renewal Radar — it watches every subscription you have and tells you
> what actually needs your attention today. Up top: what you've saved this year,
> what you're spending, and how many notice deadlines are closing in the next 30
> days. Below that, the AI has already triaged your renewals by risk — here it's
> flagging the Datadog Pro Plan, because the notice window is short and
> auto-renew is on."

**Point at:** the KPI cards → the "renewals at high risk" tile → the purple
"Your biggest renewal risk" card with its confidence badge.

---

## Scene 2 — The "Needs you" queue (≈25s)

**Screen:** click **Needs you** in the sidebar (`/action-queue`).

**VO:**
> "Everything that needs a human lands in one ranked list — renewals, document
> reviews, approvals, intake requests, and charges the AI auto-detected from
> your spend feed. No more four separate inboxes. Each row carries a confidence
> or match score, and the whole list is ordered by urgency, so the thing at the
> top is genuinely the thing to do next."

**Point at:** the type filters (Renewals / Reviews / Approvals / Requests /
Spend) → a "95% match" detected charge → the Datadog notice-deadline row.

---

## Scene 3 — The Renewal Intelligence Brief (≈40s)

**Screen:** open the Datadog Pro Plan renewal → its subscription page with the
**Renewal Intelligence Brief**.

**VO:**
> "Open a renewal and the AI hands you a brief. It reads your own price history,
> the cross-account benchmark, and the notice-window clock, then makes one
> recommendation — here, 'renew, but renegotiate first, four days to the notice
> deadline.' Every claim is tagged with where it came from and how confident the
> model is, and you can expand any of them to see the receipts. And notice what
> it does *not* do: when it doesn't have clean enough data to project a number,
> it stays quiet instead of guessing. Below, it's already drafted your internal
> notice and listed exactly what's still missing — but a human always sends it."

**Point at:** the `DETERMINISTIC` engine badge + confidence → expand the
"Renewal risk" claim to show evidence → the "Prepared for you" block
(Auto-prepared by the Renewal Agent) → Questions to resolve / Missing
information → the **"Advisor, never agent"** footer.

---

## Scene 4 — Ask Renewal Radar (≈25s)

**Screen:** click the ✨ **Ask** icon in the top bar → the inline panel → click
the chip **"What's my biggest risk?"**.

**VO:**
> "And you can just ask. The assistant answers only from your own data — risk,
> spend, savings, renewals, compliance — never from the open internet. Here it
> says the biggest risk is the Datadog Pro Plan, nine hundred dollars a year,
> high risk — and every finding expands to its evidence and deep-links straight
> to the screen it came from. It reads, reasons, and points you to the decision.
> It never sends, pays, renews, or cancels on its own. Advisor, never agent."

**Point at:** the grounded answer summary → a `FINDING · DETERMINISTIC · 90%`
row expanding to its evidence → the deep-link → the footer line.

---

## Closing card (≈5s)

**On screen:** Renewal Radar logo / dashboard.

**VO:**
> "Renewal Radar — your renewals, understood, prepared, and ready. You stay in
> control of every decision."

---

### Notes for whoever records this
- The brief's projected-renewal figure only appears when there's clean,
  in-band observed spend for that subscription; for the demo's Datadog Pro Plan
  it's intentionally suppressed (the detected charges are a different line
  item). To showcase a live projection instead, record Scene 3 against a
  subscription whose spend series matches its contract value.
- Nothing in the product takes an external/irreversible action on its own — keep
  the "advisor, never agent" line; it's the core trust promise.
- This is product guidance, not legal advice — keep any on-screen disclaimers in
  frame if you show the brief's fine print.
