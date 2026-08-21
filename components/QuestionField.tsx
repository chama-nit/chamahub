"use client";

// ---------------------------------------------------------------------------
// Rendering di una singola domanda (scala numerica o testo libero).
// ---------------------------------------------------------------------------
// Usato sia dalle schede di valutazione sia dai questionari di gradimento: la
// struttura delle domande e' identica nelle due tabelle.
// ---------------------------------------------------------------------------

import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import type { Question } from "@/lib/types/models";

interface QuestionFieldProps {
  question: Question;
  numericValue: number | null;
  textValue: string;
  onNumericChange: (value: number | null) => void;
  onTextChange: (value: string) => void;
  disabled?: boolean;
  /** Mostra un bordo rosso se obbligatoria e non compilata. */
  showValidation?: boolean;
}

/** Etichette agli estremi della scala, per dare un significato ai numeri. */
const SCALE_HINTS: Record<string, [string, string]> = {
  default: ["Per nulla", "Del tutto"],
};

export default function QuestionField({
  question,
  numericValue,
  textValue,
  onNumericChange,
  onTextChange,
  disabled,
  showValidation,
}: QuestionFieldProps) {
  const missing = showValidation && question.is_required &&
    (question.type === "scale"
      ? numericValue === null
      : textValue.trim().length === 0);

  const [lowHint, highHint] = SCALE_HINTS.default;

  const options = Array.from(
    { length: question.scale_max - question.scale_min + 1 },
    (_, index) => question.scale_min + index,
  );

  return (
    <Box
      sx={{
        p: 2,
        border: "1px solid",
        borderColor: missing ? "error.main" : "divider",
        borderRadius: 2,
        bgcolor: missing ? "rgba(198, 40, 40, 0.04)" : "transparent",
      }}
    >
      <Stack spacing={1.25}>
        <Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: "baseline" }}>
            <Typography sx={{ fontWeight: 600 }}>
              {question.position}. {question.label}
            </Typography>
            {question.is_required
              ? <Chip size="small" label="Obbligatoria" variant="outlined" />
              : <Chip size="small" label="Facoltativa" variant="outlined" />}
          </Stack>
          {question.help_text && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {question.help_text}
            </Typography>
          )}
        </Box>

        {question.type === "scale"
          ? (
            <Stack spacing={0.75}>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={numericValue}
                disabled={disabled}
                onChange={(_event, value) =>
                  onNumericChange(value === null ? null : Number(value))}
                sx={{ flexWrap: "wrap" }}
              >
                {options.map((option) => (
                  <ToggleButton
                    key={option}
                    value={option}
                    sx={{ minWidth: 46, fontWeight: 700 }}
                  >
                    {option}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
              <Stack
                direction="row"
                spacing={1}
                sx={{ justifyContent: "space-between", maxWidth: 320 }}
              >
                <Typography variant="caption" color="text.secondary">
                  {question.scale_min} = {lowHint}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {question.scale_max} = {highHint}
                </Typography>
              </Stack>
            </Stack>
          )
          : (
            <TextField
              multiline
              minRows={3}
              fullWidth
              placeholder="Scrivi qui la tua risposta…"
              value={textValue}
              disabled={disabled}
              onChange={(event) => onTextChange(event.target.value)}
              slotProps={{ htmlInput: { maxLength: 2000 } }}
            />
          )}
      </Stack>
    </Box>
  );
}
