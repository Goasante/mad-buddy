import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell/app-shell";
import { getSafetyAdminContext } from "@/lib/safety/admin";

type UpgradeLayoutProps = {
  children: ReactNode;
};

export default async function UpgradeLayout({ children }: UpgradeLayoutProps) {
  const adminContext = await getSafetyAdminContext();

  return <AppShell showAdminLink={adminContext.ok}>{children}</AppShell>;
}
