import { Search, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type AdminUsersPageProps = {
  searchParams: Promise<{ q?: string }>;
};

export default async function AdminUsersPage({ searchParams }: AdminUsersPageProps) {
  const { q } = await searchParams;
  const query = q?.trim();
  const admin = createSupabaseAdminClient();
  let profilesQuery = admin
    .from("profiles")
    .select("user_id, full_name, username, visibility_status, is_onboarded, deleted_at, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  if (query) {
    profilesQuery = profilesQuery.or(`username.ilike.%${query}%,full_name.ilike.%${query}%`);
  }

  const { data: profiles } = await profilesQuery;

  return (
    <div className="space-y-6">
      <section>
        <Badge variant="orange">
          <UserRound className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Users
        </Badge>
        <h1 className="mt-4 text-3xl font-semibold">User management</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          Account records and onboarding state. Exact location data is intentionally excluded from this view.
        </p>
      </section>

      <form className="flex max-w-xl gap-2">
        <label className="sr-only" htmlFor="admin-user-search">
          Search users
        </label>
        <div className="flex min-h-11 flex-1 items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3">
          <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <input
            id="admin-user-search"
            name="q"
            defaultValue={query}
            placeholder="Search username or name"
            className="h-10 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <button className="focus-ring rounded-md border border-white/15 bg-white/5 px-4 text-sm font-semibold hover:bg-white/10">
          Search
        </button>
      </form>

      <section className="grid gap-3">
        {(profiles ?? []).map((profile) => (
          <Card key={profile.user_id} className="p-4">
            <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
              <div className="min-w-0">
                <p className="truncate font-semibold">{profile.full_name}</p>
                <p className="mt-1 truncate text-sm text-muted-foreground">@{profile.username}</p>
                <p className="mt-2 text-xs text-muted-foreground">Joined {formatDate(profile.created_at)}</p>
              </div>
              <div className="flex flex-wrap gap-2 md:justify-end">
                <Badge variant={profile.deleted_at ? "warning" : "green"}>
                  {profile.deleted_at ? "Deleted" : "Active"}
                </Badge>
                <Badge variant={profile.is_onboarded ? "blue" : "default"}>
                  {profile.is_onboarded ? "Onboarded" : "New"}
                </Badge>
                <Badge>{profile.visibility_status}</Badge>
              </div>
            </div>
          </Card>
        ))}
        {(profiles ?? []).length === 0 ? (
          <Card className="p-5 text-sm text-muted-foreground">No users found.</Card>
        ) : null}
      </section>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(value));
}
