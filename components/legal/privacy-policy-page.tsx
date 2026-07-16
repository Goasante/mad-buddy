"use client";

import Link from "next/link";
import { ArrowUp, Check, Printer } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { BrandMark } from "@/components/brand/brand-mark";
import { Button } from "@/components/ui/button";
import {
  PRIVACY_POLICY_EFFECTIVE_DATE,
  PRIVACY_POLICY_LAST_UPDATED,
  privacyPolicyMarkdown
} from "@/content/privacy-policy";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

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
  "No exact locations",
  "No maps",
  "No location history",
  "Only approved friends receive glow signals"
];

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
          <strong key={index}>{part.slice(2, -2)}</strong>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        )
      )}
    </>
  );
}

export function PrivacyPolicyPage() {
  const sections = useMemo(() => parsePolicy(privacyPolicyMarkdown), []);
  const [activeSection, setActiveSection] = useState("introduction");
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target.id) setActiveSection(visible.target.id);
      },
      { rootMargin: "-18% 0px -62% 0px", threshold: [0, 0.2, 0.6] }
    );
    sections.forEach((section) => {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    });
    return () => observer.disconnect();
  }, [sections]);

  const backToTop = () => {
    window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
  };

  return (
    <main id="top" className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 px-4 py-3 backdrop-blur-xl print:hidden">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4" aria-label="Privacy policy navigation">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <BrandMark className="h-9 w-9" priority />
            Mad Buddy
          </Link>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => window.print()} aria-label="Print privacy policy" title="Print privacy policy">
              <Printer className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Print</span>
            </Button>
            <Button type="button" size="sm" variant="ghost" asChild>
              <Link href="/">Home</Link>
            </Button>
          </div>
        </nav>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <section className="max-w-3xl" aria-labelledby="privacy-title">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Legal</p>
          <h1 id="privacy-title" className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Privacy Policy</h1>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <p>Effective date: {PRIVACY_POLICY_EFFECTIVE_DATE}</p>
            <p>Last updated: {PRIVACY_POLICY_LAST_UPDATED}</p>
          </div>
        </section>

        <section className="mt-8 grid gap-3 rounded-[1.35rem] border border-emerald-300/20 bg-emerald-300/10 p-5 sm:grid-cols-2" aria-label="Privacy summary">
          {summaryItems.map((item) => (
            <div key={item} className="flex items-center gap-3 text-sm font-medium">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-emerald-300/15 text-emerald-700 dark:text-emerald-100">
                <Check className="h-4 w-4" aria-hidden="true" />
              </span>
              {item}
            </div>
          ))}
        </section>

        <div className="mt-10 grid gap-10 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <aside className="print:hidden">
            <nav className="sticky top-24 rounded-[1rem] border border-border bg-card/65 p-3" aria-label="Privacy policy table of contents">
              <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">On this page</p>
              <ul className="max-h-[calc(100vh-9rem)] space-y-0.5 overflow-y-auto">
                {sections.map((section) => (
                  <li key={section.id}>
                    <a
                      href={`#${section.id}`}
                      aria-current={activeSection === section.id ? "location" : undefined}
                      className={`block rounded-lg px-2 py-2 text-sm transition-colors motion-reduce:transition-none ${activeSection === section.id ? "bg-secondary font-semibold text-foreground" : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground"}`}
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
              <section key={section.id} id={section.id} className="scroll-mt-24" aria-labelledby={`${section.id}-title`}>
                <h2 id={`${section.id}-title`} className="text-2xl font-semibold tracking-tight sm:text-3xl">{section.title}</h2>
                <div className="mt-5 space-y-4 text-[0.98rem] leading-7 text-muted-foreground">
                  {section.blocks.map((block, index) => {
                    if (block.type === "subheading") return <h3 key={index} className="pt-3 text-lg font-semibold text-foreground">{block.text}</h3>;
                    if (block.type === "list") return (
                      <ul key={index} className="space-y-2 pl-5">
                        {block.items.map((item) => <li key={item} className="list-disc pl-1"><InlineText text={item} /></li>)}
                      </ul>
                    );
                    return <p key={index}><InlineText text={block.text} /></p>;
                  })}
                </div>
              </section>
            ))}
          </article>
        </div>

        <div className="mt-12 flex justify-end print:hidden">
          <Button type="button" variant="outline" onClick={backToTop}>
            <ArrowUp className="h-4 w-4" aria-hidden="true" />
            Back to top
          </Button>
        </div>
      </div>
    </main>
  );
}
