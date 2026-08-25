"use client";

// ---------------------------------------------------------------------------
// Il marchio a schermo
// ---------------------------------------------------------------------------
// Un solo componente per tutti i punti in cui compare il nome dell'applicazione:
// barra laterale, pagina di accesso, e qualunque altro posto che verra'.
//
// Il file dell'immagine e' `app/icon.svg`, fornito da chi possiede il marchio.
// Non viene rigenerato ne' modificato da nessuna parte: si legge e basta. Il
// percorso arriva da brand.json, cosi' anche questo resta una scelta sola.
// ---------------------------------------------------------------------------

import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { APP_NAME, APP_TAGLINE, brand } from "@/lib/brand";

interface LogoProps {
  /** Lato del segno, in pixel. */
  size?: number;
  /** `contrast` per i fondi scuri (pagina di accesso). */
  tone?: "default" | "contrast";
  /** Mostra il sottotitolo sotto il nome. */
  withTagline?: boolean;
  /** In colonna e centrato, invece che in riga. */
  stacked?: boolean;
}

export default function Logo({
  size = 34,
  tone = "default",
  withTagline = true,
  stacked = false,
}: LogoProps) {
  const contrasto = tone === "contrast";

  const nome = (
    <Stack spacing={0} sx={{ alignItems: stacked ? "center" : "flex-start" }}>
      <Typography
        variant={stacked ? "h1" : "h4"}
        sx={{
          lineHeight: 1.2,
          letterSpacing: stacked ? -0.5 : 0,
          color: contrasto ? "#fff" : "primary.main",
        }}
      >
        {APP_NAME}
      </Typography>
      {withTagline && (
        <Typography
          variant={stacked ? "body1" : "caption"}
          sx={{
            color: contrasto ? "rgba(255,255,255,0.8)" : "text.secondary",
          }}
        >
          {APP_TAGLINE}
        </Typography>
      )}
    </Stack>
  );

  return (
    <Stack
      direction={stacked ? "column" : "row"}
      spacing={stacked ? 1.5 : 1.25}
      useFlexGap
      sx={{ alignItems: "center" }}
    >
      {/* `img` e non `next/image`: il file e' un SVG servito cosi' com'e', e
          l'ottimizzatore non avrebbe niente da ottimizzare. */}
      <Box
        component="img"
        src={brand.logo.svg}
        alt=""
        aria-hidden
        sx={{ width: size, height: size, display: "block", flexShrink: 0 }}
      />
      {nome}
    </Stack>
  );
}
