"use client";

// ---------------------------------------------------------------------------
// Struttura dell'area autenticata: barra superiore, menu laterale, contenuto.
// ---------------------------------------------------------------------------
// Le voci di menu sono filtrate in base al ruolo. E' una comodita' di
// navigazione, non un meccanismo di sicurezza: la vera protezione sta nelle
// policy RLS del database, che restituiscono zero righe a chi non ha diritto
// di vederle anche se raggiungesse l'indirizzo a mano.
// ---------------------------------------------------------------------------

import { useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import NextLink from "next/link";
import AppBar from "@mui/material/AppBar";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import ListSubheader from "@mui/material/ListSubheader";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Toolbar from "@mui/material/Toolbar";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";

import AssignmentIcon from "@mui/icons-material/Assignment";
import BusinessIcon from "@mui/icons-material/Business";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import DescriptionIcon from "@mui/icons-material/Description";
import FactCheckIcon from "@mui/icons-material/FactCheck";
import EventNoteIcon from "@mui/icons-material/EventNote";
import GroupsIcon from "@mui/icons-material/Groups";
import InsightsIcon from "@mui/icons-material/Insights";
import LogoutIcon from "@mui/icons-material/Logout";
import MenuIcon from "@mui/icons-material/Menu";
import PeopleIcon from "@mui/icons-material/People";
import PersonIcon from "@mui/icons-material/Person";
import PollIcon from "@mui/icons-material/Poll";
import QuestionAnswerIcon from "@mui/icons-material/QuestionAnswer";
import SpaceDashboardIcon from "@mui/icons-material/SpaceDashboard";
import SentimentSatisfiedAltIcon from "@mui/icons-material/SentimentSatisfiedAlt";
import ShieldIcon from "@mui/icons-material/Shield";

import ImpersonationBanner from "@/components/ImpersonationBanner";
import ThemeToggle from "@/components/ThemeToggle";
import { useAuth } from "@/lib/auth/AuthProvider";
import { ROLE_LABELS } from "@/lib/labels";
import { initials } from "@/lib/format";
import type { UserRole } from "@/lib/types/models";

const DRAWER_WIDTH = 264;

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  roles: UserRole[];
}

interface NavSection {
  title?: string;
  items: NavItem[];
}

const ALL: UserRole[] = ["employee", "manager", "hr", "sysadmin"];

