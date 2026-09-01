import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function BillingPage() {
  redirect("/settings/access");
}
