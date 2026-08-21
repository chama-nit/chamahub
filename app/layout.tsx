import type { Metadata, Viewport } from "next";
import Providers from "@/components/Providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "ChamaHub - Gestione HR",
  description:
    "Piattaforma per la gestione del personale: calendario presenze, richieste, valutazioni e gradimento.",
};

export const viewport: Viewport = {
  themeColor: "#1f4e79",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="it">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
