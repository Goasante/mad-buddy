import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { AdminLoginForm } from "@/components/admin/admin-login-form";
import { Badge } from "@/components/ui/badge";

export default async function AdminLoginPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-[0.82fr_1.18fr]">
      <section className="hidden border-r border-border bg-card/20 px-8 py-10 lg:flex lg:flex-col lg:justify-between">
        <Link href="/" className="text-lg font-semibold">
          Mad Buddy
        </Link>
        <div className="max-w-md">
          <Badge variant="blue">
            <ShieldCheck className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Restricted access
          </Badge>
          <h1 className="mt-5 text-4xl font-semibold leading-tight">Management console</h1>
          <p className="mt-4 text-sm leading-7 text-muted-foreground">
            Admin access is limited to approved operator emails and verified server-side before
            any management data is shown.
          </p>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">
          Use the user app for normal account testing. Use this console for reports, billing
          state, readiness checks, and deletion audits.
        </p>
      </section>
      <section className="flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-md">
          <Link href="/" className="mb-8 inline-block text-lg font-semibold lg:hidden">
            Mad Buddy
          </Link>
          <div className="glass-panel rounded-lg p-6">
            <div>
              <Badge variant="blue">Admin</Badge>
              <h1 className="mt-4 text-2xl font-semibold">Admin login</h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Sign in with an email listed in ADMIN_EMAILS.
              </p>
            </div>
            <div className="mt-6">
              <AdminLoginForm />
            </div>
          </div>
          <div className="mt-5 text-center text-sm text-muted-foreground">
            Not an operator?{" "}
            <Link href="/login" className="font-semibold text-foreground hover:text-accent">
              Go to user login
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
