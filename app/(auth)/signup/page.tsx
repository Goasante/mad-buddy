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
      description="Start with email, then choose how friends find you."
      footer={null}
      compact
    >
      <SignupForm initialError={oauthErrorMessage(oauthError)} />
    </AuthLayout>
  );
}
