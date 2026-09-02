import { AdminPageHeader, AdminSection } from "@/components/admin/admin-ui";
import {
  GlobalAccessForm,
  GrantAccessForm,
  RevokeAccessForm
} from "@/components/admin/access/access-controls";
import { listGlobalWindows, summarizeGlobalWindows } from "@/lib/access/admin";
import { requireAdminPagePermission } from "@/lib/admin/access";

export const dynamic = "force-dynamic";

/**
 * Mad Buddy Access administration.
 *
 * This is the surface that actually unlocks Linkr and UpFor. The server actions
 * behind it have existed and been tested since the access model shipped, but
 * nothing rendered them -- so an owner needing to give somebody Access had no
 * screen for it, and the nearest thing that looked right (Revenue -> premium
 * trials, offering the legacy tier ladder) belonged to a different, older
 * system that does not affect Access at all.
 */
export default async function AccessAdminPage() {
  const { admin } = await requireAdminPagePermission("admin.entitlements.manage");
  const windows = await listGlobalWindows(admin, 10);
  /* Time is read once, outside the component, by a pure helper. Reading the
     clock during render is impure and would also let two rows in the same table
     disagree about "now". */
  const { openWindow, rows } = summarizeGlobalWindows(windows);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Mad Buddy Access"
        description="Grants Linkr and UpFor. Every action here is written to the audit log before it takes effect."
      />

      <AdminSection
        title="Grant access to one person"
        description="Use this for support and comps. It is reversible and always time-boxed unless you choose Indefinite."
      >
        <GrantAccessForm />
      </AdminSection>

      <AdminSection
        title="Revoke an admin grant"
        description="Removes grants made from this screen. It cannot take away access somebody holds for another reason."
      >
        <RevokeAccessForm />
      </AdminSection>

      <AdminSection
        title={openWindow ? "Global access is OPEN" : "Open access to everyone"}
        description={
          openWindow
            ? `Everybody currently has Linkr and UpFor ${openWindow.expiresLabel}. Reason: ${openWindow.reason}`
            : "A promotion window. One row, applied to everyone, with no change to individual accounts."
        }
      >
        <GlobalAccessForm openWindowId={openWindow?.id ?? null} />
      </AdminSection>

      {rows.length > 0 ? (
        <AdminSection title="Recent global windows" description="Newest first.">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-4 font-semibold">Opened</th>
                  <th className="py-2 pr-4 font-semibold">Ends</th>
                  <th className="py-2 pr-4 font-semibold">Reason</th>
                  <th className="py-2 font-semibold">State</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-border/60">
                    <td className="py-2 pr-4 tabular-nums">{row.startedLabel}</td>
                    <td className="py-2 pr-4 tabular-nums">{row.endsLabel}</td>
                    <td className="py-2 pr-4">{row.reason}</td>
                    <td className="py-2">{row.state}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AdminSection>
      ) : null}
    </div>
  );
}
