import Link from "next/link";
import { AuthLayout } from "@/components/auth/auth-layout";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <AuthLayout
      title="Reset your password"
      description="Enter your email and we will send a secure password reset link."
      footer={
        <>
          New here?{" "}
          <Link href="/signup" className="focus-ring -mx-2 inline-flex min-h-11 items-center rounded-lg px-2 font-semibold text-foreground hover:text-accent">
            Create account
          </Link>
        </>
      }
    >
      <ForgotPasswordForm />
    </AuthLayout>
  );
}
