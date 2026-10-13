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
      <section className="section narrow">
        <p className="eyebrow">WORK WITH GODFRED</p>
        <h1>
          Give your search
          <br />a clear direction.
        </h1>
        <p className="lead">{config.author.services}</p>
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
        <h2>Start with your brief.</h2>
        <p>
          Include your sector, geography, target company size, objectives and
          current stage. We’ll discuss the scope and fees before any work
          begins.
        </p>
        <a className="button gold" href={mail}>
          Discuss your campaign ↗
        </a>
        <p className="fine">
          This opens your email application. Contact:{" "}
          <a href={"mailto:" + config.author.email}>{config.author.email}</a>.
          Contributions support publications and do not purchase campaign
          services.
        </p>
      </section>
    </Shell>
  );
}
