import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUpRight, Download, Mail } from "lucide-react";
import styles from "./portfolio.module.css";

const linkedin = "https://www.linkedin.com/in/goasante";
const instagram = "https://www.instagram.com/alpha_graphix_gh/";
const cvUrl = "/founder/Godfred-Ofosu-Asante-CV.pdf";
const rewardsStory = "https://www.linkedin.com/posts/goasante_opstoapps-leadership-techtransformation-activity-7394395108600786944-E9hR";
const description = "Godfred Ofosu Asante — founder of Mad Buddy, operations leader, B2B lead generation specialist and visual creative based in Ghana.";

export const metadata: Metadata = {
  title: { absolute: "Godfred Ofosu Asante — Builder, Operator & Creative" },
  description,
  alternates: { canonical: "/godfred" },
  openGraph: { title: "Godfred Ofosu Asante", description, url: "/godfred", type: "profile", firstName: "Godfred", lastName: "Ofosu Asante" },
  twitter: { card: "summary_large_image", title: "Godfred Ofosu Asante", description, images: ["/godfred/opengraph-image"] }
};

const capabilities = [
  { number: "01", title: "Product & technology", detail: "From an everyday problem to a working product. Web experiences, practical tools, and systems people can actually use." },
  { number: "02", title: "Operations & people", detail: "Campaign execution, team leadership, and recognition systems that make good work visible." },
  { number: "03", title: "Lead generation & growth", detail: "B2B and M&A prospect research, Sales Navigator, Endole, and data enrichment and validation." },
  { number: "04", title: "Visual design", detail: "Graphic design and interface thinking. Clear messages, considered typography, and a visual identity with purpose." }
];

