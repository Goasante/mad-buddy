import { getTourToOffer } from "@/lib/tours/service";
import { TourRunner } from "@/components/tours/tour-runner";

/**
 * Server-side entry point for guided tours.
 *
 * Mounted inside a Suspense boundary by the authenticated layout, so tour
 * eligibility — three scoped reads — is never on the critical path for the route
 * itself. It renders nothing at all for the overwhelming majority of loads
 * (anyone who has already resolved the current version), which is why it is safe
 * to have in the shell.
 */
export async function TourHost({ userId }: { userId: string }) {
  const tour = await getTourToOffer(userId);
  if (!tour) return null;

  return (
    <TourRunner
      tourVersionId={tour.tourVersionId}
      title={tour.title}
      description={tour.description}
      steps={tour.steps.map((step) => ({
        id: step.id,
        stepKey: step.stepKey,
        title: step.title,
        body: step.body,
        targetId: step.targetId,
        route: step.route,
        mediaPath: step.mediaPath,
        ctaLabel: step.ctaLabel,
        ctaHref: step.ctaHref,
        entitlementKeys: step.entitlementKeys
      }))}
      startIndex={tour.startIndex}
      plan={tour.plan}
      entitlements={tour.entitlements}
    />
  );
}
