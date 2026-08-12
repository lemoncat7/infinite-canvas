export const CANVAS_THEME = {
  light: {
    background: 0xf1f4f7,
    grid: 0x718399,
    link: 0x72869c,
    linkHighlight: 0x4f6f92,
    pendingLink: 0x5c7898,
    mediaEmpty: "#edf1f5",
    mediaPlaceholder: "#8796a6",
    mediaPlaceholderText: "#667789",
  },
  dark: {
    background: 0x0c131b,
    grid: 0x607b99,
    link: 0x789abd,
    linkHighlight: 0xa8c9ea,
    pendingLink: 0x86a9cf,
    mediaEmpty: "#121c26",
    mediaPlaceholder: "#6f8297",
    mediaPlaceholderText: "#a1afbe",
  },
} as const;

export function canvasTheme(dark: boolean) {
  return dark ? CANVAS_THEME.dark : CANVAS_THEME.light;
}
