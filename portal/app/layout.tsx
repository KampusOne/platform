import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";

import "@kampusone/design-tokens/styles.css";
import "./globals.css";

const manrope = localFont({
  src: [
    { path: "./fonts/manrope-400.ttf", weight: "400", style: "normal" },
    { path: "./fonts/manrope-600.ttf", weight: "600", style: "normal" },
    { path: "./fonts/manrope-800.ttf", weight: "800", style: "normal" },
  ],
  display: "swap",
  variable: "--font-manrope",
});

const caveat = localFont({
  src: "./fonts/caveat-600.ttf",
  weight: "600",
  display: "swap",
  variable: "--font-caveat",
});

export const metadata: Metadata = {
  title: {
    default: "KampusOne Platform Preview",
    template: "%s · KampusOne",
  },
  description: "Internal platform foundation preview for KampusOne.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#FBF7F2",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${manrope.variable} ${caveat.variable}`}>
      <body>{children}</body>
    </html>
  );
}
