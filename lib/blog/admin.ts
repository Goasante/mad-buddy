import "server-only";
import { redirect } from "next/navigation";
import { getSafetyAdminContext } from "@/lib/safety/admin";
import { getAdminAccess } from "@/lib/admin/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function blogOwnerContext() {
  const context = await getSafetyAdminContext();
  if (!context.ok) return null;
  const admin = createSupabaseAdminClient();
  const access = await getAdminAccess(admin, context);
  return access.role === "owner" ? { admin, context, access } : null;
}
export async function requireBlogOwner() {
  const auth = await blogOwnerContext();
  if (!auth) redirect("/admin");
  return auth;
}
