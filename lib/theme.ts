"use client";

import { createTheme } from "@mui/material/styles";

// ---------------------------------------------------------------------------
// Tema dell'applicazione
// ---------------------------------------------------------------------------
// Palette sobria, ad alto contrasto, pensata per tabelle e moduli densi di
// informazione. I colori semantici (verde/azzurro/arancio) sono gli stessi
// usati dalle etichette del calendario in lib/labels.ts.
// ---------------------------------------------------------------------------

export const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#1f4e79", light: "#4a7aa7", dark: "#0e2f4d" },
    secondary: { main: "#00897b" },
    success: { main: "#2e7d32" },
    info: { main: "#0288d1" },
    warning: { main: "#ed6c02" },
    error: { main: "#c62828" },
    background: { default: "#f4f6f8", paper: "#ffffff" },
    text: { primary: "#1c2530", secondary: "#5a6672" },
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
      defaultProps: { variant: "outlined" },
      styleOverrides: {
        root: { borderColor: "rgba(0,0,0,0.10)" },
      },
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
