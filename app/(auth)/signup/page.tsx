import Link from "next/link";
import { AuthLayout } from "@/components/auth/auth-layout";
import { SignupForm } from "@/components/auth/signup-form";

export default function SignupPage() {
  return (
    <AuthLayout
      title="Create your Mad Buddy account"
      description="Set up your profile basics, then choose private proximity settings in onboarding."
      footer={
        <>
          Need the overview?{" "}
          <Link href="/" className="font-semibold text-foreground hover:text-accent">
            Back to home
          </Link>
        </>
      }
    >
      <SignupForm />
    </AuthLayout>
  );
}
