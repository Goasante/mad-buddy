import Link from "next/link";
import { Check } from "lucide-react";
import { Fragment } from "react";
import {
  PRIVACY_POLICY_EFFECTIVE_DATE,
  PRIVACY_POLICY_LAST_UPDATED,
  privacyPolicyMarkdown
} from "@/content/privacy-policy";

type PolicyBlock =
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] }
  | { type: "subheading"; text: string };

type PolicySection = {
  id: string;
  title: string;
  blocks: PolicyBlock[];
};

const summaryItems = [
  "No exact-location reveal to other users",
  "No live map position or exact numerical distance",
  "Muddy proximity is for mutually approved friends",
  "Linkr discovery only runs when you deliberately enable it"
] as const;

function slugify(value: string) {
  return value.toLowerCase().replace(/^\d+\.\s*/, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function parsePolicy(markdown: string) {
  const sections: PolicySection[] = [];
  let current: PolicySection = { id: "introduction", title: "Introduction", blocks: [] };
  let paragraph: string[] = [];
  let list: string[] = [];

  const flush = () => {
    if (paragraph.length) current.blocks.push({ type: "paragraph", text: paragraph.join(" ") });
    if (list.length) current.blocks.push({ type: "list", items: list });
    paragraph = [];
    list = [];
  };

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("# Mad Buddy") || line.startsWith("**Effective date:") || line.startsWith("**Last updated:")) {
      if (!line) flush();
      continue;
    }
    if (line.startsWith("## ")) {
      flush();
      if (current.blocks.length) sections.push(current);
      const title = line.slice(3);
      current = { id: slugify(title), title, blocks: [] };
      continue;
    }
    if (line.startsWith("### ")) {
      flush();
      current.blocks.push({ type: "subheading", text: line.slice(4) });
      continue;
    }
    if (line.startsWith("* ")) {
      if (paragraph.length) flush();
      list.push(line.slice(2));
      continue;
    }
    if (list.length) flush();
    paragraph.push(line);
  }

  flush();
  if (current.blocks.length) sections.push(current);
  return sections;
}

function InlineText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*.*?\*\*)/g).map((part, index) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={index} className="font-semibold text-[#4E0401] dark:text-[#FFF8F1]">
            {part.slice(2, -2)}
          </strong>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        )
      )}
    </>
  );
}

export function PrivacyPolicyPage() {
  const sections = parsePolicy(privacyPolicyMarkdown);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
      <section className="max-w-3xl" aria-labelledby="privacy-title">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#A45A18]">Legal · Privacy</p>
        <h1 id="privacy-title" className="mt-3 text-4xl font-semibold tracking-[-0.04em] text-[#4E0401] sm:text-5xl dark:text-[#FFF8F1]">
          Privacy Policy
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-8 text-[#4E0401]/65 dark:text-[#FFF8F1]/65">
          How Mad Buddy handles account information, location signals, Muddy proximity, deliberately enabled Linkr discovery, and your choices.
        </p>
        <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm text-[#4E0401]/50 dark:text-[#FFF8F1]/50">
          <p>Effective date: {PRIVACY_POLICY_EFFECTIVE_DATE}</p>
          <p>Last updated: {PRIVACY_POLICY_LAST_UPDATED}</p>
        </div>
      </section>

      <section className="mt-10 grid gap-x-8 gap-y-4 border-y border-[#4E0401]/10 py-7 sm:grid-cols-2 dark:border-white/10" aria-label="Privacy summary">
        {summaryItems.map((item) => (
          <div key={item} className="flex items-start gap-3 text-sm font-medium leading-6 text-[#4E0401]/75 dark:text-[#FFF8F1]/75">
            <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#E88C2B]/14 text-[#A45A18]">
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            {item}
          </div>
        ))}
      </section>

      <div className="mt-12 grid gap-12 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside>
          <nav className="lg:sticky lg:top-[calc(env(safe-area-inset-top,0px)+6rem)]" aria-label="Privacy policy table of contents">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#4E0401]/45 dark:text-[#FFF8F1]/45">On this page</p>
            <ul className="mt-3 grid gap-1">
              {sections.map((section) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="focus-ring inline-flex min-h-11 w-full items-center rounded-lg px-2 text-sm font-medium text-[#4E0401]/58 hover:bg-[#E88C2B]/10 hover:text-[#4E0401] dark:text-[#FFF8F1]/58 dark:hover:bg-white/[0.05] dark:hover:text-[#FFF8F1]"
                  >
                    {section.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        <article className="min-w-0 space-y-12">
          {sections.map((section) => (
            <section key={section.id} id={section.id} className="scroll-mt-28 border-t border-[#4E0401]/10 pt-8 first:border-t-0 first:pt-0 dark:border-white/10" aria-labelledby={`${section.id}-title`}>
              <h2 id={`${section.id}-title`} className="text-2xl font-semibold tracking-[-0.025em] text-[#4E0401] dark:text-[#FFF8F1]">
                {section.title}
              </h2>
              <div className="mt-5 space-y-4 text-[0.96rem] leading-7 text-[#4E0401]/64 dark:text-[#FFF8F1]/64">
                {section.blocks.map((block, index) => {
                  if (block.type === "subheading") {
                    return <h3 key={index} className="pt-3 text-lg font-semibold text-[#4E0401] dark:text-[#FFF8F1]">{block.text}</h3>;
                  }
                  if (block.type === "list") {
                    return (
                      <ul key={index} className="space-y-2 pl-5">
                        {block.items.map((item) => (
                          <li key={item} className="list-disc pl-1"><InlineText text={item} /></li>
                        ))}
                      </ul>
                    );
                  }
                  return <p key={index}><InlineText text={block.text} /></p>;
                })}
              </div>
            </section>
          ))}
        </article>
      </div>

      <div className="mt-14 border-t border-[#4E0401]/10 pt-7 text-sm dark:border-white/10">
        <Link href="/support" className="focus-ring inline-flex min-h-11 items-center rounded-lg font-semibold text-[#4E0401] hover:text-[#E88C2B] dark:text-[#FFF8F1]">
          Questions about your data? Go to Support
        </Link>
      </div>
    </div>
  );
}