export default function GodfredPortfolio() {
  return (
    <div className={styles.portfolio}>
      <a className={styles.skip} href="#portfolio-content">Skip to content</a>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <a href="#portfolio-content" className={styles.wordmark} aria-label="Godfred Ofosu Asante, back to top">GOA<span>.</span></a>
          <nav aria-label="Portfolio navigation" className={styles.navigation}>
            <a href="#work">Work</a><a href="#about">About</a><a href="#contact">Connect <ArrowUpRight aria-hidden="true" /></a>
          </nav>
          <Link href="/about" className={styles.backLink}>Mad Buddy <ArrowUpRight aria-hidden="true" /></Link>
        </div>
      </header>

      <main id="portfolio-content">
        <section className={`${styles.hero} ${styles.container}`} aria-labelledby="hero-heading">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}><span className={styles.statusDot} /> Based in Ghana. Building beyond it.</p>
            <h1 id="hero-heading">Godfred<br />Ofosu Asante<span>.</span></h1>
            <p className={styles.heroStatement}>A builder’s mind.<br /><em>A creative’s eye.</em></p>
            <p className={styles.heroDescription}>I turn ideas into useful products, stronger teams, and meaningful connections. Founder of Mad Buddy. Working across operations, growth, and design.</p>
            <div className={styles.heroActions}>
              <a href="#work" className={styles.button}>Explore my work <ArrowDown aria-hidden="true" /></a>
              <a href={cvUrl} download className={styles.textLink}>Download CV <Download aria-hidden="true" /></a>
            </div>
          </div>
          <figure className={styles.portraitFrame}>
            <span className={styles.portraitIndex} aria-hidden="true">G / O / A</span>
            <div className={styles.portraitImage}>
              <Image src="/founder/godfred.jpg" alt="Godfred Ofosu Asante wearing a suit, with his arms folded" width={400} height={400} preload sizes="(max-width: 700px) 85vw, 400px" />
            </div>
            <figcaption><span>Ideas are a start.<br /><strong>Building is the difference.</strong></span><span className={styles.portraitMonogram} aria-hidden="true">GOA.</span></figcaption>
            <span className={styles.portraitLabel}>Builder · Operator · Creative</span>
          </figure>
        </section>

        <div className={styles.disciplineStrip} aria-label="Areas of work">
          <div className={styles.container}><span>Product</span><span aria-hidden="true">·</span><span>People</span><span aria-hidden="true">·</span><span>Growth</span><span aria-hidden="true">·</span><span>Design</span></div>
        </div>

        <section id="work" className={`${styles.work} ${styles.container}`} aria-labelledby="work-heading">
          <div className={styles.sectionHeader}>
            <div><p className={styles.eyebrow}>01 / Selected work</p><h2 id="work-heading">Ideas, put to work<span>.</span></h2></div>
            <p>Different disciplines.<br />The same drive to make things better.</p>
          </div>

          <article className={styles.featuredProject}>
            <div className={styles.featuredCopy}>
              <p className={styles.projectType}>01 — Product / Founder</p>
              <h3>Mad Buddy</h3>
              <p className={styles.projectSubtitle}>Less scrolling.<br />More showing up.</p>
              <p>A social app built around real-life connection. Privacy-safe proximity, deliberate discovery, and Meetups help a digital hello become time together.</p>
              <div className={styles.tags}><span>Product thinking</span><span>Web & mobile</span><span>Privacy by design</span></div>
              <Link href="/about" className={styles.lightLink}>Discover Mad Buddy <ArrowUpRight aria-hidden="true" /></Link>
            </div>
            <div className={styles.madBuddyVisual}>
              <div className={styles.orbit} aria-hidden="true" />
              <Image src="/brand/mad-buddy-hero-mockup-v2.png" alt="Mad Buddy app preview showing nearby friends, Meetups and Linkr" width={1179} height={1024} sizes="(max-width: 700px) 90vw, 650px" />
              <span className={styles.visualCaption}>Made for the people you actually want to see.</span>
            </div>
          </article>

          <article className={styles.rewardsProject}>
            <div className={styles.rewardsVisual}>
              <Image src="/founder/rewards-system.jpg" alt="A team celebration featured in Godfred’s workplace rewards project write-up" width={1280} height={720} sizes="(max-width: 700px) 90vw, 600px" />
              <div className={styles.rewardsCaption}><span>Beyond the dashboard</span><strong>Make good work<br />worth celebrating.</strong></div>
            </div>
            <div className={styles.rewardsCopy}>
              <p className={styles.projectType}>02 — Operations / Internal tool</p>
              <h3>Recognition that<br />changes the rhythm.</h3>
              <p>I built a workplace gamification and rewards system to recognise effort, encourage fair competition, and bring the team together through Victory Friday.</p>
              <p>Google Sheets kept records easy to audit. Feedback shaped improvements, including duplicate checks and stronger validation.</p>
              <dl className={styles.metrics}><div><dt>+65%</dt><dd>Appointments overall</dd></div><div><dt>98%</dt><dd>Active system usage</dd></div></dl>
              <p className={styles.metricNote}>Results I reported after three months, in my LinkedIn project series.</p>
              <a href={rewardsStory} className={styles.textLink}>Read the project story <ArrowUpRight aria-hidden="true" /></a>
            </div>
          </article>

          <div className={styles.projectPair}>
            <article className={styles.growthProject}>
              <p className={styles.projectType}>03 — Research / Growth</p>
              <div className={styles.growthVisual} aria-hidden="true"><span>Research</span><i /><span>Validate</span><i /><span>Connect</span></div>
              <h3>Better prospects.<br />Better conversations.</h3>
              <p>B2B and M&A outreach, recruitment campaigns, copywriting, and email marketing. Company research and validated data help turn prospecting into more informed conversations.</p>
              <div className={styles.tags}><span>Sales Navigator</span><span>Endole</span><span>Data quality</span></div>
              <a href="https://gamma.app/docs/Business-Growth-Through-Expert-Lead-Generation-kl2kst8vhu7lxjx" className={styles.textLink}>See the lead generation case study <ArrowUpRight aria-hidden="true" /></a>
            </article>
            <article className={styles.designProject}>
              <p className={styles.projectType}>04 — Visual / Design practice</p>
              <div className={styles.designVisual}>
                <Image src="/founder/event-design.webp" alt="Godfred’s red and white SRC inter-hall football tournament poster" width={1080} height={1080} sizes="(max-width: 700px) 42vw, 240px" />
                <Image src="/founder/seasonal-design.webp" alt="Godfred’s blue and white seasonal greetings design for Sambus Geospatial" width={1080} height={1080} sizes="(max-width: 700px) 42vw, 240px" />
              </div>
              <h3>A visual point of view.</h3>
              <p>Graphic design, content management, social media, and video editing. My work at Alpha Graphix brings a clear message and a considered visual identity together.</p>
              <a href={instagram} className={styles.textLink}>See designs on Instagram <ArrowUpRight aria-hidden="true" /></a><br /><a href="https://www.behance.net/gallery/249204525/Goasante-Portfolio" className={styles.textLink}>Explore selected creative work <ArrowUpRight aria-hidden="true" /></a>
            </article>
          </div>
        </section>

        <section id="about" className={styles.aboutSection} aria-labelledby="about-heading">
          <div className={`${styles.container} ${styles.aboutGrid}`}>
            <div><p className={styles.eyebrow}>02 / The person behind the work</p><h2 id="about-heading">Curious by nature.<br /><em>Practical by choice.</em></h2></div>
            <div className={styles.aboutCopy}><p>I’m Godfred, a Ghana-based builder and operations professional with a creative streak. I like the point where people, business, and technology meet.</p><p>That shows up in the products I build, the teams I’ve led, the prospects I’ve researched, and the visuals I create. My approach is simple: understand the problem, make something useful, and keep improving it.</p><a href={linkedin} className={styles.textLink}>My full professional profile <ArrowUpRight aria-hidden="true" /></a></div>
            <div className={styles.capabilities}>{capabilities.map((item) => <div key={item.number}><span>{item.number}</span><h3>{item.title}</h3><p>{item.detail}</p></div>)}</div>
          </div>
        </section>

        <section className={`${styles.experience} ${styles.container}`} aria-labelledby="experience-heading">
          <div className={styles.sectionHeader}><div><p className={styles.eyebrow}>03 / Experience & foundations</p><h2 id="experience-heading">Built along the way<span>.</span></h2></div><a href={linkedin} className={styles.textLink}>View experience on LinkedIn <ArrowUpRight aria-hidden="true" /></a></div>
          <div className={styles.experienceRows}>
            <article><span>Leadership</span><div><h3>Touchforce</h3><p>Operations Officer · Previously Senior Account Manager</p></div><span>August 2024–March 2026</span></article>
            <article><span>Building</span><div><h3>Mad Buddy</h3><p>Founder & creator</p></div><span>Product, experience & technology</span></article>
            <article><span>AI recruitment</span><div><h3>FlowmingoAI</h3><p>Business Partner · Remote contract</p></div><span>September 2025–March 2026</span></article>
            <article><span>Earlier experience</span><div><h3>Sambus Geospatial</h3><p>Digital Marketing & Graphic Design</p></div><span>October 2021–October 2022</span></article>
            <article><span>Early foundation</span><div><h3>Complete Farmer</h3><p>Graphic Design Intern · Web support</p></div><span>June–August 2018</span></article>
            <article><span>Graduate study</span><div><h3>University of Ghana Business School</h3><p>Master’s degree in Marketing · In progress</p></div><span>2025–Present</span></article>
            <article><span>Education</span><div><h3>University of Ghana</h3><p>BA, Geography & Resource Development and Political Science</p></div><span>2017–2021</span></article>
          </div>
        </section>

        <section id="contact" className={styles.contact} aria-labelledby="contact-heading">
          <div className={styles.container}>
            <p className={styles.eyebrow}>04 / Make the connection</p>
            <h2 id="contact-heading">Something in mind?<br /><em>Let’s build on it.</em></h2>
            <div className={styles.contactBottom}><p>Products, growth, operations, or creative work.<br />A good conversation is a good place to start.</p><a href="mailto:godfred@mad-buddy.com" className={styles.contactButton}>Start a conversation <Mail aria-hidden="true" /></a></div>
            <div className={styles.emailLinks}><a href="mailto:godfred@mad-buddy.com">godfred@mad-buddy.com</a><a href="mailto:godfredasante004@gmail.com">godfredasante004@gmail.com</a></div>
            <nav className={styles.socialLinks} aria-label="Godfred’s profiles"><a href={linkedin}><ArrowUpRight aria-hidden="true" /> LinkedIn</a><a href={instagram}><ArrowUpRight aria-hidden="true" /> Alpha Graphix</a><a href="https://github.com/Goasante"><ArrowUpRight aria-hidden="true" /> GitHub</a><a href={cvUrl} download>Download CV (PDF) <Download aria-hidden="true" /></a></nav>
          </div>
        </section>
      </main>
      <footer className={`${styles.footer} ${styles.container}`}><p>© {new Date().getFullYear()} Godfred Ofosu Asante</p><Link href="/about">Meet Mad Buddy <ArrowRight aria-hidden="true" /></Link><a href="#portfolio-content">Back to top ↑</a></footer>
    </div>
  );
}
