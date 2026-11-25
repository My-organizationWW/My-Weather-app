import React, { createContext, useState, useEffect, useContext, useCallback, useMemo, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { resolveTheme, authorTheme, APP_THEME_KEY, THEME_MODES } from './themes';

const ThemeContext = createContext({
  theme: authorTheme,
  setThemeMode: () => {},
  themeMode: 'author',
  loaded: false,
  themeOverlayOpacity: new Animated.Value(1),
});

export const ThemeProvider = ({ children }) => {
  const [themeMode, setThemeModeState] = useState('author');
  const [loaded, setLoaded] = useState(false);
  const themeOverlayOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loadTheme = async () => {
      try {
        const saved = await AsyncStorage.getItem(APP_THEME_KEY);
        if (saved === 'auto') {
          setThemeModeState('author');
        } else if (THEME_MODES.some((m) => m.value === saved)) {
          setThemeModeState(saved);
        }
      } catch (e) {
      } finally {
        setLoaded(true);
      }
    };
    loadTheme();
  }, []);

  const setThemeMode = useCallback(async (value) => {
    const next = THEME_MODES.some((m) => m.value === value) ? value : 'author';
    themeOverlayOpacity.stopAnimation();
    Animated.timing(themeOverlayOpacity, {
      toValue: 0.9,
      duration: 150,
      easing: Easing.inOut(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      setThemeModeState(next);
      AsyncStorage.setItem(APP_THEME_KEY, next).catch(() => {});
      if (!finished) {
        themeOverlayOpacity.setValue(1);
        return;
      }
      Animated.timing(themeOverlayOpacity, {
        toValue: 1,
        duration: 150,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }).start();
    });
  }, [themeOverlayOpacity]);

  const theme = useMemo(() => resolveTheme(themeMode), [themeMode]);

  const value = useMemo(
    () => ({ theme, setThemeMode, themeMode, loaded, themeOverlayOpacity }),
    [theme, setThemeMode, themeMode, loaded, themeOverlayOpacity],
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);

export default ThemeContext;
