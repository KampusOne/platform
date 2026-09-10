import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";

import "@kampusone/design-tokens/styles.css";
import "./globals.css";

const inter = localFont({
  src: [
    { path: "./fonts/inter-400.ttf", weight: "400", style: "normal" },
    { path: "./fonts/inter-600.ttf", weight: "600", style: "normal" },
    { path: "./fonts/inter-700.ttf", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-inter",
});

const lato = localFont({
  src: [
    { path: "./fonts/lato-700.ttf", weight: "700", style: "normal" },
    { path: "./fonts/lato-900.ttf", weight: "900", style: "normal" },
  ],
  display: "swap",
  variable: "--font-lato",
});

export const metadata: Metadata = {
  title: {
    default: "KampusOne",
    template: "%s · KampusOne",
  },
  description: "KampusOne operational and delivery workspace.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#FBF7F2",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${lato.variable}`}>
      <body>{children}</body>
    </html>
  );
}
