import Link from "next/link";
import { AuthLayout } from "@/components/auth/auth-layout";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export default function ResetPasswordPage() {
  return (
    <AuthLayout
      title="Set a new password"
      description="Use this page after opening the reset link from your email."
      footer={
        <>
          Need a new link?{" "}
          <Link href="/forgot-password" className="focus-ring -mx-2 inline-flex min-h-11 items-center rounded-lg px-2 font-semibold text-foreground hover:text-accent">
            Request reset
          </Link>
        </>
      }
    >
      <ResetPasswordForm />
    </AuthLayout>
  );
}
