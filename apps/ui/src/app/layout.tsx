import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "DevMind",
  description: "Autonomous multi-agent platform for fixing GitHub issues",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "monospace", background: "#0d1117", color: "#e6edf3" }}>
        {children}
      </body>
    </html>
  );
}
