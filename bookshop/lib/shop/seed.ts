import type { ShopConfig } from "./schema";
import { bookChapters } from "@/lib/books/product";
export const seed: ShopConfig = {
  books: [
    {
      id: "acquisition-v1",
      slug: "ma-prospecting-playbook",
      title: "Buy Businesses on Your Terms",
      subtitle:
        "From Target Search to Owner Conversations: Build Your Acquisition Pipeline with Confidence.",
      description:
        "A practical field guide to sourcing businesses with LinkedIn Sales Navigator. Define your mandate, research target companies, reach their owners and build a pipeline you can explain.",
      teaser:
        "You do not need access to every owner. You need a credible reason to speak to the right ones.\n\nStart with the business. Understand what it does, where it operates and why it fits your acquisition strategy. Then identify the person who can move the conversation forward.\n\nSales Navigator will help you find a name. It will not supply your judgment.\n\nAnd “I’d love to connect” is not an acquisition strategy, however expensive your subscription.",
      category: "M&A · Deal origination",
      mode: "support",
      priceMinor: 20000,
      published: true,
      pages: 51,
      cover: "/books/acquisition-cover.png",
      mockup: "/books/acquisition-mockup.png",
      pdf: "seed:acquisition",
      chapters: bookChapters,
      benefits: [
        "Translate your acquisition mandate into a focused company search.",
        "Qualify companies and distinguish job titles from actual ownership.",
        "Open credible conversations with practical outreach templates.",
        "Manage meetings, follow-ups and pipeline stages with working forms.",
      ],
    },
  ],
  author: {
    name: "Godfred Ofosu Asante",
    portrait: "/founder/godfred.jpg",
    email: "godfred@mad-buddy.com",
    linkedin: "https://www.linkedin.com/in/goasante",
    portfolio: "https://mad-buddy.com/godfred",
    bio: "Godfred Ofosu Asante works where B2B prospecting meets M&A deal origination: identifying the right companies, reaching decision-makers and turning research into substantive commercial conversations.\n\nHis experience spans work with founders, managing directors and senior executives across Europe, Asia and North America. He has overseen prospecting and appointment-setting delivery for more than 100 clients and booked over 1,000 appointments, supporting conversations around business acquisitions, mergers and growth opportunities.\n\nThat work has shaped a clear conviction: access is earned through preparation. A long prospect list means little without sound qualification, a credible approach and disciplined follow-through.\n\nHe is also the founder of Mad Buddy, bringing a builder’s perspective to strategy and execution.",
    services:
      "Work with Godfred to research target companies, prepare outreach and coordinate your prospecting campaign—from a clear brief to well-prepared owner conversations. Scope, responsibilities and fees are agreed separately before work begins.",
  },
  settings: {
    ghsPerUsd: 12,
    rateDate: "2026-10-13",
    presets: [5, 10, 20],
    paymentsEnabled: false,
    terms: `Terms of Use
Updated 13 October 2026

This bookshop is operated by Godfred Ofosu Asante in Ghana. Contact godfred@mad-buddy.com with questions.

Book access
Each listing identifies whether the book is free, free with optional support, or paid. Optional support is never required to download a free book. Paid access begins after successful payment verification. Payment status, amount and currency are checked with Paystack.

Your reading licence
Books are for your personal and internal professional use. You may adapt included worksheets for your own work. You may share the official book-page link. Reselling, repackaging, republishing or distributing copies requires the author's written permission. Copyright remains with the author. Downloaded files cannot be recalled or technically prevented from being copied. Previously downloaded free editions remain subject to their original permissions.

Contributions and prices
Contributions support future publications; they do not buy campaign services or promise a return. USD figures help you choose an amount. The checkout states the exact GHS charge using the displayed conversion rate before you continue. Your bank's conversion and fees may differ. We do not store card details. Do not contribute unless the confirmed charge is acceptable to you.

Payment and delivery problems
For duplicate or mistaken payments, or a paid book that you cannot access, contact us with your Paystack reference. We will investigate and arrange appropriate access or a refund where applicable. Nothing here removes applicable consumer rights.

Professional use
The books provide educational guidance on research and origination. They do not promise appointments, funding, completed acquisitions or returns, and are not a substitute for financial, legal or transaction advice. LinkedIn and other services are independent providers; their features and terms may change.

Campaign services
A campaign enquiry is not an engagement. Services require a separate agreed brief, scope and fee.

Changes
Updates apply prospectively. The version of the terms accepted with a purchase and its recorded price govern that purchase.`,
    privacy: `Privacy Notice
Updated 13 October 2026

Godfred Ofosu Asante operates this bookshop in Ghana. For access, correction, deletion or other privacy requests, contact godfred@mad-buddy.com. This notice covers the bookshop, not the Mad Buddy app.

Free downloads
You do not need to provide an email or make a payment for a free book. We record the book and date when the server returns the PDF. If you choose the optional browser-count setting, we also record a random browser identifier. These are file deliveries, not proof that a reader saved or read it. With your choice enabled, a first-party cookie lasting up to one year helps estimate distinct browsers; it does not identify a person. No measurement cookie is set when you leave the option unchecked. Blocking or resetting cookies changes that estimate.

Payments
If you contribute or buy a paid book, we collect your email, selected amount, currency, transaction reference, verification status and the book concerned. Paystack processes payment details under its own privacy notice. We do not receive or store your full card details. Short-lived secure cookies connect your browser to a payment; paid copies can carry your email and order reference to discourage redistribution.

Security and administration
We use short-lived security cookies, hashed network identifiers for rate limiting, and administrator audit records. The bookshop uses Netlify hosting and storage independently of Mad Buddy's database. Hosting and payment providers may process data outside Ghana. Admin access is restricted; credentials and payment secrets are not exposed to visitors.

Campaign enquiries
The contact button opens your email application. Information you send is used to discuss and respond to your brief. It is not automatically added to a marketing list. No newsletter or advertising tracking is enabled on this bookshop.

Retention and choices
Download records are retained for up to 12 months for reporting. Security rate-limit records expire after their applicable window. Payment records are kept while needed for paid-book access, payment disputes and required accounting obligations; we periodically review inactive records. You may ask what information we hold, correct it, request deletion where applicable, or object to a use. Required payment or accounting records may need to be retained. Requests to delete a payment email can affect recovery of paid-book access.

Third-party links
LinkedIn, portfolio and payment links have their own privacy practices. We do not sell your personal information.`,
  },
};
