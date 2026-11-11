import React from 'react';
import { View, StatusBar, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from './ThemeContext';

export default function ScreenWrapper({ children, style, contentStyle, backgroundColor }) {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();

  const bg = backgroundColor || (theme ? theme.background : '#1c2333');
  const isDark = theme ? theme.dark : true;

  return (
    <View style={[styles.container, { backgroundColor: bg }, style]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <View style={[styles.content, { paddingTop: Math.max(insets.top, 8) }, contentStyle]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
});
