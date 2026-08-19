import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "@/styles/globals.css";

const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin — Patagonia Underground",
  // The panel must never be indexed, whatever robots.txt says.
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-basalt">{children}</body>
    </html>
  );
}
