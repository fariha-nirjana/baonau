import type { Metadata } from "next";
import { DM_Sans, Hind_Siliguri, Manrope } from "next/font/google";
import { BRAND } from "@/lib/brand";
import "./globals.css";

// Fonts are named here and in theme.css only. Manrope and DM Sans have no
// Bengali letters, so Hind Siliguri follows them in every font stack.
const body = DM_Sans({ variable: "--font-body", subsets: ["latin"] });
const heading = Manrope({ variable: "--font-heading", subsets: ["latin"] });
const bangla = Hind_Siliguri({ variable: "--font-bangla", subsets: ["bengali"], weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  title: `${BRAND.product}: ${BRAND.tagline}`,
  description: "An AI portfolio agent governed by a mandate you sign. Testnet demo, no real money.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${body.variable} ${heading.variable} ${bangla.variable} h-full antialiased`}>
      <body className="h-full">{children}</body>
    </html>
  );
}
