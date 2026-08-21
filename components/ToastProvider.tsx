"use client";

// ---------------------------------------------------------------------------
// Notifiche brevi (successo / errore / informazione)
// ---------------------------------------------------------------------------
// Un unico Snackbar condiviso, esposto tramite l'hook `useToast`.
// ---------------------------------------------------------------------------

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Alert from "@mui/material/Alert";
import Snackbar from "@mui/material/Snackbar";
import { describeAuthError } from "@/lib/auth/errors";

type Severity = "success" | "error" | "info" | "warning";

interface ToastState {
  open: boolean;
  message: string;
  severity: Severity;
}

interface ToastContextValue {
  notify: (message: string, severity?: Severity) => void;
  success: (message: string) => void;
  error: (message: unknown) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ToastState>({
    open: false,
    message: "",
    severity: "info",
  });

  const notify = useCallback(
    (message: string, severity: Severity = "info") => {
      setState({ open: true, message, severity });
    },
    [],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      notify,
      success: (message: string) => notify(message, "success"),
      error: (err: unknown) => {
        // Gli errori tecnici di Supabase passano dal traduttore: quasi sempre
        // dietro c'e' una configurazione mancante, e dirlo fa risparmiare tempo.
        const { message, hint } = describeAuthError(err);
        notify(
          hint ? `${message} ${hint}` : message || "Si e' verificato un errore imprevisto.",
          "error",
        );
      },
    }),
    [notify],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Snackbar
        open={state.open}
        autoHideDuration={state.severity === "error" ? 14000 : 4000}
        onClose={() => setState((prev) => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          severity={state.severity}
          variant="filled"
          onClose={() => setState((prev) => ({ ...prev, open: false }))}
          sx={{ maxWidth: 620 }}
        >
          {state.message}
        </Alert>
      </Snackbar>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast deve essere usato dentro <ToastProvider>.");
  }
  return context;
}
