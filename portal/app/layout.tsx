import type { Metadata, Viewport } from "next";

import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/lato/700.css";
import "@fontsource/lato/900.css";
import "@kampusone/design-tokens/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "KampusOne Operations",
    template: "%s · KampusOne",
  },
  description: "KampusOne operations, agent and build tracking surfaces.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#FBF7F2",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
