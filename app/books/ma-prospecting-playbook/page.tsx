import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { MA_BOOK, bookChapters } from "@/lib/books/product";
import { bookReady } from "@/lib/books/service";
import { BookCheckout } from "./checkout";
import styles from "./book.module.css";

export const dynamic = "force-dynamic";
const description = "Find the right businesses, reach their decision-makers and turn introductions into a disciplined M&A pipeline. A practical 38-page guide by Godfred Ofosu Asante.";
export const metadata: Metadata = {
  title: { absolute: "The M&A Prospecting Playbook | Godfred Ofosu Asante" }, description,
  alternates: { canonical: MA_BOOK.path },
  openGraph: { title: MA_BOOK.title, description, type: "website", url: MA_BOOK.path, images: [{ url: "/books/ma-prospecting-playbook-social.jpg", width: 1200, height: 630, alt: "The M&A Prospecting Playbook by Godfred Ofosu Asante" }] },
  twitter: { card: "summary_large_image", title: MA_BOOK.title, description, images: ["/books/ma-prospecting-playbook-social.jpg"] }
};

export default function BookPage() {
  return <div className={styles.book}>
    <a className={styles.skip} href="#book-content">Skip to content</a>
    <header className={styles.header}><div className={styles.container}><Link className={styles.wordmark} href="/godfred">GODFRED OFOSU ASANTE</Link><nav aria-label="Book navigation"><a href="#inside">Inside the book</a><a href="#author">Author</a><a href="#buy">Get your copy</a></nav></div></header>
    <main id="book-content">
      <section className={`${styles.hero} ${styles.container}`}>
        <div><p className={styles.eyebrow}>THE M&A PROSPECTING PLAYBOOK</p><h1>The right deal begins with<br /><em>the right conversation.</em></h1><p className={styles.intro}>Find the businesses that fit your mandate. Reach the people who can make decisions. Know what to do when they reply.</p><p className={styles.description}>A practical guide to LinkedIn Sales Navigator for business buyers, founders, M&A advisers and the professionals supporting their search.</p><div className={styles.actions}><a className={styles.primary} href="#buy">Get the playbook · GH₵200</a><a className={styles.secondary} href={MA_BOOK.sample} target="_blank" rel="noopener noreferrer">Read the free sample</a></div><p className={styles.note}>38 pages · 13 chapters · Templates and worksheets · One-time purchase</p></div>
        <figure className={styles.cover}><Image src={MA_BOOK.cover} width={756} height={1080} alt="Navy and gold cover of The M&A Prospecting Playbook by Godfred Ofosu Asante" preload sizes="(max-width: 760px) 70vw, 350px"/><figcaption>First edition · October 2026</figcaption></figure>
      </section>
      <section className={styles.teaser} aria-labelledby="teaser-heading"><div className={styles.narrow}><p className={styles.eyebrow}>A GLIMPSE INSIDE</p><h2 id="teaser-heading">The owner’s first answer<br />is only the beginning.</h2><p>An owner tells you they want to grow the business before selling. It sounds like a conversation about valuation.</p><blockquote>“What would selling make possible for you?”</blockquote><p>That question may take you somewhere else entirely. More time. Reliable income. A future for the team they built. The confidence to step back.</p><p><strong>Understanding that outcome can change the conversation—and the next step you propose.</strong></p><p>But first, you need to find the right company, reach the right person and earn that conversation. This playbook takes you through the work that gets you there.</p><p className={styles.note}>An illustrative scenario, adapted from the book’s first-call method.</p><a className={styles.textLink} href="#inside">Explore the method →</a></div></section>
      <section id="inside" className={`${styles.section} ${styles.container}`}><p className={styles.eyebrow}>FROM SEARCH TO FOLLOW-THROUGH</p><h2>A process you can put to work.</h2><div className={styles.grid}>
        {[
          ["01", "Find with purpose", "Turn an acquisition mandate into focused company searches. Use geography, sector, size and Boolean expressions with a clear reason for every filter."],
          ["02", "Qualify before contact", "Check the business model, identify the right people and review your first batch before outreach. Make evidence gaps visible."],
          ["03", "Handle the conversation", "Adapt original introductions and reply templates. Prepare the first call, understand the owner’s priorities and agree a useful next step."],
          ["04", "Keep the pipeline honest", "Separate research from real opportunities. Track meetings, responsibilities and next actions with practical worksheets and a 30-day plan."]
        ].map(([number,title,detail])=><article key={number}><span className={styles.number}>{number}</span><h3>{title}</h3><p>{detail}</p></article>)}
      </div></section>
      <section className={styles.contents}><div className={styles.container}><div><p className={styles.eyebrow}>WHAT YOU RECEIVE</p><h2>13 chapters.<br />A working toolkit.</h2><p>A complete PDF with original outreach scripts, first-batch approval methods, search examples, a glossary and links to official resources.</p><p>Includes separate approaches for acquisition targets, prospective buyers and merger partners.</p><a className={styles.textLink} href={MA_BOOK.sample} target="_blank" rel="noopener noreferrer">Preview the introduction and first chapter →</a></div><ol>{bookChapters.map((chapter,index)=><li key={chapter}><span>{String(index+1).padStart(2,"0")}</span>{chapter}</li>)}</ol></div></section>
      <section id="author" className={`${styles.author} ${styles.container}`}><Image src="/founder/godfred.jpg" alt="Godfred Ofosu Asante" width={400} height={400} sizes="(max-width: 760px) 180px, 260px"/><div><p className={styles.eyebrow}>MEET THE AUTHOR</p><h2>Godfred Ofosu Asante</h2><p>Godfred is a Ghana-based operations and growth professional with experience in B2B and M&A prospect research, client relationship management and campaign coordination.</p><p>Previously a Senior Account Manager and Operations Officer at TouchForce, his work has included Sales Navigator and Endole research, outreach delivery, appointment coordination and reporting systems. He is also the founder of Mad Buddy.</p><Link className={styles.textLink} href="/godfred">Explore Godfred’s work →</Link></div></section>
      <section id="buy" className={`${styles.purchase} ${styles.container}`}><div><p className={styles.eyebrow}>YOUR NEXT CONVERSATION STARTS HERE</p><h2>Build a search<br />you can explain.</h2><p>Get the complete playbook, original message templates and reusable working forms.</p><p className={styles.price}>GH₵200 <span>launch price · one-time payment</span></p><p className={styles.note}>Checkout is charged in Ghanaian cedis. International buyers’ banks handle currency conversion. Supported payment methods appear at Paystack checkout.</p></div><BookCheckout enabled={bookReady()}/></section>
      <section className={`${styles.faq} ${styles.narrow}`} aria-labelledby="faq-heading"><h2 id="faq-heading">Before you buy</h2>
        <details><summary>Who is this book for?</summary><p>Acquisition entrepreneurs, founders considering acquisitions, M&A advisers and corporate development teams. Lead generation and marketing professionals supporting those teams can use the research and campaign methods too.</p></details>
        <details><summary>What format will I receive?</summary><p>A 38-page PDF, personalised with your purchase email and order reference. It includes 13 chapters, templates, worksheets and references. You can read it on a phone, tablet or computer.</p></details>
        <details><summary>How do I access my purchase?</summary><p>After payment is confirmed, you can download your copy. A private access link is also sent to your purchase email. Links expire after 24 hours; use the purchase-recovery page to request a fresh one.</p></details>
        <details><summary>Does it include Sales Navigator or acquisition advice?</summary><p>The purchase includes the book. A Sales Navigator subscription is purchased separately from LinkedIn. The guide focuses on research and deal origination; it does not promise introductions, completed acquisitions or financial returns.</p></details>
        <details><summary>What if I need help with payment or delivery?</summary><p>For duplicate charges, delivery difficulties or other purchase issues, email <a href="mailto:godfred@mad-buddy.com">godfred@mad-buddy.com</a> with your order reference. For practical research support, describe your sector, geography and search brief.</p></details>
      </section>
    </main><footer className={styles.footer}><div className={styles.container}><span>© {new Date().getFullYear()} Godfred Ofosu Asante</span><Link href={`${MA_BOOK.path}/access`}>Recover a purchase</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><a href="mailto:godfred@mad-buddy.com">Contact</a></div><p>Independent publication. Not affiliated with or endorsed by LinkedIn.</p></footer>
  </div>;
}