const SECTIONS: NavSection[] = [
  {
    items: [
      {
        href: "/dashboard",
        label: "Dashboard",
        icon: <SpaceDashboardIcon />,
        roles: ALL,
      },
      {
        href: "/calendario",
        label: "Il mio calendario",
        icon: <CalendarMonthIcon />,
        roles: ALL,
      },
      {
        href: "/richieste",
        label: "Richieste",
        icon: <QuestionAnswerIcon />,
        roles: ALL,
      },
      {
        href: "/valutazioni",
        label: "Valutazioni",
        icon: <AssignmentIcon />,
        roles: ALL,
      },
      {
        href: "/gradimento",
        label: "Gradimento",
        icon: <SentimentSatisfiedAltIcon />,
        roles: ["employee", "manager", "sysadmin"],
      },
    ],
  },
  {
    title: "La mia area",
    items: [
      {
        href: "/area",
        label: "Team e calendario",
        icon: <GroupsIcon />,
        roles: ["manager", "sysadmin"],
      },
    ],
  },
  {
    title: "Amministrazione HR",
    items: [
      {
        href: "/hr/dipendenti",
        label: "Dipendenti",
        icon: <PeopleIcon />,
        roles: ["hr", "sysadmin"],
      },
      {
        href: "/hr/aree",
        label: "Aree",
        icon: <BusinessIcon />,
        roles: ["hr", "sysadmin"],
      },
      {
        href: "/hr/calendario",
        label: "Calendario aziendale",
        icon: <EventNoteIcon />,
        roles: ["hr", "sysadmin"],
      },
      {
        href: "/hr/modelli",
        label: "Modelli di scheda",
        icon: <DescriptionIcon />,
        roles: ["hr", "sysadmin"],
      },
      {
        href: "/hr/campagne",
        label: "Campagne",
        icon: <PollIcon />,
        roles: ["hr", "sysadmin"],
      },
      {
        href: "/hr/valutazioni",
        label: "Tutte le valutazioni",
        icon: <FactCheckIcon />,
        roles: ["hr", "sysadmin"],
      },
      {
        href: "/hr/questionari",
        label: "Questionari gradimento",
        icon: <SentimentSatisfiedAltIcon />,
        roles: ["hr", "sysadmin"],
      },
      {
        href: "/hr/kpi",
        label: "Dashboard KPI",
        icon: <InsightsIcon />,
        roles: ["hr", "sysadmin"],
      },
    ],
  },
  {
    title: "Sistema",
    items: [
      {
        href: "/sistema",
        label: "Pannello di sistema",
        icon: <ShieldIcon />,
        roles: ["sysadmin"],
      },
    ],
  },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const isDesktop = useMediaQuery(theme.breakpoints.up("lg"));
  const { profile, signOut } = useAuth();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  const role = profile?.role ?? "employee";

  const sections = useMemo(
    () =>
      SECTIONS.map((section) => ({
        ...section,
        items: section.items.filter((item) => item.roles.includes(role)),
      })).filter((section) => section.items.length > 0),
    [role],
  );

  const activeHref = useMemo(() => {
    const candidates = sections
      .flatMap((section) => section.items.map((item) => item.href))
      .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
      .sort((a, b) => b.length - a.length);
    return candidates[0] ?? null;
  }, [sections, pathname]);

  const drawerContent = (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Toolbar sx={{ px: 2.5 }}>
        <Stack spacing={0}>
          <Typography variant="h4" sx={{ color: "primary.main", lineHeight: 1.2 }}>
            ChamaHub
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Gestione del personale
          </Typography>
        </Stack>
      </Toolbar>
      <Divider />

      <Box sx={{ flex: 1, overflowY: "auto", py: 1 }}>
        {sections.map((section, index) => (
          <List
            key={section.title ?? `section-${index}`}
            dense
            subheader={
              section.title
                ? (
                  <ListSubheader
                    disableSticky
                    sx={{
                      bgcolor: "transparent",
                      fontSize: "0.7rem",
                      letterSpacing: 0.8,
                      textTransform: "uppercase",
                      color: "text.secondary",
                    }}
                  >
                    {section.title}
                  </ListSubheader>
                )
                : undefined
            }
          >
            {section.items.map((item) => (
              <ListItemButton
                key={item.href}
                component={NextLink}
                href={item.href}
                selected={activeHref === item.href}
                onClick={() => setMobileOpen(false)}
                sx={{
                  mx: 1.5,
                  borderRadius: 2,
                  "&.Mui-selected": {
                    bgcolor: "primary.main",
                    color: "primary.contrastText",
                    "& .MuiListItemIcon-root": { color: "inherit" },
                    "&:hover": { bgcolor: "primary.dark" },
                  },
                }}
              >
                <ListItemIcon sx={{ minWidth: 38 }}>{item.icon}</ListItemIcon>
                <ListItemText
                  primary={item.label}
                  slotProps={{ primary: { sx: { fontSize: "0.9rem" } } }}
                />
              </ListItemButton>
            ))}
          </List>
        ))}
      </Box>

      <Divider />
      <Box sx={{ p: 2 }}>
        <Typography variant="caption" color="text.secondary">
          {profile?.areas?.name
            ? `Area: ${profile.areas.name}`
            : "Nessuna area assegnata"}
        </Typography>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      <AppBar
        position="fixed"
        elevation={0}
        color="inherit"
        sx={{
          width: { lg: `calc(100% - ${DRAWER_WIDTH}px)` },
          ml: { lg: `${DRAWER_WIDTH}px` },
          borderBottom: "1px solid",
          borderColor: "divider",
          bgcolor: "background.paper",
        }}
      >
        <Toolbar>
          <IconButton
            edge="start"
            onClick={() => setMobileOpen(true)}
            sx={{ mr: 2, display: { lg: "none" } }}
            aria-label="Apri il menu"
          >
            <MenuIcon />
          </IconButton>

          <Box sx={{ flex: 1 }} />

          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
            <ThemeToggle />
            <Chip
              size="small"
              label={ROLE_LABELS[role]}
              color={role === "sysadmin"
                ? "error"
                : role === "hr"
                ? "primary"
                : role === "manager"
                ? "secondary"
                : "default"}
              variant={role === "employee" ? "outlined" : "filled"}
            />
            <Tooltip title="Account">
              <IconButton onClick={(e) => setAnchorEl(e.currentTarget)}>
                <Avatar
                  sx={{ width: 34, height: 34, bgcolor: "primary.main", fontSize: 14 }}
                >
                  {initials(profile?.full_name ?? "")}
                </Avatar>
              </IconButton>
            </Tooltip>
          </Stack>

          <Menu
            anchorEl={anchorEl}
            open={Boolean(anchorEl)}
            onClose={() => setAnchorEl(null)}
            anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            transformOrigin={{ vertical: "top", horizontal: "right" }}
          >
            <Box sx={{ px: 2, py: 1 }}>
              <Typography variant="subtitle2">{profile?.full_name}</Typography>
              <Typography variant="caption" color="text.secondary">
                {profile?.email}
              </Typography>
            </Box>
            <Divider />
            <MenuItem
              onClick={() => {
                setAnchorEl(null);
                router.push("/profilo");
              }}
            >
              <ListItemIcon>
                <PersonIcon fontSize="small" />
              </ListItemIcon>
              Il mio profilo
            </MenuItem>
            <MenuItem
              onClick={() => {
                setAnchorEl(null);
                void signOut();
              }}
            >
              <ListItemIcon>
                <LogoutIcon fontSize="small" />
              </ListItemIcon>
              Esci
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      <Box component="nav" sx={{ width: { lg: DRAWER_WIDTH }, flexShrink: { lg: 0 } }}>
        <Drawer
          variant={isDesktop ? "permanent" : "temporary"}
          open={isDesktop || mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            "& .MuiDrawer-paper": {
              width: DRAWER_WIDTH,
              boxSizing: "border-box",
              borderRight: "1px solid",
              borderColor: "divider",
            },
          }}
        >
          {drawerContent}
        </Drawer>
      </Box>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          width: { lg: `calc(100% - ${DRAWER_WIDTH}px)` },
          minWidth: 0,
        }}
      >
        <Toolbar />
        <ImpersonationBanner />
        <Box sx={{ p: { xs: 2, md: 3 } }}>{children}</Box>
      </Box>
    </Box>
  );
}
