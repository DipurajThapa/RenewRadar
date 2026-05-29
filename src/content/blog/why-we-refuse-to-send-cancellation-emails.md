---
title: Why we refuse to send cancellation emails on your behalf
description: A binding architectural principle — Renewal Radar drafts vendor communications; you click send. Here's why "advisor, never agent" is the right call for this product.
author: founders
publishedAt: "2026-05-08"
updatedAt: "2026-05-28"
tags:
  - principles
  - architecture
  - opinion
featured: true
---

When we tell prospects that Renewal Radar doesn't send cancellation emails to vendors on their behalf, the first reaction is almost always: *"why not?"*

It's a fair question. The product knows the vendor's contact email. It knows the customer's identity. It can generate a vendor-ready letter in 200 milliseconds. The send button is right there. Most other tools in this space — Trim, some of the RPA-based cancellation services — do exactly that.

We've thought about this a lot. The answer is: **we are an advisor, never an agent.** Renewal Radar drafts vendor communications and presents them to you. You review, you click send. The email goes from your address to the vendor.

This isn't a missing feature. It's an architectural commitment. Here's why.

## The risk surface of acting on someone's behalf

The moment we send the email, we are a party to the customer's commercial relationship with their vendor. Three risks compound from that:

### 1. Legal authority

Most SaaS contracts require notice from "an authorized representative" of the customer. The exact phrasing varies, but the spirit is the same: the vendor wants to know that the cancellation is coming from a human with authority, not a script.

If Renewal Radar sends the email, the vendor can reasonably ask: who authorized this? Was this user permitted to give notice on behalf of the company? Did they read the contract before clicking? If the answer to any of those is unclear, the vendor can disregard the notice.

When the customer sends the email from their own address, the authority question is settled. The customer's email server's outbound IP, DKIM signature, and From address are all evidence that the notice came from the customer.

### 2. Mistakes get worse, not better

We've watched RPA cancellation tools cancel the wrong account, cancel an unrelated subscription at the same vendor, or cancel mid-month rather than at term end. Each of those is a costly mistake. Each of them is harder to unwind because the vendor has already processed the cancellation.

The friction of clicking send is the right friction. It forces the user to read what they're about to send and confirm the date, the product, and the vendor's account ID one last time. That extra five seconds catches mistakes that an automated send doesn't.

### 3. Trust between us and the customer

The product asks customers to upload contracts, document terms, and let us extract pricing data. The trust gradient is steep — the customer is showing us their commercial cards.

If we then turn around and send emails on their behalf, we're asking for more trust than we've earned. We become an entity that takes commercial actions, not just a tool that helps the customer take them.

The "we never send" rule lets us be unambiguous with prospects: we are a tool. We never make a vendor-facing move you didn't review.

## What this means in practice

The Cancellation Letter Generator drafts a vendor-ready letter that quotes:

- The specific notice clause from the customer's contract.
- The term end date.
- The customer's vendor-side account ID, if it's known.
- The customer's name, title, and company in the signature block.

Two send paths are offered. *Open in my mail client* (a `mailto:` link) launches the user's default email app with the message pre-populated. *Copy to clipboard* puts the same text on the clipboard for paste into webmail. In both cases, the email originates from the user's address. We never see it leave. We never touch the vendor's inbox.

There is one operational consequence: the customer has to actually click send. Some customers, even after building the letter, procrastinate. We are explicit about that in the product copy and we send reminders. We will not "help" by sending it for them.

## When this principle would change

For completeness: there are circumstances under which we'd consider sending email on a customer's behalf. None of them apply today.

- If the customer's organisation legally delegates that authority to a vendor management agent (e.g. via a managed services agreement), and that agreement names Renewal Radar, then we could be that agent on the customer's behalf. We do not currently offer that arrangement.
- If we had a verified, audit-grade record of the user's authority at the customer's organisation — beyond a simple email-plus-password sign-in — sending email on their behalf would carry less risk. We don't have that signal today.

In every other case, the customer sends the email. That's the rule.

## Why we keep writing about this

Architectural principles only matter if they're surfaced, repeated, and defended. We write about this one publicly because we want prospects to read it before they buy. If you want a tool that sends vendor emails on your behalf, that's a fine thing to want — and we are not the right product for you. If you want a tool that does the homework, drafts the letter, and lets you decide when to send, [we're built for that](/).
