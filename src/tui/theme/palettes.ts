export type TuiPalette = {
  text: string;
  dim: string;
  accent: string;
  accentSoft: string;
  border: string;
  userBg: string;
  userText: string;
  systemText: string;
  toolPendingBg: string;
  toolSuccessBg: string;
  toolErrorBg: string;
  toolTitle: string;
  toolOutput: string;
  quote: string;
  quoteBorder: string;
  code: string;
  codeBlock: string;
  codeBorder: string;
  link: string;
  error: string;
  success: string;
  diffAdded: string;
  diffRemoved: string;
  diffHunk: string;
  diffContext: string;
  /** Reasoning blocks (shown dimmed and italic above the answer). */
  reasoning: string;
  banner: string;
  bannerBg: string;
};

export const TUI_THEME_NAMES = [
  "dark",
  "light",
  "high-contrast",
  "dusk",
  "forest",
  "ocean",
  "paper",
  "mono",
] as const;
export type TuiThemeName = (typeof TUI_THEME_NAMES)[number];

const dark: TuiPalette = {
  text: "#E8E3D5",
  dim: "#7B7F87",
  accent: "#F6C453",
  accentSoft: "#F2A65A",
  border: "#3C414B",
  userBg: "#2B2F36",
  userText: "#F3EEE0",
  systemText: "#9BA3B2",
  toolPendingBg: "#1F2A2F",
  toolSuccessBg: "#1E2D23",
  toolErrorBg: "#2F1F1F",
  toolTitle: "#F6C453",
  toolOutput: "#E1DACB",
  quote: "#8CC8FF",
  quoteBorder: "#3B4D6B",
  code: "#F0C987",
  codeBlock: "#1E232A",
  codeBorder: "#343A45",
  link: "#7DD3A5",
  error: "#F97066",
  success: "#7DD3A5",
  diffAdded: "#7DD3A5",
  diffRemoved: "#F97066",
  diffHunk: "#8CC8FF",
  diffContext: "#9BA3B2",
  reasoning: "#9A93B8",
  banner: "#1B1B1B",
  bannerBg: "#F6C453",
};

const light: TuiPalette = {
  text: "#1F2328",
  dim: "#6B7280",
  accent: "#9A5B00",
  accentSoft: "#B45309",
  border: "#C9CED6",
  userBg: "#E8ECF2",
  userText: "#111827",
  systemText: "#4B5563",
  toolPendingBg: "#EEF2F5",
  toolSuccessBg: "#E6F4EA",
  toolErrorBg: "#FBE9E7",
  toolTitle: "#9A5B00",
  toolOutput: "#1F2328",
  quote: "#1D4ED8",
  quoteBorder: "#93C5FD",
  code: "#7C2D12",
  codeBlock: "#F3F4F6",
  codeBorder: "#D1D5DB",
  link: "#047857",
  error: "#B91C1C",
  success: "#047857",
  diffAdded: "#047857",
  diffRemoved: "#B91C1C",
  diffHunk: "#1D4ED8",
  diffContext: "#6B7280",
  reasoning: "#6E6790",
  banner: "#FFFFFF",
  bannerBg: "#9A5B00",
};

const highContrast: TuiPalette = {
  text: "#FFFFFF",
  dim: "#C0C0C0",
  accent: "#FFFF00",
  accentSoft: "#FFD700",
  border: "#FFFFFF",
  userBg: "#000080",
  userText: "#FFFFFF",
  systemText: "#E0E0E0",
  toolPendingBg: "#000000",
  toolSuccessBg: "#003300",
  toolErrorBg: "#330000",
  toolTitle: "#FFFF00",
  toolOutput: "#FFFFFF",
  quote: "#00FFFF",
  quoteBorder: "#00FFFF",
  code: "#FFD700",
  codeBlock: "#000000",
  codeBorder: "#FFFFFF",
  link: "#00FF00",
  error: "#FF4040",
  success: "#00FF00",
  diffAdded: "#00FF00",
  diffRemoved: "#FF4040",
  diffHunk: "#00FFFF",
  diffContext: "#C0C0C0",
  reasoning: "#D0D0D0",
  banner: "#000000",
  bannerBg: "#FFFF00",
};

// Five more built-ins. Names describe the look, never a product or a person.
const dusk: TuiPalette = {
  text: "#E6E1F0",
  dim: "#8A8399",
  accent: "#C9A7FF",
  accentSoft: "#F2A6C8",
  border: "#463D5C",
  userBg: "#2E2740",
  userText: "#F4F0FA",
  systemText: "#A99FC0",
  toolPendingBg: "#262033",
  toolSuccessBg: "#213128",
  toolErrorBg: "#3A2230",
  toolTitle: "#C9A7FF",
  toolOutput: "#DED8EA",
  quote: "#9DC4FF",
  quoteBorder: "#4A5A80",
  code: "#F5C784",
  codeBlock: "#221C30",
  codeBorder: "#3E3652",
  link: "#8FE3C0",
  error: "#FF7B8A",
  success: "#8FE3C0",
  diffAdded: "#8FE3C0",
  diffRemoved: "#FF7B8A",
  diffHunk: "#9DC4FF",
  diffContext: "#A99FC0",
  reasoning: "#B3A6D4",
  banner: "#1A1424",
  bannerBg: "#C9A7FF",
};

