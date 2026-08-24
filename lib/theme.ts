"use client";

import { createTheme } from "@mui/material/styles";

// ---------------------------------------------------------------------------
// Tavolozza Chamanit
// ---------------------------------------------------------------------------
// I colori del company profile, presi come sono:
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

const BRAND = {
  black: "#0A0D16",
  blue: "#1B3B8C",
  violet: "#4A1B7A",
  magenta: "#C238C4",
  orange: "#E8865A",
  peach: "#F4B594",
  white: "#FFFFFF",
} as const;

export const theme = createTheme({
  cssVariables: { colorSchemeSelector: "data" },
  defaultColorScheme: "dark",
  colorSchemes: {
    light: {
      palette: {
        primary: {
          main: BRAND.blue,
          light: "#3A5FC0",
          dark: "#12275E",
          contrastText: BRAND.white,
        },
        secondary: {
          main: BRAND.violet,
          light: "#7B3FB5",
          dark: "#33125A",
          contrastText: BRAND.white,
        },
        success: { main: "#197A63" },
        info: { main: "#2F55B0" },
        warning: { main: "#B4551F" },
        error: { main: "#B3261E" },
        background: { default: "#F4F5FA", paper: BRAND.white },
        text: { primary: BRAND.black, secondary: "#59607A" },
        divider: "rgba(10, 13, 22, 0.12)",
      },
    },
    dark: {
      palette: {
        primary: {
          main: "#7C9BEA",
          light: "#A6BCF3",
          dark: "#4A6BC0",
          contrastText: BRAND.black,
        },
        secondary: {
          main: "#B98BE8",
          light: "#D2B4F2",
          dark: "#7B3FB5",
          contrastText: BRAND.black,
        },
        success: { main: "#58C39F" },
        info: { main: "#8FAAF0" },
        warning: { main: BRAND.orange },
        error: { main: "#F2857D" },
        background: { default: BRAND.black, paper: "#141A2B" },
        text: { primary: "#E9ECF5", secondary: "#A2AAC2" },
        divider: "rgba(255, 255, 255, 0.14)",
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
