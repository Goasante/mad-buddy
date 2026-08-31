import type { ReactNode } from "react";
import { AuthShell } from "@/components/front-door/auth-shell";

export type AuthLayoutProps = {
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
  compact?: boolean;
};

export function AuthLayout({ title, description, children, footer }: AuthLayoutProps) {
  return (
    <AuthShell title={title} description={description} footer={footer}>
      {children}
    </AuthShell>
  );
}
