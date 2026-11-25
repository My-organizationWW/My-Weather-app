import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, Animated, Easing, StatusBar, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { enableFreeze } from 'react-native-screens';

// Freeze (don't unmount/detach) background screens: the outgoing screen
// keeps its last frame during push, so the trailing edge of
// slide_from_right never exposes the OS window background (grey flash).
enableFreeze(true);
import { useTranslation } from 'react-i18next';
import i18n from './i18n';
import WeatherApp from './WeatherApp';
import WeatherPhenomenonFinder, { SunTabIcon, SearchTabIcon } from './WeatherPhenomenonFinder';
import SettingsScreen from './SettingsScreen';
import CityListScreen from './CityListScreen';
import NetworkDiagnosticsScreen from './NetworkDiagnosticsScreen';
import { SettingsProvider } from './SettingsContext';
import { FontSizeProvider, useFontSize } from './FontSizeContext';
import { ThemeProvider, useTheme } from './ThemeContext';
import { LoadingContext } from './LoadingContext';
import { initI18n } from './i18n';
import GlobalErrorBoundary from './components/GlobalErrorBoundary';
import PressableScale from './components/PressableScale';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function AppContent() {
  const [isI18nReady, setIsI18nReady] = useState(false);
  const { theme } = useTheme();

  useEffect(() => {
    let active = true;
    initI18n().then(() => {
      if (active) setIsI18nReady(true);
    });
    return () => { active = false; };
  }, []);

  if (!isI18nReady) {
    return <View style={{ flex: 1, backgroundColor: theme.background }} />;
  }

  return <AppMain />;
}

const NOOP = () => {};

function AppMain() {
  const { themeOverlayOpacity, theme } = useTheme();
  // Any still-unpainted native surface (transition gaps, detached views)
  // uses the app background instead of the OS grey: the flash becomes
  // structurally impossible in every theme mode.
  const navTheme = useMemo(
    () => ({
      ...DefaultTheme,
      dark: theme.mode !== 'light',
      colors: { ...DefaultTheme.colors, background: theme.background, card: theme.background },
    }),
    [theme.mode, theme.background],
  );
  const loadingValue = useMemo(() => ({ isLoading: false, setLoading: NOOP }), []);

  return (
    <GlobalErrorBoundary>
      <LoadingContext.Provider value={loadingValue}>
        <Animated.View style={{ flex: 1, opacity: themeOverlayOpacity }}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <FontSizeProvider>
              <SettingsProvider>
                <SafeAreaProvider style={{ flex: 1 }}>
                  <NavigationContainer theme={navTheme}>
                    <Stack.Navigator
                      screenOptions={{
                        headerShown: false,
                        animation: 'slide_from_right',
                        contentStyle: { backgroundColor: theme.background },
                        // Suspend (don't detach) the outgoing screen: it
                        // keeps its last frame behind the entering one.
                        // NOTE: detachInactiveScreens does not exist in the
                        // installed native-stack (verified in node_modules) —
                        // an unknown prop would be silently ignored.
                        freezeOnBlur: true,
                      }}
                    >
                      <Stack.Screen name="Tabs" component={TabScreens} />
                      <Stack.Screen
                        name="Settings"
                        component={SettingsScreen}
                        options={{ animation: 'slide_from_right' }}
                      />
                      <Stack.Screen
                        name="CityList"
                        component={CityListScreen}
                        options={{ animation: 'slide_from_right', freezeOnBlur: false }}
                      />
                      <Stack.Screen
                        name="NetDiag"
                        component={NetworkDiagnosticsScreen}
                        options={{ animation: 'slide_from_right' }}
                      />
                    </Stack.Navigator>
                  </NavigationContainer>
                </SafeAreaProvider>
              </SettingsProvider>
            </FontSizeProvider>
          </GestureHandlerRootView>
        </Animated.View>
      </LoadingContext.Provider>
    </GlobalErrorBoundary>
  );
}

