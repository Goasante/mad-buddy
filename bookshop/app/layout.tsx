import type { Metadata } from "next";
import { getSiteUrl } from "@/lib/seo";
import "./globals.css";
export const metadata: Metadata = { metadataBase: getSiteUrl(), title: "Books by Godfred Ofosu Asante", description: "Practical playbooks for prospect research, client relationships and deal origination." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
