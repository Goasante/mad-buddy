import { cookies } from "next/headers";
import { getTourToOffer } from "@/lib/tours/service";
import { loadTourForPreview } from "@/lib/tours/preview-service";
import { decodeTourPreview, TOUR_PREVIEW_COOKIE } from "@/lib/tours/preview";
import { TourRunner } from "@/components/tours/tour-runner";

/**
 * Server-side entry point for guided tours, consumer and preview.
 *
 * Mounted inside a Suspense boundary by the authenticated layout, so tour work
 * is never on the critical path for the route itself. It renders nothing at all
 * for the overwhelming majority of loads (anyone who has already resolved the
 * current version), which is why it is safe to have in the shell.
 *
 * Preview takes priority when an admin has an active session. Because this host
 * lives in the shell, a draft preview keeps working across the route changes
 * that route-aware steps perform, using the real consumer renderer rather than
 * a second admin-only one.
 */
export async function TourHost({ userId }: { userId: string }) {
  const store = await cookies();
  const preview = decodeTourPreview(store.get(TOUR_PREVIEW_COOKIE)?.value);

  if (preview) {
    // loadTourForPreview re-checks admin.tours.manage on every render, so the
    // cookie alone gives a consumer nothing. A revoked admin simply falls
    // through to the normal consumer path below.
    const draft = await loadTourForPreview(preview.versionId);
    if (draft && draft.steps.length > 0) {
      return (
        <TourRunner
          tourVersionId={draft.tourVersionId}
          title={draft.title}
          description={draft.description}
          steps={draft.steps.map((step) => ({
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
          startIndex={0}
          plan={draft.plan}
          entitlements={draft.entitlements}
          preview
          autoStart
          previewReturnTo={preview.returnTo}
          previewLabel={`Previewing ${draft.title} v${draft.version} (${draft.status})`}
        />
      );
    }
  }

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
