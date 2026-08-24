import type { Metadata, Viewport } from "next";
import InitColorSchemeScript from "@mui/material/InitColorSchemeScript";
import Providers from "@/components/Providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "ChamaHub - Gestione HR",
  description:
    "Piattaforma per la gestione del personale: calendario presenze, richieste, valutazioni e gradimento.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0A0D16" },
    { media: "(prefers-color-scheme: light)", color: "#1B3B8C" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="it" suppressHydrationWarning>
      <body>
        {/* Applica il tema salvato prima che il browser disegni la pagina:
            senza questo script la prima immagine sarebbe quella predefinita e
            si vedrebbe un lampo di colore sbagliato a chi ha scelto l'altro
            tema. Scrive un attributo su <html>, da qui suppressHydrationWarning
            qui sopra. */}
        {/* `attribute` deve produrre gli stessi selettori che genera il tema
            (`colorSchemeSelector: "data"` in lib/theme.ts, cioe' [data-light] e
            [data-dark]): con l'attributo predefinito lo script scriverebbe un
            attributo che nessuna regola CSS guarda, e il lampo tornerebbe. */}
        <InitColorSchemeScript attribute="[data-%s]" defaultMode="dark" />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
