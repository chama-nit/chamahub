"use client";

import SvgIcon, { type SvgIconProps } from "@mui/material/SvgIcon";

/** Logo Microsoft a quattro quadranti. */
export default function MicrosoftIcon(props: SvgIconProps) {
  return (
    <SvgIcon viewBox="0 0 23 23" {...props}>
      <rect x="1" y="1" width="10" height="10" fill="#f25022" />
      <rect x="12" y="1" width="10" height="10" fill="#7fba00" />
      <rect x="1" y="12" width="10" height="10" fill="#00a4ef" />
      <rect x="12" y="12" width="10" height="10" fill="#ffb900" />
    </SvgIcon>
  );
}
