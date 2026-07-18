import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Patches",
  description: "Track patch changes and Optune wear time",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Patches"
  }
};

export const viewport: Viewport = {
  themeColor: "#f7f4ee"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
