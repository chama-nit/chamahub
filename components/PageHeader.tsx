"use client";

import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}

export default function PageHeader({
  title,
  description,
  actions,
}: PageHeaderProps) {
  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      spacing={2}
      sx={{
        mb: 3,
        alignItems: { xs: "stretch", sm: "flex-start" },
        justifyContent: "space-between",
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="h1" sx={{ mb: description ? 0.5 : 0 }}>
          {title}
        </Typography>
        {description && (
          // `component="div"`: la descrizione accetta contenuto libero e in
          // piu' pagine riceve Chip o Stack, che rendono <div>. Dentro il <p>
          // di un Typography sarebbe HTML non valido e React segnalerebbe un
          // errore di idratazione.
          <Typography
            component="div"
            color="text.secondary"
            sx={{ maxWidth: 760 }}
          >
            {description}
          </Typography>
        )}
      </Box>
      {actions && (
        <Stack
          direction="row"
          spacing={1}
          sx={{ flexShrink: 0 }}
          className="no-print"
        >
          {actions}
        </Stack>
      )}
    </Stack>
  );
}
