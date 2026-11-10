/** Tập trung bảng màu, phẩm chất, khoảng cách, chữ, ô nhập, chuyển động và trạng thái tương tác để các màn hình dùng chung một hệ giao diện PAT. */

import { Platform, type TextStyle, type ViewStyle } from "react-native";

// Apple Green + Aurora: bright action surfaces, legible garden-green ink.
// PAT remains intentionally light (app.json); the camera is a dark context.
// Keep all surfaces opaque beneath text, including the stops of our gradients.
export const COLORS = {
  background: "#FBFFF8",
  surface: "#FFFFFF",
  surfaceSoft: "#F1FAEA",
  surfaceAlt: "#E8F6DD",
  primary: "#2D6A20",
  primaryDark: "#234D1C",
  brandWordmark: "#3F7F22",
  secondary: "#77531E",
  accent: "#256843",
  text: "#233C25",
  textMuted: "#53644F",
  border: "#DEEAD7",
  controlBorder: "#738569",
  white: "#FFFFFF",
  onPrimary: "#FFFFFF",
  onPrimaryMuted: "#EBF5DF",
  // White remains for dark contexts; bright CTAs always use the onAction ink.
  actionSurface: "#8EDB3F",
  actionEnd: "#AFE957",
  onAction: "#173B19",
  onActionMuted: "#244321",
  danger: "#B03250",
  dangerSoft: "#FBE8EE",
  warning: "#77531E",
  success: "#2E6534",
  purple: "#6941A0",
  blue: "#285C9E",
  overlay: "rgba(22, 39, 20, 0.56)",
  sage: "#EDF9E0",
  sageDeep: "#C5EBA4",
  ochreSoft: "#FFF5D6",
  pressed: "#DEF3CD",
  disabled: "#E8EFE2",
  onDisabled: "#53624D",
  focus: "#25611C",
  focusInverse: "#D1F39E",
  leafTint: "#EBFAD9",
  waterTint: "#EAF8FC",
  sunTint: "#FFF9E6",
  auroraLeaf: "#DDF6BD",
  auroraSky: "#D8F2F4",
  epicTint: "#F0E9FA",
  leafBright: "#8EDB3F",
  sunshine: "#FFE79A",
  water: "#8ADDE7",
  soil: "#795539",
  skin: "#F4BC8D",
  skinShade: "#DD9567",
  hair: "#503B29",
  botanical: "#63AA32",
  transparent: "transparent",
  scannerBackground: "#142119",
  scannerSurface: "#243629",
  scannerMuted: "#CBDAC7",
  scannerOverlay: "rgba(14, 27, 17, 0.84)",
  scannerFrame: "#EFF9DF",
  imageScrim: "rgba(14, 27, 17, 0.86)",
  imageBadge: "#FFFFFF",
  rewardSilver: "#CBD5DF",
  rewardSilverTint: "#F2F5F8",
  rewardBackdrop: "rgba(12, 24, 20, 0.88)",
  legendaryInk: "#A32632",
  legendaryTint: "#FFE9E7",
  glowGreen: "#15803D",
  glowBlue: "#1D4ED8",
  glowPurple: "#7E22CE",
  glowGold: "#FACC15",
  glowRed: "#DC2626",
} as const;

export const SPACING = {
  xs: 4,
  sm: 8,
  compact: 12,
  md: 16,
  page: 20,
  lg: 24,
  xl: 32,
  xxl: 48,
  hero: 64,
} as const;

export const RADIUS = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  pill: 999,
} as const;

export const TYPE = {
  largeTitle: {
    fontSize: 32,
    lineHeight: 40,
    fontWeight: "700",
    color: COLORS.text,
  },
  title: {
    fontSize: 24,
    lineHeight: 32,
    fontWeight: "700",
    color: COLORS.text,
  },
  headline: {
    fontSize: 18,
    lineHeight: 26,
    fontWeight: "600",
    color: COLORS.text,
  },
  body: { fontSize: 16, lineHeight: 24, fontWeight: "400", color: COLORS.text },
  subhead: {
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "400",
    color: COLORS.textMuted,
  },
  caption: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "400",
    color: COLORS.textMuted,
  },
  label: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
    color: COLORS.text,
  },
  overline: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: COLORS.textMuted,
  },
} as const satisfies Record<string, TextStyle>;

