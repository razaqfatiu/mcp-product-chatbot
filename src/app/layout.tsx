import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MCP Product Chatbot",
  description: "Customer-support orchestrator chatbot built with Next.js",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

