import { configuration } from "@/lib/shop/store";
import { Shell } from "@/components/public";
export const dynamic = "force-dynamic";
export const metadata = { title: "Discuss your campaign | Godfred Books" };
export default async function Page() {
  const { config } = await configuration();
  const mail =
    "mailto:" +
    config.author.email +
    "?subject=" +
    encodeURIComponent("Campaign enquiry") +
    "&body=" +
    encodeURIComponent(
      "Target sector:\nGeography:\nTransaction or business objective:\nCompany size:\nCurrent stage:\nSupport required:\nPreferred timing:\n"
    );
  return (
    <Shell config={config}>
      <section className="section service-page">
        <div className="service-head">
          <div>
            <p className="eyebrow">GOA / BESPOKE RESEARCH &amp; CAMPAIGNS</p>
            <h1>Better targets.<br /><em>Better conversations.</em></h1>
          </div>
          <p className="lead">{config.author.services}</p>
        </div>
        <div className="service-list">
          <article>
            <h3>Target research</h3>
            <p>
              Translate your brief into search criteria and a researched company
              list.
            </p>
          </article>
          <article>
            <h3>Outreach preparation</h3>
            <p>
              Prepare credible introductions, response guidance and meeting
              handovers.
            </p>
          </article>
          <article>
            <h3>Campaign oversight</h3>
            <p>
              Coordinate delivery, review quality and keep reporting tied to
              useful outcomes.
            </p>
          </article>
        </div>
        <div className="service-cta">
          <div>
            <p className="eyebrow">START SOMETHING USEFUL</p>
            <h2>Tell me the brief.<br />I&apos;ll help define the approach.</h2>
            <p>Include your sector, geography, target company size, objectives and current stage.
              We’ll discuss scope and fees before any work begins.</p>
          </div>
          <div>
            <a className="button gold" href={mail}>Discuss your campaign ↗</a>
            <p className="fine">Opens your email application. Contact:{" "}
              <a href={"mailto:" + config.author.email}>{config.author.email}</a>.
              Contributions support publications, not campaign services.</p>
          </div>
        </div>
      </section>
    </Shell>
  );
}
