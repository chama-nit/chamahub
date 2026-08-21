"use client";

// ---------------------------------------------------------------------------
// Griglia mensile riutilizzabile
// ---------------------------------------------------------------------------
// Il componente si occupa solo della griglia (6 settimane, lunedi'-domenica) e
// della navigazione fra i mesi. Il contenuto di ogni casella e' delegato alla
// funzione `renderDay`, cosi' lo stesso calendario serve sia per la vista
// personale sia per quella di area o aziendale.
// ---------------------------------------------------------------------------

import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";

import {
  buildMonthGrid,
  isSameMonth,
  isWeekend,
  toDayString,
  WEEKDAY_INITIALS,
} from "@/lib/format";

interface MonthCalendarProps {
  month: Date;
  onMonthChange: (next: Date) => void;
  renderDay: (day: string, isCurrentMonth: boolean) => ReactNode;
  onDayClick?: (day: string) => void;
  /** Altezza minima di ogni casella: piu' alta per le viste di gruppo. */
  cellMinHeight?: number;
  toolbarExtra?: ReactNode;
}

const MONTH_FORMATTER = new Intl.DateTimeFormat("it-IT", {
  month: "long",
  year: "numeric",
});

export default function MonthCalendar({
  month,
  onMonthChange,
  renderDay,
  onDayClick,
  cellMinHeight = 96,
  toolbarExtra,
}: MonthCalendarProps) {
  const days = buildMonthGrid(month);
  const today = toDayString(new Date());

  const shift = (amount: number) =>
    onMonthChange(new Date(month.getFullYear(), month.getMonth() + amount, 1));

  return (
    <Box>
      {/* useFlexGap + flexWrap: quando la colonna si stringe (ad esempio con il
          dettaglio del giorno aperto a fianco) i filtri vanno a capo invece di
          uscire dal riquadro. */}
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        useFlexGap
        sx={{
          mb: 2,
          flexWrap: "wrap",
          alignItems: { xs: "stretch", sm: "center" },
          justifyContent: "space-between",
        }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <IconButton onClick={() => shift(-1)} aria-label="Mese precedente">
            <ChevronLeftIcon />
          </IconButton>
          <Typography variant="h3" sx={{ minWidth: 190, textTransform: "capitalize" }}>
            {MONTH_FORMATTER.format(month)}
          </Typography>
          <IconButton onClick={() => shift(1)} aria-label="Mese successivo">
            <ChevronRightIcon />
          </IconButton>
          <Button
            size="small"
            onClick={() => {
              const now = new Date();
              onMonthChange(new Date(now.getFullYear(), now.getMonth(), 1));
            }}
          >
            Oggi
          </Button>
        </Stack>
        {toolbarExtra}
      </Stack>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
          gap: "1px",
          bgcolor: "divider",
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        {WEEKDAY_INITIALS.map((label) => (
          <Box
            key={label}
            sx={{
              bgcolor: "background.paper",
              px: 1,
              py: 0.75,
              textAlign: "center",
            }}
          >
            <Typography variant="caption" sx={{ fontWeight: 700 }} color="text.secondary">
              {label}
            </Typography>
          </Box>
        ))}

        {days.map((date) => {
          const dayString = toDayString(date);
          const currentMonth = isSameMonth(date, month);
          const isToday = dayString === today;

          const content = (
            <>
              <Stack
                direction="row"
                spacing={0.5}
                sx={{ alignItems: "center", justifyContent: "space-between", mb: 0.5 }}
              >
                <Typography
                  variant="caption"
                  sx={{
                    fontWeight: isToday ? 800 : 600,
                    color: isToday
                      ? "primary.contrastText"
                      : currentMonth
                      ? "text.primary"
                      : "text.disabled",
                    bgcolor: isToday ? "primary.main" : "transparent",
                    borderRadius: "50%",
                    width: 22,
                    height: 22,
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  {date.getDate()}
                </Typography>
              </Stack>
              {renderDay(dayString, currentMonth)}
            </>
          );

          const cellSx = {
            minHeight: cellMinHeight,
            p: 0.75,
            textAlign: "left" as const,
            alignItems: "stretch",
            flexDirection: "column" as const,
            justifyContent: "flex-start",
            bgcolor: currentMonth
              ? isWeekend(date) ? "action.hover" : "background.paper"
              : "action.disabledBackground",
            opacity: currentMonth ? 1 : 0.55,
          };

          return onDayClick && currentMonth
            ? (
              <ButtonBase
                key={dayString}
                onClick={() => onDayClick(dayString)}
                sx={{
                  ...cellSx,
                  display: "flex",
                  width: "100%",
                  "&:hover": { bgcolor: "action.selected" },
                }}
              >
                <Box sx={{ width: "100%" }}>{content}</Box>
              </ButtonBase>
            )
            : (
              <Box key={dayString} sx={cellSx}>
                {content}
              </Box>
            );
        })}
      </Box>
    </Box>
  );
}
