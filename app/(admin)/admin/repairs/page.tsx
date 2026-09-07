import { redirect } from "next/navigation";
import { AdminPageHeader } from "@/components/admin/admin-ui";
import { RepairCentre } from "@/components/admin/repairs/repair-centre";
import { SupportOperationsCoverage } from "@/components/admin/repairs/support-operations-coverage";
import { getAdminAccess } from "@/lib/admin/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSafetyAdminContext } from "@/lib/safety/admin";
import { allowedRepairs } from "@/lib/admin/repairs";
import { prioritizeDoctorAreas } from "@/lib/admin/support-doctor-priority";
import { isTicketCategory, routingInputFor } from "@/lib/admin/support-ticket-context";

type RepairsPageProps = {
  searchParams: Promise<{ q?: string; ticket?: string }>;
};

export default async function RepairsPage({ searchParams }: RepairsPageProps) {
  const admin = createSupabaseAdminClient();
  const context = await getSafetyAdminContext();
  if (!context.ok) redirect("/admin/login");
  const access = await getAdminAccess(admin, context);
  if (!access.permissions.has("admin.support.manage")) redirect("/admin");

  // Only offer repairs this actor is actually allowed to run.
  const allowedIds = allowedRepairs([...access.permissions]).map((repair) => repair.id);
  const { q, ticket } = await searchParams;
  // Search is still server-validated in searchRepairUsersAction; this only
  // keeps a support-ticket deep link from carrying query syntax into the UI.
  const initialQuery = q?.trim().replace(/[,%()]/g, "").slice(0, 80) ?? "";

  /* TICKET CONTEXT, RESOLVED SERVER-SIDE.
   *
   * Only the ticket ID arrives from the client; the category is read from the
   * ticket itself, so a crafted link cannot steer which checks an operator
   * sees first. `subject` and `description` are deliberately not selected --
   * a support conversation contains whatever the user typed, and none of it
   * belongs in routing. See lib/admin/support-ticket-context.ts. */
  let prioritisedAreas: string[] = [];
  if (ticket && /^[0-9a-f-]{36}$/i.test(ticket)) {
    const { data: ticketRow } = await admin
      .from("support_tickets")
      .select("id, category")
      .eq("id", ticket)
      .maybeSingle();
    if (ticketRow) {
      prioritisedAreas = prioritizeDoctorAreas(
        routingInputFor({
          ticketId: ticketRow.id,
          category: isTicketCategory(ticketRow.category) ? ticketRow.category : null
        })
      );
    }
  }

  return (
    <div className="space-y-10">
      <div className="space-y-6">
        <AdminPageHeader
          title="Account Doctor"
          description="Diagnose safe account lifecycle state, run narrow audited repairs, verify the result, and refresh the user's app without reaching for the codebase for ordinary account drift."
        />
        <RepairCentre
          allowedRepairIds={allowedIds}
          initialQuery={initialQuery}
          prioritisedAreas={prioritisedAreas}
        />
      </div>

      <SupportOperationsCoverage />
    </div>
  );
}
