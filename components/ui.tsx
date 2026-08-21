"use client";

// ---------------------------------------------------------------------------
// Piccoli componenti di presentazione riutilizzati in tutta l'applicazione.
// ---------------------------------------------------------------------------

import type { ReactNode } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

// ---------------------------------------------------------------------------
// Griglia responsiva basata su CSS Grid.
// ---------------------------------------------------------------------------
// Sostituisce il componente Grid di MUI: meno vincoli, nessuna dipendenza dalle
// API che cambiano fra le versioni maggiori della libreria.
export function AutoGrid({
  children,
  min = 260,
  gap = 2,
}: {
  children: ReactNode;
  /** Larghezza minima di ogni colonna, in pixel. */
  min?: number;
  gap?: number;
}) {
  return (
    <Box
      sx={{
        display: "grid",
        gap,
        gridTemplateColumns: {
          xs: "1fr",
          sm: `repeat(auto-fill, minmax(${min}px, 1fr))`,
        },
      }}
    >
      {children}
    </Box>
  );
}

// ---------------------------------------------------------------------------
export function SectionCard({
  title,
  subtitle,
  actions,
  children,
  dense,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  dense?: boolean;
}) {
  return (
    <Card>
      {(title || actions) && (
        <>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            sx={{
              px: 2.5,
              py: 2,
              alignItems: { xs: "stretch", sm: "center" },
              justifyContent: "space-between",
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              {/* Titolo e sottotitolo accettano contenuto libero: si rendono
                  come <div> per poter ospitare anche elementi di blocco. */}
              {title && (
                <Typography variant="h3" component="div">
                  {title}
                </Typography>
              )}
              {subtitle && (
                <Typography variant="body2" component="div" color="text.secondary">
                  {subtitle}
                </Typography>
              )}
            </Box>
            {actions && (
              <Stack
                direction="row"
                spacing={1}
                sx={{ flexShrink: 0, alignItems: "center" }}
              >
                {actions}
              </Stack>
            )}
          </Stack>
          <Divider />
        </>
      )}
      <CardContent sx={{ p: dense ? 0 : 2.5, "&:last-child": { pb: dense ? 0 : 2.5 } }}>
        {children}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
export function StatCard({
  label,
  value,
  hint,
  icon,
  color = "primary.main",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  color?: string;
}) {
  return (
    <Card>
      <CardContent>
        <Stack
          direction="row"
          spacing={2}
          sx={{ alignItems: "flex-start", justifyContent: "space-between" }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="overline" color="text.secondary">
              {label}
            </Typography>
            <Typography
              component="div"
              sx={{ fontSize: "2rem", fontWeight: 700, lineHeight: 1.15 }}
            >
              {value}
            </Typography>
            {hint && (
              <Typography
                variant="body2"
                component="div"
                color="text.secondary"
                sx={{ mt: 0.5 }}
              >
                {hint}
              </Typography>
            )}
          </Box>
          {icon && (
            <Box
              sx={{
                display: "grid",
                placeItems: "center",
                width: 44,
                height: 44,
                borderRadius: 2,
                color,
                bgcolor: "action.hover",
                flexShrink: 0,
              }}
            >
              {icon}
            </Box>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <Stack
      spacing={1.5}
      sx={{ alignItems: "center", textAlign: "center", py: 6, px: 3 }}
    >
      {icon && <Box sx={{ color: "text.disabled", fontSize: 46 }}>{icon}</Box>}
      <Typography variant="h4" color="text.secondary">
        {title}
      </Typography>
      {description && (
        <Typography
          variant="body2"
          component="div"
          color="text.secondary"
          sx={{ maxWidth: 460 }}
        >
          {description}
        </Typography>
      )}
      {action}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
export function LoadingBlock({ rows = 3 }: { rows?: number }) {
  return (
    <Stack spacing={1} sx={{ p: 2 }}>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} variant="rounded" height={index === 0 ? 32 : 24} />
      ))}
    </Stack>
  );
}

export function InlineSpinner() {
  return (
    <Box sx={{ display: "grid", placeItems: "center", py: 6 }}>
      <CircularProgress />
    </Box>
  );
}

export function ErrorBlock({ message }: { message: string }) {
  return (
    <Alert severity="error" sx={{ m: 2 }}>
      {message}
    </Alert>
  );
}

/**
 * Rende in un colpo solo gli stati di `useAsync`: prima il caricamento, poi
 * l'eventuale errore, infine il contenuto.
 */
export function AsyncBlock({
  loading,
  error,
  children,
}: {
  loading: boolean;
  error: string | null;
  children: ReactNode;
}) {
  if (loading) return <InlineSpinner />;
  if (error) return <ErrorBlock message={error} />;
  return <>{children}</>;
}
