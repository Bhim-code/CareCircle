import type { TextStyle } from 'react-native';
import type { Role } from '../../domain/entities/Role';

/**
 * Design tokens. Built for people who may be older or reading in poor light:
 * 18px body text, high contrast, and 56px touch targets.
 *
 * Palette: harbour blue as the one strong colour, cool off-white surfaces,
 * and amber reserved for the caregiver role and for attention states.
 */
export const colors = {
  ink: '#14232B',
  inkSoft: '#4A6270',
  harbor: '#1F5F7A',
  harborPressed: '#17495E',
  mist: '#EEF4F6',
  paper: '#FFFFFF',
  line: '#C5D5DC',
  tint: '#DCEBF1',
  amber: '#8A4B00',
  amberTint: '#FFF1D6',
  danger: '#B3261E',
  dangerTint: '#FCE8E6',
  success: '#1E7B4F',
  successTint: '#E3F4EA',
  white: '#FFFFFF',
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 } as const;

/** Different corner radii for different jobs, not one radius everywhere. */
export const radius = { field: 10, button: 14, card: 20, pill: 999 } as const;

export const touchTarget = 56;

export type TextVariant = 'title' | 'heading' | 'body' | 'label' | 'caption';

export const typography: Record<TextVariant, TextStyle> = {
  title: { fontSize: 32, lineHeight: 38, fontWeight: '700', letterSpacing: -0.4 },
  heading: { fontSize: 22, lineHeight: 28, fontWeight: '600' },
  body: { fontSize: 18, lineHeight: 26, fontWeight: '400' },
  label: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  caption: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
};

export const roleAccent: Record<Role, { foreground: string; background: string }> = {
  patient: { foreground: colors.harbor, background: colors.tint },
  caregiver: { foreground: colors.amber, background: colors.amberTint },
};