function TabScreens() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        // Cross-fade the two tabs instead of swapping them instantly.
        animation: 'fade',
         tabBarStyle: {
          height: 50,
          paddingBottom: 0,
          paddingTop: 0,
        },
      }}
      tabBar={(props) => <AnimatedTabBar {...props} />}
    >
      <Tab.Screen name="weather" component={WeatherApp} />
      <Tab.Screen name="phenomena" component={WeatherPhenomenonFinder} />
    </Tab.Navigator>
  );
}

const AnimatedTabBar = React.memo(function AnimatedTabBar({ state, descriptors, navigation, style }) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { base, iconSize } = useFontSize();
  const animationValues = useRef(state.routes.map(() => new Animated.Value(1))).current;
  // Focus cross-fade per tab (0 = muted, 1 = accent), driven on the native
  // driver via two opacity-layered text nodes (native driver cannot animate color).
  const focusValues = useRef(state.routes.map((route) => new Animated.Value(
    route.name === state.routes[state.index].name ? 1 : 0
  ))).current;

  const focusedOptions = descriptors[state.routes[state.index].key]?.options ?? {};
  const displayStyle = StyleSheet.flatten(focusedOptions?.tabBarStyle ?? {})?.display ?? 'flex';

  useEffect(() => {
    state.routes.forEach((route, index) => {
      Animated.spring(animationValues[index], {
        toValue: index === state.index ? 1.12 : 1,
        friction: 6,
        tension: 140,
        useNativeDriver: true,
      }).start();
      Animated.timing(focusValues[index], {
        toValue: index === state.index ? 1 : 0,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
    });
  }, [state.index]);

  if (displayStyle === 'none') {
    return <View style={{ height: 0, opacity: 0 }} />;
  }

  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: theme.background,
        borderTopColor: theme.border,
        borderTopWidth: 1,
        height: 50,
        paddingBottom: 0,
        paddingTop: 0,
        ...style,
      }}
    >
      {state.routes.map((route, index) => {
        const isFocused = state.index === index;
        const IconComponent = route.name === 'weather' ? SunTabIcon : SearchTabIcon;
        const label = route.name === 'weather' ? t('weather') : t('phenomena');
        const iconColor = isFocused ? theme.accent : theme.textMuted;

        const onPress = () => {
          if (!isFocused) {
            navigation.navigate(route.name);
          }
        };

        const mutedOpacity = focusValues[index].interpolate({
          inputRange: [0, 1],
          outputRange: [1, 0],
        });

        return (
          <PressableScale
            key={route.key}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
            onPress={onPress}
            scaleTo={0.94}
            activeOpacity={0.9}
            haptic
          >
            <View style={{ alignItems: 'center', justifyContent: 'center' }}>
              <Animated.View
                style={{
                  position: 'absolute',
                  width: iconSize * 1.45,
                  height: iconSize * 0.95,
                  borderRadius: iconSize * 0.5,
                  backgroundColor: theme.accent + '1F',
                  opacity: animationValues[index].interpolate({
                    inputRange: [1, 1.12],
                    outputRange: [0, 1],
                  }),
                  transform: [
                    {
                      scale: animationValues[index].interpolate({
                        inputRange: [1, 1.12],
                        outputRange: [0.7, 1],
                      }),
                    },
                  ],
                }}
              />
              <Animated.View style={{ transform: [{ scale: animationValues[index] }] }}>
                <IconComponent color={iconColor} size={iconSize * 0.8} />
              </Animated.View>
            </View>
            <View style={{ alignItems: 'center', justifyContent: 'center' }}>
              <Animated.Text
                style={{
                  fontSize: base * 0.6875,
                  fontWeight: '600',
                  marginTop: 0,
                  color: theme.textMuted,
                  opacity: mutedOpacity,
                }}
              >
                {label}
              </Animated.Text>
              <Animated.Text
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  fontSize: base * 0.6875,
                  fontWeight: '600',
                  marginTop: 0,
                  color: theme.accent,
                  opacity: focusValues[index],
                }}
              >
                {label}
              </Animated.Text>
            </View>
          </PressableScale>
        );
      })}
    </View>
  );
});

export default function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}
