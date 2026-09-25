import type { Metadata } from "next";
import "./globals.css";
import { NavBar } from "@/components/NavBar";

export const metadata: Metadata = {
  title: { template: "%s | DevMind", default: "DevMind" },
  description: "Autonomous multi-agent platform that watches GitHub repos and fixes issues automatically.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>
        <NavBar />
        <div className="page-wrapper">
          {children}
        </div>
      </body>
    </html>
  );
}
