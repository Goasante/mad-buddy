import Link from "next/link";
import type { Metadata } from "next";
import { BrandMark } from "@/components/brand/brand-mark";
import { legalContact } from "@/content/privacy-policy";
import { FEATURE_ICON_CREDITS } from "@/lib/icons/feature-icons";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Mad Buddy terms and conditions.",
  alternates: { canonical: "/terms" },
  openGraph: {
    title: "Terms of Service | Mad Buddy",
    description: "Mad Buddy terms and conditions.",
    url: "/terms"
  }
};

const TERMS_EFFECTIVE_DATE = "23 July 2026";

type TermsBlock = { type: "paragraph"; text: string } | { type: "list"; items: string[] };
type TermsSection = { title: string; blocks: TermsBlock[] };

const sections: TermsSection[] = [
  {
    title: "1. Who we are",
    blocks: [
      {
        type: "paragraph",
        text: `Mad Buddy is operated by ${legalContact.companyName}, located at ${legalContact.businessAddress} ("Mad Buddy", "we", "our", or "us").`
      },
      { type: "paragraph", text: `If you have questions about these Terms, please contact us at ${legalContact.supportEmail}.` }
    ]
  },
  {
    title: "2. Eligibility",
    blocks: [
      { type: "paragraph", text: "To use Mad Buddy, you must:" },
      {
        type: "list",
        items: [
          "Be at least 18 years old, or the minimum legal age required to create an online account in your country.",
          "Provide accurate and complete information.",
          "Keep your account credentials secure.",
          "Not create an account on behalf of another person without permission."
        ]
      },
      { type: "paragraph", text: "You are responsible for everything that happens under your account." }
    ]
  },
  {
    title: "3. About the service",
    blocks: [
      {
        type: "paragraph",
        text: 'Mad Buddy helps mutually approved friends ("Muddies") stay socially connected by sharing privacy-focused proximity information.'
      },
      { type: "paragraph", text: "Mad Buddy intentionally does not display:" },
      { type: "list", items: ["Exact GPS coordinates", "Street addresses", "Live maps", "Exact distances"] },
      {
        type: "paragraph",
        text: "Instead, users receive approximate proximity signals designed to protect everyone's privacy."
      },
      {
        type: "paragraph",
        text: "Because proximity information depends on several factors, including device permissions, internet connectivity, and operating system restrictions, it may occasionally be delayed or inaccurate."
      },
      { type: "paragraph", text: "You must never rely on Mad Buddy for:" },
      {
        type: "list",
        items: [
          "Personal safety",
          "Emergency situations",
          "Navigation",
          "Finding missing persons",
          "Medical emergencies",
          "Any situation requiring precise location information"
        ]
      }
    ]
  },
  {
    title: "4. User safety",
    blocks: [
      { type: "paragraph", text: "Your safety is important." },
      {
        type: "paragraph",
        text: "Mad Buddy does not perform background checks, verify user identities, or guarantee that any user is who they claim to be."
      },
      { type: "paragraph", text: "You are solely responsible for your interactions with other users, whether online or offline." },
      { type: "paragraph", text: "Always use good judgement when communicating with or meeting another person." },
      { type: "paragraph", text: "If you believe another user is abusing the platform, you should report and block them immediately." }
    ]
  },
  {
    title: "5. Acceptable use",
    blocks: [
      { type: "paragraph", text: "You agree that you will not:" },
      {
        type: "list",
        items: [
          "Harass, threaten, intimidate, or stalk another user.",
          "Attempt to determine another person's precise location.",
          "Create fake or misleading accounts.",
          "Impersonate another individual or organisation.",
          "Upload unlawful, offensive, or harmful content.",
          "Interfere with the operation or security of the Service.",
          "Reverse engineer, scrape, copy, or exploit any part of the Service without permission.",
          "Introduce malware, viruses, or harmful software.",
          "Use Mad Buddy for illegal purposes."
        ]
      },
      {
        type: "paragraph",
        text: "We reserve the right to investigate suspected misuse and may suspend or permanently terminate accounts that violate these Terms."
      },
      { type: "paragraph", text: "Where legally required, we may cooperate with law enforcement authorities." }
    ]
  },
  {
    title: "6. User content",
    blocks: [
      { type: "paragraph", text: "You retain ownership of the content you upload, including:" },
      {
        type: "list",
        items: ["Profile photographs", "Bios", "Usernames", "Status updates", "Other personal content"]
      },
      {
        type: "paragraph",
        text: "By uploading content, you grant Mad Buddy a worldwide, non-exclusive, royalty-free licence to host, store, process, reproduce, and display your content solely for the purpose of operating and improving the Service."
      },
      { type: "paragraph", text: "You confirm that you have the necessary rights to upload your content." }
    ]
  },
  {
    title: "7. Privacy",
    blocks: [
      { type: "paragraph", text: "Your personal information is processed in accordance with our Privacy Policy." },
      { type: "paragraph", text: "You remain responsible for deciding what information you choose to share with other users." }
    ]
  },
  {
    title: "8. Subscriptions and payments",
    blocks: [
      { type: "paragraph", text: "Some features of Mad Buddy require a paid subscription." },
      { type: "paragraph", text: "Payments are securely processed through Paystack." },
      { type: "paragraph", text: "By purchasing a subscription, you agree that:" },
      {
        type: "list",
        items: [
          "Subscription fees are charged at the prices displayed within the Service.",
          "Subscriptions automatically renew unless cancelled before the next billing date.",
          "Failed payments may result in the loss of premium features until payment is successful.",
          "Prices may change with reasonable notice.",
          "Applicable taxes may be included where required by law."
        ]
      },
      { type: "paragraph", text: "Nothing in these Terms limits any statutory consumer rights available under applicable law." }
    ]
  },
  {
    title: "9. Intellectual property",
    blocks: [
      {
        type: "paragraph",
        text: "Mad Buddy, including its software, design, logos, graphics, branding, text, and technology, is owned by us or our licensors and is protected by intellectual property laws."
      },
      { type: "paragraph", text: "These Terms do not grant you ownership of any part of the Service." },
      {
        type: "paragraph",
        text: "You may not copy, reproduce, distribute, modify, or create derivative works without our written permission."
      }
    ]
  },
  {
    title: "10. Service availability",
    blocks: [
      { type: "paragraph", text: "We strive to provide a reliable Service but cannot guarantee that it will always be:" },
      { type: "list", items: ["Available", "Uninterrupted", "Error-free", "Secure"] },
      { type: "paragraph", text: "We may modify, suspend, remove, or discontinue features at any time without liability." }
    ]
  },
  {
    title: "11. Suspension and termination",
    blocks: [
      {
        type: "paragraph",
        text: "You may stop using Mad Buddy and delete your account at any time through the application settings."
      },
      { type: "paragraph", text: "We may suspend or terminate your account immediately if:" },
      {
        type: "list",
        items: [
          "You violate these Terms.",
          "We believe your account presents a security risk.",
          "We are required to do so by law.",
          "It is necessary to protect other users or the integrity of the Service."
        ]
      },
      { type: "paragraph", text: "Deletion of your account will be handled in accordance with our Privacy Policy." }
    ]
  },
  {
    title: "12. Beta services",
    blocks: [
      { type: "paragraph", text: "Some parts of Mad Buddy may be released as beta or pre-release features." },
      { type: "paragraph", text: "These features may contain bugs, change without notice, or be discontinued." },
      { type: "paragraph", text: "Your use of beta features is entirely at your own risk." }
    ]
  },
  {
    title: "13. Disclaimers",
    blocks: [
      { type: "paragraph", text: 'The Service is provided on an "as is" and "as available" basis.' },
      { type: "paragraph", text: "To the fullest extent permitted by law, we make no warranties regarding:" },
      {
        type: "list",
        items: ["Accuracy", "Reliability", "Availability", "Fitness for a particular purpose", "Continuous operation"]
      },
      { type: "paragraph", text: "We do not guarantee that proximity information will always be correct or available." }
    ]
  },
  {
    title: "14. Limitation of liability",
    blocks: [
      {
        type: "paragraph",
        text: "To the fullest extent permitted by law, Mad Buddy and its owners, directors, employees, and partners shall not be liable for:"
      },
      {
        type: "list",
        items: [
          "Indirect damages",
          "Incidental damages",
          "Consequential damages",
          "Loss of profits",
          "Loss of goodwill",
          "Loss of business opportunities",
          "Data loss"
        ]
      },
      {
        type: "paragraph",
        text: "Our total liability for any claim relating to the Service shall not exceed the amount you paid to us during the twelve (12) months preceding the claim."
      },
      { type: "paragraph", text: "Nothing in these Terms excludes liability that cannot legally be excluded." }
    ]
  },
  {
    title: "15. Force majeure",
    blocks: [
      {
        type: "paragraph",
        text: "We are not responsible for delays or failures caused by circumstances beyond our reasonable control, including:"
      },
      {
        type: "list",
        items: [
          "Natural disasters",
          "Internet outages",
          "Government actions",
          "Cyberattacks",
          "Utility failures",
          "Failures of third-party service providers"
        ]
      }
    ]
  },
  {
    title: "16. Changes to these Terms",
    blocks: [
      { type: "paragraph", text: "We may update these Terms from time to time." },
      {
        type: "paragraph",
        text: "Where changes are significant, we will notify users through the application or by other appropriate means before the changes take effect."
      },
      {
        type: "paragraph",
        text: "Your continued use of the Service after the effective date of updated Terms constitutes acceptance of those changes."
      }
    ]
  },
  {
    title: "17. Governing law",
    blocks: [
      {
        type: "paragraph",
        text: "These Terms shall be governed by and interpreted in accordance with the laws of the Republic of Ghana, without regard to conflict of law principles."
      },
      {
        type: "paragraph",
        text: "Any disputes arising from these Terms shall be subject to the jurisdiction of the competent courts of Ghana, unless applicable consumer protection laws require otherwise."
      }
    ]
  },
  {
    title: "18. Contact",
    blocks: [
      { type: "paragraph", text: "For questions regarding these Terms, please contact:" },
      { type: "paragraph", text: `Email: ${legalContact.supportEmail}` }
    ]
  }
];

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-background px-4 py-16 text-foreground">
      <div className="mx-auto max-w-2xl">
        <div className="text-center">
          <BrandMark className="mx-auto h-16 w-16" priority />
          <h1 className="mt-4 text-3xl font-semibold">Terms and Conditions</h1>
          <p className="mt-2 text-sm text-muted-foreground">Effective date: {TERMS_EFFECTIVE_DATE}</p>
        </div>

        <p className="mt-8 text-sm leading-7 text-muted-foreground">
          Welcome to Mad Buddy. These Terms and Conditions (&ldquo;Terms&rdquo;) govern your access to and use of the
          Mad Buddy application, website, and related services (collectively, the &ldquo;Service&rdquo;).
        </p>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          By creating an account or using Mad Buddy, you confirm that you have read, understood, and agree to be
          bound by these Terms and our Privacy Policy. If you do not agree, please do not use the Service.
        </p>

        <div className="mt-8 space-y-8">
          {sections.map((section) => (
            <section key={section.title}>
              <h2 className="text-lg font-semibold">{section.title}</h2>
              <div className="mt-2 space-y-3">
                {section.blocks.map((block, index) =>
                  block.type === "list" ? (
                    <ul key={index} className="space-y-1.5 pl-5 text-sm leading-7 text-muted-foreground">
                      {block.items.map((item) => (
                        <li key={item} className="list-disc pl-1">
                          {item}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p key={index} className="text-sm leading-7 text-muted-foreground">
                      {block.text}
                    </p>
                  )
                )}
              </div>
            </section>
          ))}
        </div>

        <section className="mt-12 border-t border-border/70 pt-8">
          <h2 className="text-lg font-semibold">Icon credits</h2>
          <p className="mt-2 text-sm leading-7 text-muted-foreground">
            Some icons used within Mad Buddy are provided by Flaticon under their applicable licence:
          </p>
          <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
            {FEATURE_ICON_CREDITS.map((credit) => (
              <li key={credit.label}>
                {credit.label} icons created by {credit.author} –{" "}
                <a
                  href={credit.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-foreground underline decoration-border underline-offset-2 hover:text-accent"
                >
                  Flaticon
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            All icon rights remain with their respective creators and Flaticon in accordance with their licensing terms.
          </p>
        </section>

        <div className="mt-12 flex justify-center gap-4 border-t border-border/70 pt-6 text-sm">
          <Link href="/" className="font-semibold hover:text-accent">Home</Link>
          <Link href="/privacy" className="font-semibold hover:text-accent">Privacy Policy</Link>
        </div>
      </div>
    </main>
  );
}
