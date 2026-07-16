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
          <Link href="/forgot-password" className="font-semibold text-foreground hover:text-accent">
            Request reset
          </Link>
        </>
      }
    >
      <ResetPasswordForm />
    </AuthLayout>
  );
}
