import type { Metadata, Viewport } from "next";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { getSiteUrl } from "@/lib/seo";
import "./globals.css";

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfaff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0f19" }
  ]
};

export const metadata: Metadata = {
  metadataBase: getSiteUrl(),
  title: {
    default: "Mad Buddy",
    template: "%s | Mad Buddy"
  },
  description: "When your Muddies are close, they glow, private proximity for mutually approved friends.",
  openGraph: {
    title: "Mad Buddy",
    description: "When your Muddies are close, they glow.",
    type: "website",
    images: [{ url: "/brand/mad-buddy-logo-414.png", width: 414, height: 414, alt: "Mad Buddy" }]
  },
  twitter: {
    card: "summary_large_image",
    title: "Mad Buddy",
    description: "When your Muddies are close, they glow.",
    images: ["/brand/mad-buddy-logo-414.png"]
  },
  robots: {
    index: true,
    follow: true
  }
};

type RootLayoutProps = {
  children: React.ReactNode;
};

const themeScript = `
(function() {
  try {
    var storedPreference = window.localStorage.getItem('mad-buddy-theme-preference');
    var preference = (storedPreference === 'light' || storedPreference === 'dark') ? storedPreference : 'system';
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var mode = preference === 'system' ? (prefersDark ? 'dark' : 'light') : preference;
    document.documentElement.classList.toggle('dark', mode === 'dark');
    document.documentElement.style.colorScheme = mode;

    var storedAccent = window.localStorage.getItem('mad-buddy-accent-color');
    var validAccents = ['orange', 'blue', 'violet', 'green', 'red', 'teal'];
    document.documentElement.setAttribute('data-accent', validAccents.indexOf(storedAccent) !== -1 ? storedAccent : 'orange');
  } catch (error) {
  }
})();
`;

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script id="theme-script" dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body suppressHydrationWarning>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
