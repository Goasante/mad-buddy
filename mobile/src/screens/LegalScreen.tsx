import { ArrowLeft } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import {
  PRIVACY_POLICY_EFFECTIVE_DATE,
  PRIVACY_POLICY_LAST_UPDATED,
  privacyPolicyMarkdown
} from "@/content/privacy-policy";
import { TERMS_EFFECTIVE_DATE, termsSections } from "@/content/terms";

/**
 * Terms and Privacy, in the native app.
 *
 * Both render the SAME content modules the web pages use. A native copy of a
 * legal document is a second document that will eventually disagree with the
 * first, and "which version did this user actually accept" would then depend
 * on which build they happened to be running.
 *
 * These are reachable before sign-up completes, because that is when consent
 * is given -- a document you can only read after agreeing to it is not a
 * document you agreed to.
 */

function LegalChrome({ title, meta, children }: { title: string; meta: string; children: React.ReactNode }) {
  const navigate = useNavigate();

  return (
    <main className="min-h-screen bg-background px-4 py-6 sm:px-6">
      <div className="mx-auto w-full max-w-2xl">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="focus-ring mb-4 inline-flex h-11 items-center gap-2 rounded-full px-3 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </button>

        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{meta}</p>

        <div className="mt-6 space-y-4 pb-16">{children}</div>
      </div>
    </main>
  );
}

/**
 * Minimal markdown rendering for the privacy document.
 *
 * Deliberately not a markdown library: the source is a fixed document we ship,
 * not user input, and the only constructs it uses are headings, list items and
 * paragraphs. Pulling a parser in for three cases would add bundle weight to
 * the native app for no behavioural gain.
 */
function renderMarkdown(markdown: string) {
  return markdown.split("\n").map((line, index) => {
    const key = `line-${index}`;
    const trimmed = line.trim();

    if (!trimmed) return null;
    if (trimmed.startsWith("## ")) {
      return (
        <h2 key={key} className="pt-4 text-lg font-semibold tracking-tight">
          {trimmed.slice(3)}
        </h2>
      );
    }
    if (trimmed.startsWith("# ")) {
      return (
        <h2 key={key} className="pt-4 text-xl font-bold tracking-tight">
          {trimmed.slice(2)}
        </h2>
      );
    }
    if (trimmed.startsWith("- ")) {
      return (
        <p key={key} className="pl-4 text-sm leading-relaxed text-muted-foreground">
          &bull; {trimmed.slice(2)}
        </p>
      );
    }
    return (
      <p key={key} className="text-sm leading-relaxed text-muted-foreground">
        {trimmed}
      </p>
    );
  });
}

export function PrivacyScreen() {
  return (
    <LegalChrome
      title="Privacy Policy"
      meta={`Effective ${PRIVACY_POLICY_EFFECTIVE_DATE} · Last updated ${PRIVACY_POLICY_LAST_UPDATED}`}
    >
      {renderMarkdown(privacyPolicyMarkdown)}
      <p className="pt-6 text-sm text-muted-foreground">
        Also see the{" "}
        <Link to="/terms" className="font-semibold text-foreground underline underline-offset-2">
          Terms of Service
        </Link>
        .
      </p>
    </LegalChrome>
  );
}

export function TermsScreen() {
  return (
    <LegalChrome title="Terms of Service" meta={`Effective ${TERMS_EFFECTIVE_DATE}`}>
      {termsSections.map((section) => (
        <section key={section.title} className="space-y-2">
          <h2 className="pt-4 text-lg font-semibold tracking-tight">{section.title}</h2>
          {section.blocks.map((block, blockIndex) =>
            block.type === "paragraph" ? (
              <p key={`${section.title}-${blockIndex}`} className="text-sm leading-relaxed text-muted-foreground">
                {block.text}
              </p>
            ) : (
              <ul key={`${section.title}-${blockIndex}`} className="space-y-1">
                {block.items.map((item, itemIndex) => (
                  <li
                    key={`${section.title}-${blockIndex}-${itemIndex}`}
                    className="pl-4 text-sm leading-relaxed text-muted-foreground"
                  >
                    &bull; {item}
                  </li>
                ))}
              </ul>
            )
          )}
        </section>
      ))}
      <p className="pt-6 text-sm text-muted-foreground">
        Also see the{" "}
        <Link to="/privacy" className="font-semibold text-foreground underline underline-offset-2">
          Privacy Policy
        </Link>
        .
      </p>
    </LegalChrome>
  );
}
