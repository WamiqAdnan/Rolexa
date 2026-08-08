import type { Metadata } from "next";

import { Nav } from "@/components/nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rolexa",
  description:
    "A private CV library with a Master Professional Profile built from every CV you upload.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
