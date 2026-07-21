import Link from "next/link";
import { AuthLayout } from "@/components/auth/auth-layout";
import { SignupForm } from "@/components/auth/signup-form";
import { oauthErrorMessage } from "@/lib/auth/oauth-redirect";

type SignupPageProps = {
  searchParams: Promise<{ oauth_error?: string }>;
};

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const { oauth_error: oauthError } = await searchParams;

  return (
    <AuthLayout
      title="Create your account"
      description="Set up the basics — you’ll choose your privacy settings next."
      footer={
        <>
          Need the overview?{" "}
          <Link href="/" className="font-semibold text-foreground hover:text-accent">
            Back to home
          </Link>
        </>
      }
    >
      <SignupForm initialError={oauthErrorMessage(oauthError)} />
    </AuthLayout>
  );
}