const forest: TuiPalette = {
  text: "#E3EADF",
  dim: "#7F8C7A",
  accent: "#9CD67A",
  accentSoft: "#D9C56A",
  border: "#3A4A36",
  userBg: "#263122",
  userText: "#F1F6EC",
  systemText: "#A3B39C",
  toolPendingBg: "#1E2A1C",
  toolSuccessBg: "#1F3322",
  toolErrorBg: "#33221F",
  toolTitle: "#9CD67A",
  toolOutput: "#D9E2D3",
  quote: "#8BC9D8",
  quoteBorder: "#3B5C63",
  code: "#E9C987",
  codeBlock: "#1B241A",
  codeBorder: "#334030",
  link: "#8BC9D8",
  error: "#F08A7A",
  success: "#9CD67A",
  diffAdded: "#9CD67A",
  diffRemoved: "#F08A7A",
  diffHunk: "#8BC9D8",
  diffContext: "#A3B39C",
  reasoning: "#A8B8A0",
  banner: "#15200F",
  bannerBg: "#9CD67A",
};

const ocean: TuiPalette = {
  text: "#DCE8F2",
  dim: "#7A8C9C",
  accent: "#6CC8F0",
  accentSoft: "#F0B86C",
  border: "#2F4658",
  userBg: "#1F3140",
  userText: "#EEF5FA",
  systemText: "#9BB1C2",
  toolPendingBg: "#182734",
  toolSuccessBg: "#17302C",
  toolErrorBg: "#33222A",
  toolTitle: "#6CC8F0",
  toolOutput: "#D2DFE9",
  quote: "#A4B8FF",
  quoteBorder: "#3E4F86",
  code: "#F0D08A",
  codeBlock: "#142130",
  codeBorder: "#2A3D4E",
  link: "#7EE0C0",
  error: "#FF8484",
  success: "#7EE0C0",
  diffAdded: "#7EE0C0",
  diffRemoved: "#FF8484",
  diffHunk: "#A4B8FF",
  diffContext: "#9BB1C2",
  reasoning: "#9DB3C9",
  banner: "#0E1C28",
  bannerBg: "#6CC8F0",
};

const paper: TuiPalette = {
  text: "#3B3127",
  dim: "#8A7D6E",
  accent: "#8A4B12",
  accentSoft: "#A3561E",
  border: "#D8CBB8",
  userBg: "#EFE6D6",
  userText: "#2E261E",
  systemText: "#6B5F52",
  toolPendingBg: "#F3ECE0",
  toolSuccessBg: "#E7EFDD",
  toolErrorBg: "#F6E3DD",
  toolTitle: "#8A4B12",
  toolOutput: "#3B3127",
  quote: "#2E5C8A",
  quoteBorder: "#A9C0D6",
  code: "#7A3B1C",
  codeBlock: "#F5EFE4",
  codeBorder: "#D8CBB8",
  link: "#2E6B4F",
  error: "#A62E2E",
  success: "#2E6B4F",
  diffAdded: "#2E6B4F",
  diffRemoved: "#A62E2E",
  diffHunk: "#2E5C8A",
  diffContext: "#8A7D6E",
  reasoning: "#7A6E62",
  banner: "#FBF6EE",
  bannerBg: "#8A4B12",
};

const mono: TuiPalette = {
  text: "#E6E6E6",
  dim: "#8C8C8C",
  accent: "#FFFFFF",
  accentSoft: "#D0D0D0",
  border: "#4A4A4A",
  userBg: "#2C2C2C",
  userText: "#F5F5F5",
  systemText: "#B0B0B0",
  toolPendingBg: "#242424",
  toolSuccessBg: "#2A2A2A",
  toolErrorBg: "#3A2E2E",
  toolTitle: "#FFFFFF",
  toolOutput: "#DADADA",
  quote: "#C8C8C8",
  quoteBorder: "#5A5A5A",
  code: "#EDEDED",
  codeBlock: "#1F1F1F",
  codeBorder: "#444444",
  link: "#DDDDDD",
  error: "#FF9A9A",
  success: "#B8E0B8",
  diffAdded: "#B8E0B8",
  diffRemoved: "#FF9A9A",
  diffHunk: "#C8C8C8",
  diffContext: "#B0B0B0",
  reasoning: "#A0A0A0",
  banner: "#111111",
  bannerBg: "#FFFFFF",
};

export const TUI_PALETTES: Record<TuiThemeName, TuiPalette> = {
  dark,
  light,
  "high-contrast": highContrast,
  dusk,
  forest,
  ocean,
  paper,
  mono,
};

/** Every colour token a theme file may set, in display order. */
export const TUI_PALETTE_KEYS = Object.keys(dark) as Array<keyof TuiPalette>;

export function isTuiThemeName(value: unknown): value is TuiThemeName {
  return typeof value === "string" && (TUI_THEME_NAMES as readonly string[]).includes(value);
}
