import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Atlas — Cross-Platform Research",
  description: "Exact external creatives, owned evidence, and grounded briefs.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background text-foreground">
        <header className="sticky top-0 z-20 border-b border-stroke bg-background/90 backdrop-blur-md no-print">
          <div className="mx-auto flex h-12 w-full max-w-[1200px] items-center justify-between px-5">
            <Link href="/" className="flex items-baseline gap-2">
              <span className="text-[15px] font-semibold tracking-tight">Atlas</span>
              <span className="text-[10px] font-medium uppercase tracking-[.18em] text-faint">
                Research
              </span>
            </Link>
            <nav className="flex items-center gap-1 text-[13px]">
              <Link
                href="/"
                className="rounded-md px-2.5 py-1.5 text-muted transition-colors hover:bg-white/[.05] hover:text-foreground"
              >
                New research
              </Link>
              <Link
                href="/history"
                className="rounded-md px-2.5 py-1.5 text-muted transition-colors hover:bg-white/[.05] hover:text-foreground"
              >
                History
              </Link>
              <Link
                href="/collections"
                className="rounded-md px-2.5 py-1.5 text-muted transition-colors hover:bg-white/[.05] hover:text-foreground"
              >
                Collections
              </Link>
            </nav>
          </div>
        </header>
        <div className="mx-auto w-full max-w-[1200px] px-5 py-8">{children}</div>
      </body>
    </html>
  );
}
