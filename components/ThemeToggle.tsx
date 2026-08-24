"use client";

// ---------------------------------------------------------------------------
// Commutatore tema chiaro / scuro
// ---------------------------------------------------------------------------
// Tre stati, non due: chiaro, scuro e "come il sistema". Quest'ultimo e' utile
// a chi ha il computer che passa da solo al tema scuro la sera.
//
// `useColorScheme` legge la preferenza da localStorage, che sul server non
// esiste: fino a quando il componente non e' montato nel browser il valore e'
// indefinito. Si disegna quindi un segnaposto delle stesse dimensioni, cosi'
// la barra non sussulta quando il pulsante vero prende il suo posto.
// ---------------------------------------------------------------------------

import { useCallback, useState, useSyncExternalStore } from "react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Tooltip from "@mui/material/Tooltip";
import { useColorScheme } from "@mui/material/styles";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import LightModeIcon from "@mui/icons-material/LightMode";
import SettingsBrightnessIcon from "@mui/icons-material/SettingsBrightness";

type Mode = "light" | "dark" | "system";

const OPTIONS: { value: Mode; label: string; icon: React.ReactNode }[] = [
  { value: "light", label: "Chiaro", icon: <LightModeIcon fontSize="small" /> },
  { value: "dark", label: "Scuro", icon: <DarkModeIcon fontSize="small" /> },
  {
    value: "system",
    label: "Come il sistema",
    icon: <SettingsBrightnessIcon fontSize="small" />,
  },
];

/**
 * Vero solo nel browser, a idratazione avvenuta. Si passa da
 * `useSyncExternalStore` invece che da uno stato aggiornato in un effetto:
 * quest'ultimo provocherebbe un secondo render immediato, che il compilatore
 * di React segnala giustamente come spreco.
 */
function useHydrated(): boolean {
  return useSyncExternalStore(
    useCallback(() => () => {}, []),
    () => true,
    () => false,
  );
}

export default function ThemeToggle() {
  const { mode, setMode } = useColorScheme();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const hydrated = useHydrated();

  if (!hydrated || !mode) {
    return <Box sx={{ width: 40, height: 40 }} aria-hidden />;
  }

  const current = OPTIONS.find((option) => option.value === mode) ?? OPTIONS[1];

  return (
    <>
      <Tooltip title={`Tema: ${current.label.toLowerCase()}`}>
        <IconButton
          onClick={(event) => setAnchorEl(event.currentTarget)}
          aria-label="Cambia il tema dell'applicazione"
        >
          {current.icon}
        </IconButton>
      </Tooltip>

      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        {OPTIONS.map((option) => (
          <MenuItem
            key={option.value}
            selected={option.value === mode}
            onClick={() => {
              setMode(option.value);
              setAnchorEl(null);
            }}
          >
            <ListItemIcon>{option.icon}</ListItemIcon>
            <ListItemText primary={option.label} />
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
