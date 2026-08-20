import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import {
  BookmarkSimple,
  ClockCounterClockwise,
  Plus,
} from "@phosphor-icons/react/dist/ssr";
import { ThemeToggle } from "@/components/theme-toggle";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const instrument = Instrument_Serif({
  variable: "--font-instrument",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Atlas — Cross-Platform Research",
  description: "Exact external creatives, owned evidence, and grounded briefs.",
};

const themeInit = `try{var t=localStorage.getItem("atlas-theme");if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";}document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme="dark";}`;

const navIcon =
  "tip tip-b grid size-8 place-items-center rounded-full text-muted transition-colors hover:bg-hover hover:text-foreground";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${instrument.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="min-h-full bg-background text-foreground">
        <div className="grain" aria-hidden="true" />
        <header className="fixed inset-x-0 top-3 z-20 flex justify-center px-4 no-print">
          <div className="nav-pill appear appear--scale flex h-11 items-center gap-1 rounded-full pl-5 pr-2">
            <Link href="/" className="flex items-baseline gap-2 pr-3">
              <span className="display text-[18px] font-semibold italic">
                Atlas
              </span>
              <span className="text-[9px] font-medium uppercase tracking-[.18em] text-faint">
                Research
              </span>
            </Link>
            <span className="h-5 w-px bg-stroke" aria-hidden="true" />
            <nav className="flex items-center gap-0.5">
              <Link href="/" className={navIcon} data-tip="New research" aria-label="New research">
                <Plus size={15} weight="bold" />
              </Link>
              <Link href="/history" className={navIcon} data-tip="Run history" aria-label="Run history">
                <ClockCounterClockwise size={15} />
              </Link>
              <Link href="/collections" className={navIcon} data-tip="Saved creatives" aria-label="Saved creatives">
                <BookmarkSimple size={15} />
              </Link>
              <ThemeToggle />
            </nav>
          </div>
        </header>
        <div className="mx-auto w-full max-w-[1200px] px-5 pb-8 pt-20">{children}</div>
      </body>
    </html>
  );
}
