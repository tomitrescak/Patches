import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Patches",
  description: "Track patch changes and Optune wear time"
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
