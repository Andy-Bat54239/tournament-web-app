import type { Metadata, Viewport } from "next";
import { Outfit } from "next/font/google";
import { Suspense } from "react";
import { Nav } from "@/components/nav";
import { ScheduleBanner, StartsLine } from "@/components/schedule-header";
import "./globals.css";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: ["400", "600"],
});

export const metadata: Metadata = {
  title: {
    default: "Castle Connect UG tournaments",
    template: "%s · Castle Connect UG",
  },
  description: "Sign up, check in and follow the Castle Connect UG Sunday chess tournament on Lichess.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0B5D45",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={outfit.variable}>
      <body>
        <header>
          <h1>Castle Connect UG</h1>
          <Suspense fallback={<p>&nbsp;</p>}>
            <StartsLine />
          </Suspense>
        </header>
        <Nav />
        <main>
          <Suspense fallback={null}>
            <ScheduleBanner />
          </Suspense>
          {children}
        </main>
      </body>
    </html>
  );
}
