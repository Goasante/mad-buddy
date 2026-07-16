import { redirect } from "next/navigation";
import { getSafetyAdminContext } from "@/lib/safety/admin";

export default async function SafetyPage() {
  const context = await getSafetyAdminContext();

  if (!context.ok) {
    redirect("/dashboard");
  }

  redirect("/admin/reports");
}
