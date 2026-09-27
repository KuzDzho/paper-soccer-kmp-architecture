import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Russo_One, Inter } from "next/font/google";
import "./globals.css";

const russo = Russo_One({ weight: "400", subsets: ["latin", "cyrillic"], variable: "--font-anton" });
const grotesk = Inter({
  subsets: ["latin", "cyrillic"],
  variable: "--font-grotesk",
});

export const metadata: Metadata = {
  title: "PAPER SOCCER — меловой футбол на газоне",
  description:
    "Аркадная головоломка «бумажный футбол»: гиперреалистичный газон, физика мяча, боты трёх уровней, хот-сит и онлайн PvP.",
};

export const viewport: Viewport = {
  themeColor: "#050805",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" className={`${russo.variable} ${grotesk.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
