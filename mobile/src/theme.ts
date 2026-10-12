export const COLORS = {
  background: '#F6F7F2',
  surface: '#FFFFFF',
  surfaceSoft: '#EEF5EA',
  surfaceAlt: '#EEF5EA',
  primary: '#2F7D4A',
  primaryDark: '#195D34',
  secondary: '#E7B755',
  accent: '#F08A5D',
  text: '#1D2A22',
  textMuted: '#68746D',
  border: '#DDE5DC',
  white: '#FFFFFF',
  danger: '#C94C4C',
  warning: '#D98A24',
  success: '#3F8F57',
  purple: '#7656A8',
  blue: '#4A7FB5',
  overlay: 'rgba(21, 35, 27, 0.46)',
} as const;

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const RADIUS = {
  sm: 8,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

export const SHADOWS = {
  card: {
    shadowColor: '#183523',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  floating: {
    shadowColor: '#183523',
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.16,
    shadowRadius: 16,
    elevation: 8,
  },
} as const;

export const theme = {
  colors: COLORS,
  spacing: SPACING,
  radius: RADIUS,
  shadows: SHADOWS,
} as const;
