import type { Metadata } from "next";
import { Caveat, DM_Sans, Hind_Siliguri, Outfit } from "next/font/google";
import { BRAND } from "@/lib/brand";
import "./globals.css";

// Fonts are not final either. They are named here and in theme.css only.
const body = DM_Sans({ variable: "--font-body", subsets: ["latin"] });
const heading = Outfit({ variable: "--font-heading", subsets: ["latin"] });
const hand = Caveat({ variable: "--font-handwriting", subsets: ["latin"], weight: ["500", "600"] });
const bangla = Hind_Siliguri({ variable: "--font-bangla", subsets: ["bengali"], weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  title: `${BRAND.product}: ${BRAND.tagline}`,
  description: "An AI portfolio agent governed by a mandate you sign. Testnet demo, no real money.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${body.variable} ${heading.variable} ${bangla.variable} ${hand.variable} h-full antialiased`}>
      <body className="h-full">{children}</body>
    </html>
  );
}
