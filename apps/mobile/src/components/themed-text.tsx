import { StyleSheet, Text, type TextProps } from 'react-native';

import { Fonts, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?: 'default' | 'title' | 'small' | 'smallBold' | 'subtitle' | 'link' | 'linkPrimary' | 'code';
  themeColor?: ThemeColor;
};

export function ThemedText({ style, type = 'default', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();

  return <Text style={[{ color: theme[themeColor ?? 'text'] }, styles[type], style]} {...rest} />;
}

// Weight comes from the font family, not fontWeight: Android does not
// synthesise weights for custom fonts, so each weight is its own family.
const styles = StyleSheet.create({
  small: {
    fontFamily: Fonts.medium,
    fontSize: 14,
    lineHeight: 20,
  },
  smallBold: {
    fontFamily: Fonts.bold,
    fontSize: 14,
    lineHeight: 20,
  },
  default: {
    fontFamily: Fonts.medium,
    fontSize: 16,
    lineHeight: 24,
  },
  title: {
    fontFamily: Fonts.extrabold,
    fontSize: 40,
    lineHeight: 46,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontFamily: Fonts.extrabold,
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.3,
  },
  link: {
    fontFamily: Fonts.medium,
    fontSize: 14,
    lineHeight: 30,
  },
  linkPrimary: {
    fontFamily: Fonts.bold,
    fontSize: 14,
    lineHeight: 30,
    color: '#FF5A1F',
  },
  code: {
    fontFamily: Fonts.mono,
    fontSize: 12,
  },
});
