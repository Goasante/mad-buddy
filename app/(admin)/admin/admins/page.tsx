import { ShieldCheck, UserPlus } from "lucide-react";
import { CreateAdminForm } from "@/components/admin/create-admin-form";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export default async function AdminUsersManagementPage() {
  const admin = createSupabaseAdminClient();
  const { data: admins, error } = await admin
    .from("admin_users")
    .select("email, role, auth_user_id, disabled_at, created_at")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <section>
        <Badge variant="orange">
          <ShieldCheck className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Admins
        </Badge>
        <h1 className="mt-4 text-3xl font-semibold">Admin access</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          Create management accounts and review who can enter the admin console.
          Passwords are sent to Supabase Auth and are not stored in Mad Buddy tables.
        </p>
      </section>

      <section className="grid gap-5 lg:grid-cols-[420px_1fr]">
        <Card className="p-5">
          <div className="mb-5 flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-md bg-orange-400/10 text-orange-200">
              <UserPlus className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-lg font-semibold">Add admin</h2>
              <p className="text-sm text-muted-foreground">Email and temporary password.</p>
            </div>
          </div>
          <CreateAdminForm />
        </Card>

        <div className="grid content-start gap-3">
          <h2 className="text-xl font-semibold">Current database admins</h2>
          {error ? (
            <Card className="p-5 text-sm text-amber-100">
              Admin table is not available yet. Run the new Supabase migration first.
            </Card>
          ) : null}
          {(admins ?? []).map((item) => (
            <Card key={item.email} className="p-4">
              <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{item.email}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Added {formatDate(item.created_at)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 md:justify-end">
                  <Badge variant={item.disabled_at ? "warning" : "green"}>
                    {item.disabled_at ? "Disabled" : "Active"}
                  </Badge>
                  <Badge variant="orange">{item.role}</Badge>
                  <Badge>{item.auth_user_id ? "Auth linked" : "Email only"}</Badge>
                </div>
              </div>
            </Card>
          ))}
          {!error && (admins ?? []).length === 0 ? (
            <Card className="p-5 text-sm text-muted-foreground">
              No database admins yet. Your `.env` admin still works as the bootstrap account.
            </Card>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
