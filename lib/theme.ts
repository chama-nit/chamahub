"use client";

import { createTheme } from "@mui/material/styles";
import { brand } from "./brand";

// ---------------------------------------------------------------------------
// Tavolozza Chamanit
// ---------------------------------------------------------------------------
// I valori NON sono scritti qui: arrivano da supabase/functions/_shared/brand.json,
// che e' la stessa fonte da cui li leggono le email. Cambiare una tinta li'
// cambia insieme interfaccia e messaggi, invece di lasciarne una indietro.
//
// I colori del company profile:
//
//   #0A0D16  nero blu      #1B3B8C  blu           #4A1B7A  viola
//   #C238C4  magenta       #E8865A  arancio       #F4B594  pesca
//   #FFFFFF  bianco
//
// Blu e viola fanno il lavoro pesante (primario e secondario, quindi menu
// attivo, pulsanti, intestazioni); magenta e arancio compaiono negli accenti e
// nei grafici; il nero blu e' il fondo del tema scuro.
//
// I colori che dicono "attenzione" o "errore" restano invece riconoscibili come
// tali: un pulsante di eliminazione viola sarebbe elegante e pericoloso. Sono
// stati pero' riportati verso la famiglia della tavolozza - l'arancio di
// avviso e' quello del marchio, il verde e' virato verso il verde-azzurro dei
// grafici - cosi' convivono senza stonare.
//
// Ogni tinta ha due gradini: quello per il fondo chiaro e quello per il fondo
// scuro. Non e' un capriccio - il blu #1B3B8C su #0A0D16 e' praticamente
// invisibile, mentre la sua versione chiara resta lo stesso blu del marchio.
// ---------------------------------------------------------------------------

const { light, dark } = brand.colors;

export const theme = createTheme({
  cssVariables: { colorSchemeSelector: "data" },
  defaultColorScheme: "dark",
  colorSchemes: {
    light: {
      palette: {
        primary: {
          main: light.primary,
          light: light.primaryLight,
          dark: light.primaryDark,
          contrastText: brand.colors.white,
        },
        secondary: {
          main: light.secondary,
          light: light.secondaryLight,
          dark: light.secondaryDark,
          contrastText: brand.colors.white,
        },
        success: { main: light.success },
        info: { main: light.info },
        warning: { main: light.warning },
        error: { main: light.error },
        background: { default: light.background, paper: light.surface },
        text: { primary: light.text, secondary: light.textMuted },
        divider: light.divider,
      },
    },
    dark: {
      palette: {
        primary: {
          main: dark.primary,
          light: dark.primaryLight,
          dark: dark.primaryDark,
          contrastText: brand.colors.black,
        },
        secondary: {
          main: dark.secondary,
          light: dark.secondaryLight,
          dark: dark.secondaryDark,
          contrastText: brand.colors.black,
        },
        success: { main: dark.success },
        info: { main: dark.info },
        warning: { main: dark.warning },
        error: { main: dark.error },
        background: { default: dark.background, paper: dark.surface },
        text: { primary: dark.text, secondary: dark.textMuted },
        divider: dark.divider,
      },
    },
  },
  shape: { borderRadius: 10 },
  typography: {
    // La catena completa e' definita una volta sola in app/globals.css come
    // --font-app: ripeterla qui produrrebbe un font-family duplicato.
    fontFamily: "var(--font-app)",
    h1: { fontSize: "1.9rem", fontWeight: 700 },
    h2: { fontSize: "1.5rem", fontWeight: 700 },
    h3: { fontSize: "1.25rem", fontWeight: 600 },
    h4: { fontSize: "1.1rem", fontWeight: 600 },
    h5: { fontSize: "1rem", fontWeight: 600 },
    h6: { fontSize: "0.95rem", fontWeight: 600 },
    button: { textTransform: "none", fontWeight: 600 },
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: "none" },
      },
    },
    MuiCard: {
      // Il bordo non e' piu' fissato a un grigio: `divider` esiste in entrambe
      // le palette e cambia da solo insieme al tema.
      defaultProps: { variant: "outlined" },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
    },
    MuiTextField: {
      defaultProps: { size: "small" },
    },
    MuiSelect: {
      defaultProps: { size: "small" },
    },
    MuiTableCell: {
      styleOverrides: {
        head: { fontWeight: 700, whiteSpace: "nowrap" },
      },
    },
    MuiTooltip: {
      defaultProps: { arrow: true },
    },
  },
});

export default theme;
