import type { Metadata } from "next";

import { EventShareRedirect } from "@/components/events/event-share-redirect";
import { eventMetadataMayDisclose, loadEventShareMetadata } from "@/lib/events/share-metadata";
import { absoluteUrl } from "@/lib/seo";

type EventSharePageProps = { params: Promise<{ eventId: string }> };

export async function generateMetadata({ params }: EventSharePageProps): Promise<Metadata> {
  const { eventId } = await params;
  const event = await loadEventShareMetadata(eventId);
  const mayDisclose = Boolean(event && eventMetadataMayDisclose(event));
  const title = mayDisclose ? event!.name : "Event on Mad Buddy";
  const description = mayDisclose && event!.description
    ? event!.description.slice(0, 180)
    : "Open this Event securely in Mad Buddy.";
  const image = absoluteUrl(`/events/${encodeURIComponent(eventId)}/preview`);
  const canonical = absoluteUrl(`/events/${encodeURIComponent(eventId)}`);

  return {
    title,
    description,
    alternates: { canonical },
    robots: { index: false, follow: false },
    openGraph: {
      title,
      description,
      type: "website",
      url: canonical,
      images: [{ url: image, width: 1200, height: 630, alt: mayDisclose ? event!.name : "Mad Buddy Event" }]
    },
    twitter: { card: "summary_large_image", title, description, images: [image] }
  };
}

export default async function EventSharePage({ params }: EventSharePageProps) {
  const { eventId } = await params;
  return <EventShareRedirect eventId={eventId} />;
}