export const LAYOUT = {
  touch: 48,
  control: 52,
  icon: 24,
  smallIcon: 20,
  badgeIcon: 16,
  largeIcon: 32,
  tabIcon: 22,
  scannerButton: 76,
  formMaxWidth: 480,
  contentMaxWidth: 720,
  thumbnail: 64,
  artwork: 120,
  authLogo: 176,
} as const;

// TextInput uses native font metrics, not a paragraph line box. An explicit
// lineHeight shifts iOS text/placeholder baselines; Android font padding adds
// another offset. Keep symmetric padding and let accessibility text grow.
const inputText = { ...TYPE.body, lineHeight: undefined, includeFontPadding: false } as const;
export const INPUT = {
  singleLine: { ...inputText, minHeight: LAYOUT.control, paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.compact, textAlignVertical: "center" },
  multiline: { ...inputText, minHeight: LAYOUT.touch * 2, paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.compact, textAlignVertical: "top" },
  compact: { ...inputText, minHeight: LAYOUT.touch, paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm, textAlign: "center", textAlignVertical: "center" },
} as const satisfies Record<string, TextStyle>;

export const MOTION = {
  fast: 150,
  base: 250,
  slow: 400,
  idle: 2200,
  blinkPause: 3600,
  cardArrival: 850,
  cardCharge: 720,
  rewardPulse: 1800,
} as const;

// Outset boxShadow requires Android 9+. Older phones retain surface contrast
// without a shadow; never rely on elevation to communicate content hierarchy.
const supportsBoxShadow =
  Platform.OS !== "android" || Number(Platform.Version) >= 28;
export const SHADOWS = {
  card: supportsBoxShadow
    ? { boxShadow: "0 3px 12px rgba(35, 77, 28, 0.07)" }
    : {},
  floating: supportsBoxShadow
    ? { boxShadow: "0 6px 20px rgba(35, 77, 28, 0.12)" }
    : {},
} as const satisfies Record<string, ViewStyle>;

// Static gradients avoid a decorative render loop and respect reduced motion.
// backgroundImage is available in the installed RN 0.88; no extra view/library.
export const GRADIENTS = {
  ambient: {
    backgroundImage: `linear-gradient(155deg, ${COLORS.leafTint} 0%, ${COLORS.background} 30%, ${COLORS.background} 100%)`,
  },
  garden: {
    backgroundImage: `radial-gradient(ellipse at 15% 25%, ${COLORS.auroraLeaf} 0%, ${COLORS.transparent} 70%), radial-gradient(ellipse at 95% 10%, ${COLORS.auroraSky} 0%, ${COLORS.transparent} 60%), linear-gradient(135deg, ${COLORS.surface} 0%, ${COLORS.sunTint} 100%)`,
  },
  action: {
    backgroundImage: `linear-gradient(115deg, ${COLORS.actionSurface} 0%, ${COLORS.actionEnd} 100%)`,
  },
  actionStops: [COLORS.actionSurface, COLORS.actionEnd],
} as const;

export const INTERACTION = {
  pressedOpacity: 0.96,
  primaryPressedOpacity: 0.88,
  disabledOpacity: 0.5,
  insetFocusOffset: -2,
  focus: { outlineColor: COLORS.focus, outlineWidth: 2, outlineOffset: 2 },
  focusInverse: {
    outlineColor: COLORS.focusInverse,
    outlineWidth: 2,
    outlineOffset: 2,
  },
} as const;

// Rarity has one palette for inventory and the reveal card; text is AA on tints.
export const RARITY = {
  Common: { color: "#166534", background: "#E5F8ED", accent: COLORS.glowGreen, glow: COLORS.glowGreen },
  Uncommon: { color: "#1E40AF", background: "#E5EDFF", accent: COLORS.glowBlue, glow: COLORS.glowBlue },
  Rare: { color: "#6B21A8", background: "#F3E6FF", accent: COLORS.glowPurple, glow: COLORS.glowPurple },
  // Bright yellow is the visual identity, dark gold is readable label ink.
  Epic: { color: "#854D0E", background: "#FFF4A3", accent: COLORS.glowGold, glow: COLORS.glowGold },
  Legendary: { color: "#B91C1C", background: "#FFE5E5", accent: COLORS.glowRed, glow: COLORS.glowRed },
} as const;

export const theme = {
  colors: COLORS,
  spacing: SPACING,
  radius: RADIUS,
  shadows: SHADOWS,
  type: TYPE,
  input: INPUT,
  layout: LAYOUT,
  motion: MOTION,
  gradients: GRADIENTS,
  interaction: INTERACTION,
  rarity: RARITY,
} as const;
