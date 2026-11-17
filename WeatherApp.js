import { useState, useEffect, useLayoutEffect, useRef, useMemo, useContext, useCallback } from 'react';
import NetInfo from '@react-native-community/netinfo';
import * as Location from 'expo-location';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Platform,
  ToastAndroid,
  TextInput,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
   Alert,
   Animated,
   Easing,
   Switch,
   Dimensions,
   Linking,
   Image,
   StatusBar,
   Modal,
   TouchableWithoutFeedback,
   Keyboard,
   SafeAreaView,
  } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
 import ScreenWrapper from './ScreenWrapper';
import PressableScale from './components/PressableScale';
import FadeSlideIn from './components/FadeSlideIn';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, G, Line, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import {
  THEME_MODES,
} from './themes';
import { useRoute, useNavigation, useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import i18n, { changeLanguage } from './i18n';
import { LoadingContext } from './LoadingContext';
import { SettingsContext } from './SettingsContext';
import { useFontSize } from './FontSizeContext';
import { useTheme } from './ThemeContext';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isOfflineError, isRegionLike, resolvePlaceName } from './geocoding';
import { fetchForecast, searchCity } from './utils/weatherProviders';
import { fetchJsonWithRetry, HttpError } from './utils/http';
import { GithubIcon, WeatherIcon, SunAnimation, FogAnimation } from './components/weather/WeatherIcons';
import {
  weathercodeToType,
  isNightHour,
  isCoordsLikeText,
  getHourlyTimeline,
  beaufortFromMs,
  convertWind,
  formatTemp,
  computeCityClock,
} from './utils/weatherFormat';

const BASE_URL = 'https://api.open-meteo.com/v1/forecast';
const TIMEOUT_MS = 10000;
const SCREEN_WIDTH = Dimensions.get('window').width;
const APP_VERSION = require('./package.json').version;
const APP_ICON_SOURCE = require('./assets/icon.png');
const GITHUB_URL = 'https://github.com/werxuiiika/My-Weather-app';

const REMEMBER_CITY_ENABLED_KEY = 'remember_city_enabled';
const LAST_CITY_KEY = 'last_selected_city';

const loadLastCity = async () => { try { return await AsyncStorage.getItem(LAST_CITY_KEY); } catch (e) { return null; } };
// Cache-First: last successfully loaded weather snapshot for instant display.
const LAST_WEATHER_KEY = 'last_weather_data';
const loadCachedWeather = async () => {
  try {
    const raw = await AsyncStorage.getItem(LAST_WEATHER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.place || !parsed.data) return null;
    return parsed;
  } catch (e) { return null; }
};
const saveCachedWeather = async (snapshot) => {
  try { await AsyncStorage.setItem(LAST_WEATHER_KEY, JSON.stringify(snapshot)); } catch (e) {}
};
const saveLastCity = async (name) => { try { await AsyncStorage.setItem(LAST_CITY_KEY, name); } catch (e) {} };
const clearLastCity = async () => { try { await AsyncStorage.removeItem(LAST_CITY_KEY); } catch (e) {} };
const loadRememberCity = async () => { try { const v = await AsyncStorage.getItem(REMEMBER_CITY_ENABLED_KEY); return v === null ? true : v === 'true'; } catch (e) { return true; } };
const saveRememberCity = async (value) => {
  try {
    await AsyncStorage.setItem(REMEMBER_CITY_ENABLED_KEY, value ? 'true' : 'false');
    if (!value) {
      await clearLastCity();
    }
  } catch (e) {}
};

const fetchJson = async (url) => {
  try {
    return await fetchJsonWithRetry(url, { timeoutMs: TIMEOUT_MS });
  } catch (e) {
    if (e instanceof TypeError || (e && e.name === 'AbortError')) {
      const err = new Error(e instanceof TypeError ? i18n.t('noInternet') : i18n.t('serverTimeout'));
      err.kind = 'network';
      throw err;
    }
    if (e instanceof HttpError) {
      const err = new Error(i18n.t('weatherFetchFailed'));
      err.kind = 'http';
      err.status = e.status;
      throw err;
    }
    throw e;
  }
};


const TEMP_UNIT_OPTIONS = [
  { value: 'C', labelKey: 'tempUnits.C.label', descKey: 'tempUnits.C.desc' },
  { value: 'F', labelKey: 'tempUnits.F.label', descKey: 'tempUnits.F.desc' },
];

const WIND_UNIT_OPTIONS = [
  { value: 'kmh', labelKey: 'windUnits.kmh.label', descKey: 'windUnits.kmh.desc' },
  { value: 'ms', labelKey: 'windUnits.ms.label', descKey: 'windUnits.ms.desc' },
  { value: 'mph', labelKey: 'windUnits.mph.label', descKey: 'windUnits.mph.desc' },
  { value: 'knots', labelKey: 'windUnits.knots.label', descKey: 'windUnits.knots.desc' },
  { value: 'beaufort', labelKey: 'windUnits.beaufort.label', descKey: 'windUnits.beaufort.desc' },
];

const LANGUAGE_OPTIONS = [
  { value: 'ru', labelKey: 'russian' },
  { value: 'en', labelKey: 'english' },
];


function formatWind(speedKmh, unit) {
  if (unit === 'beaufort') return `${beaufortFromMs(speedKmh / 3.6)} ${i18n.t('windLabels.beaufort')}`;
  const v = convertWind(speedKmh, unit);
  if (unit === 'kmh') return `${Math.round(v)} ${i18n.t('windLabels.kmh')}`;
  return `${v.toFixed(1)} ${i18n.t(`windLabels.${unit}`) || i18n.t('windLabels.kmh')}`;
}

// Fade+rise the hero block when the displayed city changes (or on first
// load). Kept separate from the hourly/weekly lists: those already run
// dozens of native icon loops and must not be re-mounted.
function HeroReveal({ trigger, children }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(10)).current;

  useEffect(() => {
    opacity.setValue(0);
    translateY.setValue(10);
    const animation = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 260,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 300,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [trigger, opacity, translateY]);

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      {children}
    </Animated.View>
  );
}

// Crossfades between text values (temperature, condition, day/night) so a
// refresh or a unit change reads as a transition instead of a hard swap.
// Positioned absolutely inside a sized box to avoid layout jumps.
function CrossfadeValue({ style, value }) {
  const [current, setCurrent] = useState(value);
  const [previous, setPrevious] = useState(null);
  const currentOpacity = useRef(new Animated.Value(1)).current;
  const previousOpacity = useRef(new Animated.Value(0)).current;
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      setCurrent(value);
      return;
    }
    if (value === current) return;
    setPrevious(current);
    setCurrent(value);
    previousOpacity.setValue(1);
    currentOpacity.setValue(0);
    Animated.parallel([
      Animated.timing(currentOpacity, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(previousOpacity, {
        toValue: 0,
        duration: 160,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) setPrevious(null);
    });
  }, [value, current, currentOpacity, previousOpacity]);

  return (
    <View>
      {previous !== null && (
        <Animated.Text
          style={[style, { position: 'absolute', top: 0, left: 0, right: 0, opacity: previousOpacity }]}
          pointerEvents="none"
        >
          {previous}
        </Animated.Text>
      )}
      <Animated.Text style={[style, { opacity: currentOpacity }]}>{current}</Animated.Text>
    </View>
  );
}

export default function App() {
  const { t: tr } = useTranslation();
  const { theme, setThemeMode, themeMode, loaded: themeLoaded } = useTheme();
  const insets = useSafeAreaInsets();
  const [isConnected, setIsConnected] = useState(null);
  const updateConnection = (value) => {
    setIsConnected(value);
  };
  const [city, setCity] = useState('');
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [weather, setWeather] = useState(null);
  // True while the visible data comes from cache and may be outdated.
  const [isStale, setIsStale] = useState(false);
  const [error, setError] = useState(null);
  const [hostUnreachable, setHostUnreachable] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [dismissedMsg, setDismissedMsg] = useState(null);
  const [coordsCopied, setCoordsCopied] = useState(false);
  const copyTimer = useRef(null);
  const [cityTime, setCityTime] = useState(null);
  const [isSplashVisible, setIsSplashVisible] = useState(true);
  const [isContentVisible, setIsContentVisible] = useState(false);
  const [splashRendered, setSplashRendered] = useState(true);
   const [menuVisible, setMenuVisible] = useState(false);
   const [settingsOpen, setSettingsOpen] = useState(false);
   const [permissionModalVisible, setPermissionModalVisible] = useState(false);
  const menuAnim = useRef(new Animated.Value(0)).current;

  const toggleMenu = () => {
    if (menuVisible) {
      Animated.timing(menuAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start(() => setMenuVisible(false));
    } else {
      setMenuVisible(true);
      Animated.timing(menuAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  };

  const closeMenu = () => {
    Animated.timing(menuAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => setMenuVisible(false));
  };

  const menuScale = menuAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.9, 1],
  });

  const menuOpacity = menuAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });
  const [rememberCity, setRememberCity] = useState(true);
  const [themePickerVisible, setThemePickerVisible] = useState(false);
  const [unitPickerVisible, setUnitPickerVisible] = useState(false);
  const [unitPickerMode, setUnitPickerMode] = useState('temp');
  const [languagePickerVisible, setLanguagePickerVisible] = useState(false);
  const [tempPickerAnim] = useState(() => new Animated.Value(0));
  const lastRequest = useRef(null);
  const weatherRef = useRef(null);
  const rememberRef = useRef(true);
  const splashOpacity = useRef(new Animated.Value(1)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const sunScale = useRef(new Animated.Value(1)).current;
  const sunRotate = useRef(new Animated.Value(0)).current;
  const settingsOverlayOpacity = useRef(new Animated.Value(0)).current;
  const settingsScreenX = useRef(new Animated.Value(SCREEN_WIDTH)).current;
  const pickerAnim = useRef(new Animated.Value(0)).current;
  const languagePickerAnim = useRef(new Animated.Value(0)).current;
  const placeholderAnim = useRef(new Animated.Value(city.length === 0 ? 1 : 0)).current;
  const clearButtonAnim = useRef(new Animated.Value(city.length > 0 ? 1 : 0)).current;

  useEffect(() => {
    const hasText = city.length > 0;
    Animated.parallel([
      Animated.timing(placeholderAnim, {
        toValue: hasText ? 0 : 1,
        duration: 180,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(clearButtonAnim, {
        toValue: hasText ? 1 : 0,
        duration: 180,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();
  }, [city]);
  const fs = useFontSize();
  const styles = useMemo(() => buildStyles(theme, fs || { spacing: 16, base: 16, small: 12, large: 20, iconSize: 24, cardHeight: 80 }, insets), [theme, fs, insets]);
  const currentThemeLabel = useMemo(() => {
    const found = THEME_MODES.find((m) => m.value === themeMode);
    return found ? tr(found.labelKey) : tr('themeModes.author.label');
  }, [themeMode, tr]);
  const route = useRoute();
  const navigation = useNavigation();
  const cityParam = route.params?.city ?? route.params?.selectedCity;
  const appliedCityParam = useRef(null);
  const { isLoading, setLoading: setAppLoading } = useContext(LoadingContext);
  const { tempUnit, windUnit, setTempUnit, setWindUnit, showSourceBadge } = useContext(SettingsContext);

// Display names for the live data source badge (keys = `source` field).
const SOURCE_NAMES = { '7timer': '7Timer', 'open-meteo': 'Open-Meteo', nominatim: 'Nominatim' };
  const refreshColors =
    theme.mode === 'light' ? ['#3573c2', '#25945a'] : ['#4a90d9', '#38b06b'];
  const switchTrackOff = theme.mode === 'light' ? '#c9d3e6' : '#3a4560';
  useEffect(() => {
    const spin = Animated.loop(
      Animated.timing(sunRotate, { toValue: 1, duration: 6000, useNativeDriver: true })
    );
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(sunScale, { toValue: 1.15, duration: 900, useNativeDriver: true }),
        Animated.timing(sunScale, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    );
    spin.start();
    pulse.start();
    const timer = setTimeout(() => {
      setIsSplashVisible(false);
      setIsContentVisible(true);
    }, 1500);
    return () => {
      spin.stop();
      pulse.stop();
      clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    let active = true;
    const init = async () => {
      const state = await NetInfo.fetch();
      if (!active) return;
      updateConnection(!!state.isConnected);
      const remember = await loadRememberCity();
      if (!active) return;
      rememberRef.current = remember;
      setRememberCity(remember);
      const saved = await loadLastCity();
      if (!active) return;
      // Cache-First: show the last snapshot instantly (no spinner),
      // then refresh it in the background.
      const cached = await loadCachedWeather();
      if (!active) return;
      let hasCache = false;
      if (cached) {
        hasCache = true;
        const snapshot = { place: cached.place, data: cached.data, savedAt: cached.savedAt };
        weatherRef.current = snapshot;
        setWeather(snapshot);
        setIsStale(true);
        // Restore refresh intent from cache so pull-to-refresh / retry
        // never falls back to geolocation (Scenario A, not B).
        const cLat = cached.place?.latitude;
        const cLon = cached.place?.longitude;
        if (typeof cLat === 'number' && typeof cLon === 'number') {
          lastRequest.current = { type: 'coords', lat: cLat, lon: cLon, query: cached.query || null };
        } else if (cached.query) {
          lastRequest.current = { type: 'city', query: cached.query };
        }
      }
      if (!remember || !saved) {
        if (active && !saved) detectMyLocation();
        return;
      }
      // Strict rule: NEVER re-geocode on launch. If we have a cached
      // place with coordinates, refresh data in place and keep its
      // frozen name/country. doSearch() runs only when there is no
      // cached place at all (legacy cache) — i.e. an explicit lookup.
      if (weatherRef.current?.place) {
        refreshCurrentWeather(hasCache);
      } else {
        doSearch(saved, hasCache);
      }
    };
    init();
    const unsubscribe = NetInfo.addEventListener((state) => {
      updateConnection(!!state.isConnected);
      if (!state.isConnected) {
        setHostUnreachable(false);
      }
    });
     return () => {
       active = false;
       unsubscribe();
     };
   }, []);
  useFocusEffect(
    useCallback(() => {
      (async () => {
        const remember = await loadRememberCity();
        rememberRef.current = remember;
        setRememberCity(remember);
      })();
    }, [])
  );
   useEffect(() => {
     if (!isSplashVisible) {
      Animated.timing(splashOpacity, { toValue: 0, duration: 500, useNativeDriver: true }).start(
        ({ finished }) => {
          if (finished) setSplashRendered(false);
        }
      );
    }
  }, [isSplashVisible]);
  useEffect(() => {
    if (isContentVisible) {
      Animated.timing(contentOpacity, { toValue: 1, duration: 500, useNativeDriver: true }).start();
    }
  }, [isContentVisible]);
  useEffect(() => {
    if (!settingsOpen) return;
    Animated.parallel([
      Animated.timing(settingsOverlayOpacity, {
        toValue: 1,
        duration: 300,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(settingsScreenX, {
        toValue: 0,
        duration: 300,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [settingsOpen]);
  useEffect(() => {
    if (!themePickerVisible) return;
    Animated.timing(pickerAnim, {
      toValue: 1,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [themePickerVisible]);
  useEffect(() => {
    if (!unitPickerVisible) return;
    Animated.timing(tempPickerAnim, {
      toValue: 1,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [unitPickerVisible]);
  useEffect(() => {
    if (!languagePickerVisible) return;
    Animated.timing(languagePickerAnim, {
      toValue: 1,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [languagePickerVisible]);
  const openSettings = () => {
    navigation.getParent()?.navigate('Settings');
  };
  const closeSettings = () => {
    if (themePickerVisible) closeThemePicker();
    if (languagePickerVisible) closeLanguagePicker();
    Animated.parallel([
      Animated.timing(settingsOverlayOpacity, {
        toValue: 0,
        duration: 240,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(settingsScreenX, {
        toValue: SCREEN_WIDTH,
        duration: 280,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) setSettingsOpen(false);
    });
  };
  const openThemePicker = () => {
    pickerAnim.setValue(0);
    setThemePickerVisible(true);
  };
  const closeThemePicker = () => {
    Animated.timing(pickerAnim, {
      toValue: 0,
      duration: 180,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setThemePickerVisible(false);
    });
  };
  const selectThemeMode = async (value) => {
    setThemeMode(value);
    closeThemePicker();
  };
  const toggleRemember = async (value) => {
    setRememberCity(value);
    rememberRef.current = value;
    await saveRememberCity(value);
  };
  const showUnitPicker = (mode) => {
    setUnitPickerMode(mode);
    tempPickerAnim.setValue(0);
    setUnitPickerVisible(true);
  };
  const hideUnitPicker = () => {
    Animated.timing(tempPickerAnim, {
      toValue: 0,
      duration: 180,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setUnitPickerVisible(false);
    });
  };
  const onSelectUnit = async (value) => {
    if (unitPickerMode === 'temp') {
      await setTempUnit(value);
    } else {
      await setWindUnit(value);
    }
    hideUnitPicker();
  };
  const openLanguagePicker = () => {
    languagePickerAnim.setValue(0);
    setLanguagePickerVisible(true);
  };
  const closeLanguagePicker = () => {
    Animated.timing(languagePickerAnim, {
      toValue: 0,
      duration: 180,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setLanguagePickerVisible(false);
    });
  };
  const selectLanguage = async (value) => {
    await changeLanguage(value);
    closeLanguagePicker();
  };
  const openGitHub = async () => {
    try {
      await Linking.openURL(GITHUB_URL);
    } catch (e) {}
  };
  const geocode = async (query) => {
    // 1. Current app language -> 2. English -> 3. transliterated Latin
    // variants (shared helper, see geocoding.js). Only then "not found".
    // Provider layer: OM search (transliteration included), Nominatim
    // when OM yields nothing (same hit contract, region checks stay).
    const hit = await searchCity(query, i18n.language || 'ru', fetchJson);
    if (!hit) {
      throw new Error(tr('cityNotFound'));
    }
    if (isRegionLike(hit)) {
      throw new Error(tr('enterCityNotCountry'));
    }
    return hit;
  };
  // Name resolution with real fallbacks (native geocoder -> Open-Meteo
  // -> BigDataCloud, see geocoding.js). Open-Meteo alone returns
  // {error:"Not Found"} for rural coords (e.g. 56.21, 37.55), which used
  // to leave the header stuck on "Current location".
  const reverseGeocode = async (lat, lon) => {
    const resolved = await resolvePlaceName(lat, lon, i18n.language, fetchJson);
    return {
      name: resolved?.name || tr('currentLocation'),
      country: resolved?.country || '',
      latitude: lat,
      longitude: lon,
    };
  };
  // Canonical forecast via the provider layer: Open-Meteo full shape,
  // automatic 7Timer fallback with the SAME shape when OM is down or
  // blocked. Result carries `source` ('open-meteo' | '7timer').
  const fetchWeather = async (lat, lon) => {
    return fetchForecast(
      lat,
      lon,
      fetchJson,
      `${BASE_URL}?latitude=${lat}&longitude=${lon}&current_weather=true&hourly=temperature_2m,weathercode&daily=weathercode,temperature_2m_max,temperature_2m_min,sunrise,sunset&timezone=auto`
    );
  };
  // Scenario A: refresh by saved coordinates — pure Open-Meteo fetch,
  // never touches Location.*. Scenario B (geolocation) lives ONLY in
  // detectMyLocation(), called from the "my location" button / first launch.
  const loadByCoords = async (lat, lon, silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    // Record intent BEFORE the attempt so Retry repeats this action
    // even if it fails (previously only set on success, leaving a stale request).
    lastRequest.current = { type: 'coords', lat, lon };
    try {
      const [place, data] = await Promise.all([reverseGeocode(lat, lon), fetchWeather(lat, lon)]);
      const savedAt = Date.now();
      const snapshot = { place, data, savedAt };
      weatherRef.current = snapshot;
      setWeather(snapshot);
      setIsStale(false);
      await saveCachedWeather({ place, data, query: place.name, savedAt });
      if (rememberRef.current && place.name && place.name !== tr('currentLocation')) {
        await saveLastCity(place.name);
      }
      setCity('');
    } catch (e) {
      if (isOfflineError(e)) {
        setError(tr('noInternet'));
      } else if (e.kind === 'network') {
        setError(null);
        setHostUnreachable(true);
      } else {
        setError(e.message || tr('weatherFetchFailed'));
      }
      if (!silent) {
        weatherRef.current = null;
        setWeather(null);
      }
    } finally {
      setLoading(false);
    }
  };
  // No NetInfo gate here (or anywhere): NetInfo reports the VPN tunnel
  // state, not real reachability — with a half-dead tunnel it says
  // "offline" while the browser fetches fine. Always attempt; the catch
  // below classifies the real error.
  const detectMyLocation = async () => {
     setLocating(true);
     setError(null);
     try {
       let { status } = await Location.getForegroundPermissionsAsync();
       if (status !== 'granted') {
         const permission = await Location.requestForegroundPermissionsAsync();
         status = permission.status;
       }
       if (status !== 'granted') {
         setPermissionModalVisible(true);
         return;
       }
       const position = await Location.getCurrentPositionAsync({
         accuracy: Location.Accuracy.Balanced,
       });
       const { latitude, longitude, accuracy } = position.coords;
       if (accuracy && accuracy > 1000) {
         setError("Геолокация приблизительная. Для точного прогноза включите 'Точное местоположение' в настройках.");
       }
       await loadByCoords(latitude, longitude);
     } catch (e) {
       setError(tr('locationFailed'));
     } finally {
       setLocating(false);
     }
   };
  const doSearch = async (query, silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    // Record intent BEFORE the attempt so Retry repeats this exact search
    // even when geocoding fails with "city not found".
    lastRequest.current = { type: 'city', query };
    try {
      const place = await geocode(query);
      const data = await fetchWeather(place.latitude, place.longitude);
      const savedAt = Date.now();
      const snapshot = { place, data, savedAt };
      weatherRef.current = snapshot;
      setWeather(snapshot);
      setIsStale(false);
      await saveCachedWeather({ place, data, query, savedAt });
      // Upgrade intent to coords so the next refresh uses saved
      // coordinates directly (no re-geocode, never geolocation).
      if (typeof place.latitude === 'number' && typeof place.longitude === 'number') {
        lastRequest.current = { type: 'coords', lat: place.latitude, lon: place.longitude, query };
      }
      if (rememberRef.current) {
        await saveLastCity(query);
      }
      setCity('');
    } catch (e) {
      if (isOfflineError(e)) {
        setError(tr('noInternet'));
      } else if (e.kind === 'network') {
        setError(null);
        setHostUnreachable(true);
      } else {
        setError(e.message || tr('weatherFetchFailed'));
      }
      if (!silent) {
        weatherRef.current = null;
        setWeather(null);
      }
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (cityParam && appliedCityParam.current !== cityParam) {
      appliedCityParam.current = cityParam;
      doSearch(cityParam);
    }
  }, [cityParam]);
  const search = () => {
    const query = city.trim();
    if (!query) {
      Alert.alert(tr('enterCity'), tr('enterCityMessage'));
      return;
    }
    Keyboard.dismiss();
    doSearch(query);
  };
  // Swipe/Retry refresh: fetch ONLY fresh weather data for the currently
  // displayed place and keep its name/country untouched. This is what
  // prevents "Дмитров" from turning into "Текущее местоположение" after
  // a swipe — unlike loadByCoords(), it never runs reverseGeocode().
  const refreshCurrentWeather = async (silent = false) => {
    const cur = weatherRef.current;
    if (!cur || !cur.place || typeof cur.place.latitude !== 'number' || typeof cur.place.longitude !== 'number') {
      return false;
    }
    if (!silent) setLoading(true);
    setError(null);
    try {
      const data = await fetchWeather(cur.place.latitude, cur.place.longitude);
      const savedAt = Date.now();
      const snapshot = { place: cur.place, data, savedAt };
      weatherRef.current = snapshot;
      setWeather(snapshot);
      setIsStale(false);
      const q = lastRequest.current?.query ?? cur.place.name;
      if (typeof cur.place.latitude === 'number' && typeof cur.place.longitude === 'number') {
        lastRequest.current = { type: 'coords', lat: cur.place.latitude, lon: cur.place.longitude, query: q ?? null };
      }
      await saveCachedWeather({ place: cur.place, data, query: q, savedAt });
      return true;
    } catch (e) {
      if (isOfflineError(e)) {
        setError(tr('noInternet'));
      } else if (e.kind === 'network') {
        setError(null);
        setHostUnreachable(true);
      } else {
        setError(e.message || tr('weatherFetchFailed'));
      }
      return false;
    } finally {
      if (!silent) setLoading(false);
    }
  };
  // Shared refresh target: Scenario A only (saved city coords).
  // NEVER calls Location.* — no permission modal from refresh/retry.
  const resolveRefreshTarget = () => {
    const last = lastRequest.current;
    if (last && typeof last.lat === 'number' && typeof last.lon === 'number') {
      return { lat: last.lat, lon: last.lon };
    }
    if (last && last.query) {
      return { query: last.query };
    }
    const p = weatherRef.current?.place;
    if (p && typeof p.latitude === 'number' && typeof p.longitude === 'number') {
      return { lat: p.latitude, lon: p.longitude };
    }
    const typed = city.trim();
    if (typed) {
      return { query: typed };
    }
    return null;
  };
  // Long-press on the coords subtitle: copy "lat, lon" to clipboard
  // with light haptic feedback. Pressable doesn't steal scroll gestures,
  // so pull-to-refresh keeps working as usual.
  const copyCoords = async () => {
    const p = weather?.place;
    if (!p || typeof p.latitude !== 'number' || typeof p.longitude !== 'number') return;
    const label = `${p.latitude.toFixed(2)}, ${p.longitude.toFixed(2)}`;
    try {
      await Clipboard.setStringAsync(label);
    } catch (e) {}
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (e) {}
    if (Platform.OS === 'android') {
      ToastAndroid.show(tr('coordsCopied'), ToastAndroid.SHORT);
    } else {
      setCoordsCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCoordsCopied(false), 1500);
    }
  };
  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);
  const retryConnection = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      const state = await NetInfo.fetch();
      updateConnection(!!state.isConnected);
      // No gate: a lying "offline" must not disable Retry — the attempt
      // below proves reachability one way or the other.
      setHostUnreachable(false);
      // Primary path: keep the current header, only reload the data.
      const hadPlace = !!weatherRef.current?.place;
      if (await refreshCurrentWeather(false)) return;
      if (hadPlace) return; // keep stale city on screen, never wipe/replace its header
      const target = resolveRefreshTarget();
      if (!target) return;
      if (target.lat !== undefined) {
        await loadByCoords(target.lat, target.lon);
      } else {
        await doSearch(target.query);
      }
    } finally {
      setRetrying(false);
    }
  };
  const onRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      // Primary path: keep the current header, only reload the data.
      const hadPlace = !!weatherRef.current?.place;
      if (await refreshCurrentWeather(true)) return;
      if (hadPlace) return; // silent swipe fail: keep city header, don't touch anything
      const target = resolveRefreshTarget();
      if (!target) return;
      if (target.lat !== undefined) {
        await loadByCoords(target.lat, target.lon, true);
      } else {
        await doSearch(target.query, true);
      }
    } finally {
      setRefreshing(false);
    }
  };
  const spinInterpolate = sunRotate.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });
  const getSkyIsNight = useCallback(() => {
    if (weather && weather.data) {
      const d = weather.data;
      const cwTime = d.current_weather && d.current_weather.time;
      if (typeof cwTime === 'string' && cwTime.length >= 13) {
        const h = parseInt(cwTime.slice(11, 13), 10);
        if (!Number.isNaN(h)) return h >= 21 || h < 6;
      }
      const offset =
        typeof d.utc_offset_seconds === 'number' ? d.utc_offset_seconds : 0;
      const now = new Date();
      const cityMs =
        now.getTime() + now.getTimezoneOffset() * 60000 + offset * 1000;
      const h = new Date(cityMs).getHours();
      return h >= 21 || h < 6;
    }
    const h = new Date().getHours();
    return h >= 21 || h < 6;
  }, [weather]);
  const skyIsNight = getSkyIsNight();
  let bannerType = null;
  let bannerMessage = null;
  // Advisory only: NetInfo may cry "offline" while fetches succeed
  // (unvalidated VPN tunnel). Show it solely when there is nothing to
  // display; otherwise the real fetch result/error speaks for itself.
  if (isConnected === false && !weather) {
    bannerType = 'offline';
    bannerMessage = tr('noInternet');
  } else if (hostUnreachable) {
    bannerType = 'vpn';
    bannerMessage = tr('vpnWarning');
  } else if (error) {
    bannerType = 'gps';
    bannerMessage = error;
  }
  const showBanner = !!bannerMessage && bannerMessage !== dismissedMsg;
  useEffect(() => {
    if (bannerType === 'vpn' || bannerType === 'gps') {
      const timer = setTimeout(() => {
        if (bannerType === 'vpn') setHostUnreachable(false);
        else setError(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [bannerType, bannerMessage]);
  useEffect(() => {
    if (!weather || !weather.data) {
      setCityTime(null);
      return;
    }
    const tick = () => setCityTime(computeCityClock(weather.data));
    tick();
    const timer = setInterval(tick, 30000);
    return () => clearInterval(timer);
  }, [weather]);
  useEffect(() => {
    const busy =
      isSplashVisible ||
      !themeLoaded ||
      ((loading || locating) && weather === null);
    setAppLoading(busy);
  }, [isSplashVisible, themeLoaded, loading, locating, weather]);
  useLayoutEffect(() => {
    const hideTabs =
      settingsOpen ||
      isSplashVisible ||
      !themeLoaded ||
      ((loading || locating) && weather === null);
     navigation.setOptions({
      tabBarStyle: {
        backgroundColor: theme.background,
        borderTopColor: theme.border,
        height: 70,
        paddingBottom: 8,
        display: hideTabs ? 'none' : 'flex',
      },
      tabBarActiveTintColor: theme.mode === 'light' ? '#3b82f6' : '#fbbf24',
      tabBarInactiveTintColor: theme.mode === 'light' ? '#94a3b8' : '#94a3b8',
    });
  }, [settingsOpen, isSplashVisible, themeLoaded, loading, locating, weather, theme, navigation]);
  const currentIsNight =
    weather &&
    weather.data &&
    weather.data.current_weather &&
    typeof weather.data.current_weather.is_day === 'number'
      ? weather.data.current_weather.is_day === 0
      : skyIsNight;
  const currentType = weather && weather.data && weather.data.current_weather
    ? weathercodeToType(weather.data.current_weather.weathercode)
    : 'clear';
  const conditionFor = (code) => {
    if (code === 0) return tr('condition.clear');
    if (code <= 3) return tr('condition.cloudy');
    if (code <= 48) return tr('condition.fog');
    if (code <= 67) return tr('condition.rain');
    if (code <= 77) return tr('condition.snow');
    if (code <= 86) return tr('condition.showers');
    return tr('condition.thunder');
  };
  if (!themeLoaded || !fs) {
    return (
      <View style={preloadStyles.safe}>
        <View style={preloadStyles.fill} />
      </View>
    );
  }
  return (
    <ScreenWrapper>
        <Animated.View style={[styles.container, { opacity: contentOpacity }]}>
          <Modal
            visible={menuVisible}
            transparent={true}
            animationType="none"
            statusBarTranslucent
            navigationBarTranslucent
            onRequestClose={closeMenu}
          >
            <TouchableWithoutFeedback onPress={closeMenu}>
              <Animated.View style={[styles.menuBackdrop, { opacity: menuOpacity }]}>
                <Animated.View
                  style={[
                    styles.dropdownMenu,
                    {
                      backgroundColor: theme.surfaceRaised || '#253043',
                      borderColor: theme.border || 'rgba(255,255,255,0.1)',
                      opacity: menuOpacity,
                      transform: [{ scale: menuScale }],
                    },
                  ]}
                >
                  <PressableScale
                    style={styles.menuItem}
                    scaleTo={0.98}
                    onPress={() => {
                      closeMenu();
                      navigation.navigate('CityList');
                    }}
                  >
                    <Text style={[styles.menuItemText, { color: theme.text }]} numberOfLines={1} ellipsizeMode="tail">{tr('cities.title')}</Text>
                  </PressableScale>
                  <View style={[styles.menuDivider, { backgroundColor: theme.border || 'rgba(255,255,255,0.1)' }]} />
                  <PressableScale
                    style={styles.menuItem}
                    scaleTo={0.98}
                    onPress={() => {
                      closeMenu();
                      openSettings();
                    }}
                  >
                    <Text style={[styles.menuItemText, { color: theme.text }]} numberOfLines={1} ellipsizeMode="tail">{tr('settings')}</Text>
                  </PressableScale>
                </Animated.View>
              </Animated.View>
            </TouchableWithoutFeedback>
          </Modal>

          <ScrollView
            style={styles.result}
            contentContainerStyle={styles.resultContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={refreshColors[0]}
                colors={refreshColors}
                progressBackgroundColor={theme.surface}
                titleColor={theme.textSecondary}
              />
            }
          >
          <View style={styles.searchBarContainer}>
            <PressableScale onPress={search} style={styles.searchIconWrap} scaleTo={0.88} hitSlop={6}>
              <Ionicons name="search" size={20} color={theme.textMuted || '#94a3b8'} />
            </PressableScale>

            <View style={styles.inputWrap}>
              <Animated.Text
                style={[
                  styles.animatedPlaceholder,
                  {
                    opacity: placeholderAnim,
                    transform: [
                      {
                        translateX: placeholderAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [6, 0],
                        }),
                      },
                    ],
                  },
                ]}
                pointerEvents="none"
              >
                {tr('enterCity')}
              </Animated.Text>
              <TextInput
                style={styles.searchInput}
                value={city}
                onChangeText={setCity}
                onSubmitEditing={search}
                returnKeyType="search"
              />
            </View>

            <Animated.View
              style={{
                opacity: clearButtonAnim,
                transform: [
                  {
                    scale: clearButtonAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.6, 1],
                    }),
                  },
                ],
              }}
              pointerEvents={city.length > 0 ? 'auto' : 'none'}
            >
              <PressableScale
                onPress={() => setCity('')}
                style={styles.searchActionBtn}
                scaleTo={0.88}
                hitSlop={6}
              >
                <Ionicons name="close-circle" size={18} color={theme.textMuted || 'rgba(255,255,255,0.4)'} />
              </PressableScale>
            </Animated.View>

            <PressableScale
              onPress={detectMyLocation}
              disabled={locating}
              disabledOpacity={0.5}
              style={styles.searchActionBtn}
              scaleTo={0.88}
              hitSlop={6}
              haptic
            >
              <Ionicons
                name="locate-outline"
                size={22}
                color={theme.accent || '#38bdf8'}
              />
            </PressableScale>

            <PressableScale
              onPress={toggleMenu}
              style={styles.searchActionBtn}
              scaleTo={0.88}
              hitSlop={6}
              haptic
            >
              <Ionicons name="ellipsis-vertical" size={20} color={theme.text} />
            </PressableScale>
          </View>
          {showBanner && (
            <View
              style={[
                styles.infoBanner,
                bannerType === 'offline' && styles.infoBannerOffline,
                bannerType === 'vpn' && styles.infoBannerVpn,
              ]}
            >
              <Text
                style={[
                  styles.infoBannerText,
                  bannerType === 'offline' && styles.infoBannerTextOffline,
                ]}
              >
                {bannerMessage}
              </Text>
              <PressableScale style={styles.bannerButton} onPress={retryConnection} disabled={retrying} scaleTo={0.95}>
                <Text style={styles.bannerButtonText}>{retrying ? '…' : tr('retry')}</Text>
              </PressableScale>
              <PressableScale style={styles.bannerClose} onPress={() => setDismissedMsg(bannerMessage)} scaleTo={0.85}>
                <Text style={styles.bannerCloseText}>✕</Text>
              </PressableScale>
            </View>
          )}
          {/* Cache-First: spinner only when there is nothing to show yet. */}
          {(loading || locating) && !weather && (
            <View style={styles.center}>
              <Animated.View
                style={[
                  styles.skyIconWrap,
                  { transform: [{ scale: sunScale }, { rotate: spinInterpolate }] },
                ]}
              >
                <WeatherIcon type="clear" isNight={skyIsNight} size={72} />
              </Animated.View>
              <ActivityIndicator size="large" color={theme.accent} />
              <Text style={styles.loadingText}>
                {locating ? tr('locating') : tr('loading')}
              </Text>
            </View>
          )}
          {weather && (
            <HeroReveal trigger={`${weather.place.name}|${weather.place.latitude}|${weather.place.longitude}`}>
              <Text style={styles.cityName}>{weather.place.name}</Text>
              {isStale && weather.savedAt && (
                <Text style={styles.staleLabel}>
                  {tr('cachedAt', { time: formatCacheTime(weather.savedAt) })}
                </Text>
              )}
              <Pressable onLongPress={copyCoords} delayLongPress={500} hitSlop={8}>
                <Text style={styles.subLabel}>
                  {(() => {
                    const coordsLabel = `${weather.place.latitude.toFixed(2)}, ${weather.place.longitude.toFixed(2)}`;
                    const norm = (s) => String(s || '').replace(/\s+/g, '');
                    const showCountry =
                      weather.place.country &&
                      !isCoordsLikeText(weather.place.country) &&
                      norm(weather.place.country) !== norm(coordsLabel);
                    return `${showCountry ? `${weather.place.country} · ` : ''}${coordsLabel}`;
                  })()}
                </Text>
                {coordsCopied && Platform.OS !== 'android' && (
                  <Text style={styles.copiedHint}>{tr('coordsCopied')}</Text>
                )}
              </Pressable>
              {showSourceBadge && weather?.data?.source && weather.data.source !== 'open-meteo' ? (
                <Text style={[styles.cityTime, { opacity: 0.75 }]}>
                  {tr('reserveSource', { source: SOURCE_NAMES[weather.data.source] || weather.data.source })}
                </Text>
              ) : null}
              {cityTime && <Text style={styles.cityTime}>{tr('localTime')} {cityTime}</Text>}
              <View style={styles.bigIconWrap}>
                {currentType === 'clear' ? (
                  <SunAnimation size={100} />
                ) : currentType === 'fog' ? (
                  <FogAnimation size={100} />
                ) : (
                  <WeatherIcon type={currentType} isNight={currentIsNight} size={100} />
                )}
              </View>
              <CrossfadeValue
                style={styles.temperature}
                value={formatTemp(weather.data.current_weather.temperature, tempUnit)}
              />
              <CrossfadeValue
                style={styles.condition}
                value={conditionFor(weather.data.current_weather.weathercode)}
              />
              <View style={styles.detailRow}>
                <View style={styles.detailCard}>
                   <CrossfadeValue
                     style={styles.detailValue}
                     value={formatWind(weather.data.current_weather.windspeed, windUnit)}
                   />
                   <Text style={styles.detailLabel}>{tr('wind')}</Text>
                </View>
                <View style={styles.detailCard}>
                  <CrossfadeValue
                    style={styles.detailValue}
                    value={weather.data.current_weather.is_day ? tr('day') : tr('night')}
                  />
                   <Text style={styles.detailLabel}>{tr('timeOfDay')}</Text>
                </View>
               </View>
              {weather.data && (
                <>
                  <Text style={styles.sectionTitle}>{tr('hourlyForecast')}</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.hourlyRow}
                  >
                    {getHourlyTimeline(weather.data).map((item, idx) => {
                      if (item.type === 'sunrise' || item.type === 'sunset') {
                        const isSunrise = item.type === 'sunrise';
                        return (
                          <View key={`${item.type}-${item.time}`} style={styles.hourlyCard}>
                            <Text style={styles.hourlyTemp} numberOfLines={1}>
                              {tr(isSunrise ? 'sunrise' : 'sunset')}
                            </Text>
                            <WeatherIcon type="clear" isNight={!isSunrise} size={26} />
                            <Text style={styles.hourlyTime}>{String(item.time).slice(11, 16)}</Text>
                          </View>
                        );
                      }
                      return (
                        <View key={`${item.type}-${item.time}`} style={styles.hourlyCard}>
                          <Text style={styles.hourlyTemp} numberOfLines={1}>
                            {item.temp === null || item.temp === undefined ? '–' : formatTemp(item.temp, tempUnit)}
                          </Text>
                          <WeatherIcon
                            type={weathercodeToType(item.code)}
                            isNight={isNightHour(item.time)}
                            size={26}
                          />
                          <Text style={styles.hourlyTime}>{idx === 0 ? tr('now') : String(item.time).slice(11, 16)}</Text>
                        </View>
                      );
                    })}
                  </ScrollView>
                </>
              )}
                <Text style={styles.sectionTitle}>{tr('weeklyForecast')}</Text>
               {weather.data.daily && weather.data.daily.time && weather.data.daily.time.map((day, i) => (
                <View key={day} style={styles.forecastRow}>
                  <Text style={styles.forecastDay}>{formatDay(day)}</Text>
                  <View style={styles.forecastIconCell}>
                    <WeatherIcon
                      type={weathercodeToType(weather.data.daily.weathercode[i])}
                      isNight={false}
                      size={26}
                    />
                  </View>
                  <Text style={styles.forecastTemp} numberOfLines={1}>
                    {formatTemp(weather.data.daily.temperature_2m_min[i], tempUnit)} /{' '}
                    {formatTemp(weather.data.daily.temperature_2m_max[i], tempUnit)}
                  </Text>
                </View>
              ))}
            </HeroReveal>
          )}
           {!loading && !locating && !weather && (
             <FadeSlideIn distance={4} style={styles.center}>
               <Text style={styles.hint}>
                 {tr('enterCityOrLocation')}
               </Text>
             </FadeSlideIn>
           )}
          </ScrollView>
        </Animated.View>
        {splashRendered && (
          <Animated.View
            style={[styles.splash, { opacity: splashOpacity }]}
            pointerEvents={isSplashVisible ? 'auto' : 'none'}
          >
            <Animated.View
              style={[
                styles.splashIconWrap,
                { transform: [{ scale: sunScale }, { rotate: spinInterpolate }] },
              ]}
            >
              <WeatherIcon type="clear" isNight={skyIsNight} size={120} />
            </Animated.View>
            <Text style={styles.splashText}>{tr('splashText')}</Text>
          </Animated.View>
        )}
        {settingsOpen && (
          <View style={styles.settingsLayer} pointerEvents="box-none">
            <Animated.View style={[styles.settingsDim, { opacity: settingsOverlayOpacity }]} />
            <Animated.View
              style={[styles.settingsScreen, { transform: [{ translateX: settingsScreenX }] }]}
            >
              <SafeAreaView style={styles.settingsSafe}>
                <View style={styles.settingsHeader}>
                  <TouchableOpacity
                    style={styles.settingsBackButton}
                    onPress={closeSettings}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.settingsBackIcon}>←</Text>
                  </TouchableOpacity>
                   <Text style={styles.settingsHeaderTitle}>{tr('about')}</Text>
                </View>
                <ScrollView
                  style={styles.settingsBody}
                  contentContainerStyle={styles.settingsBodyContent}
                >
                  <View style={styles.settingsHero}>
                     <Image source={APP_ICON_SOURCE} style={styles.heroAppIcon} resizeMode="contain" />
                     <Text style={styles.heroTitle}>{tr('weather')}</Text>
                     <Text style={styles.heroAuthor}>{tr('byAuthor')}</Text>
                     <Text style={styles.heroVersion}>{tr('version', { version: APP_VERSION })}</Text>
                  </View>
                    <Text style={styles.settingsSectionTitle}>{tr('settings')}</Text>
                    <View style={styles.cardStack}>
                       <View style={styles.aboutCard}>
                         <View style={[styles.aboutCardTextWrap, { flex: 1 }]}>
                           <Text style={styles.aboutCardTitle}>{tr('rememberCity')}</Text>
                           <Text style={styles.aboutCardDesc}>
                             {tr('rememberCityDesc')}
                           </Text>
                         </View>
                         <Switch
                           style={{ flexShrink: 0, alignSelf: 'center', marginLeft: 10 }}
                           value={rememberCity}
                           onValueChange={toggleRemember}
                           trackColor={{ false: switchTrackOff, true: theme.accent2 }}
                           thumbColor="#ffffff"
                           ios_backgroundColor={switchTrackOff}
                         />
                       </View>
                    </View>
                    <Text style={styles.settingsSectionTitle}>{tr('interface')}</Text>
                   <View style={styles.cardStack}>
                      <TouchableOpacity
                        style={styles.aboutCard}
                        onPress={openThemePicker}
                        activeOpacity={0.6}
                      >
                        <View style={styles.interfaceIconWrap}>
                          <Text style={styles.interfaceIconEmoji}>🎨</Text>
                        </View>
                        <View style={[styles.aboutCardTextWrap, { flex: 1 }]}>
                          <Text style={styles.aboutCardTitle}>{tr('appTheme')}</Text>
                          <Text style={styles.aboutCardDesc}>{currentThemeLabel}</Text>
                        </View>
                        <Text style={styles.settingsChevron}>›</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.aboutCard}
                        onPress={openLanguagePicker}
                        activeOpacity={0.6}
                      >
                        <View style={styles.interfaceIconWrap}>
                          <Text style={styles.interfaceIconEmoji}>🌐</Text>
                        </View>
                        <View style={[styles.aboutCardTextWrap, { flex: 1 }]}>
                          <Text style={styles.aboutCardTitle}>{tr('language')}</Text>
                          <Text style={styles.aboutCardDesc}>
                            {i18n.language === 'ru' ? tr('russian') : tr('english')}
                          </Text>
                        </View>
                        <Text style={styles.settingsChevron}>›</Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.settingsSectionTitle}>{tr('units')}</Text>
                    <View style={styles.cardStack}>
                      <TouchableOpacity
                        style={styles.aboutCard}
                        onPress={() => showUnitPicker('temp')}
                        activeOpacity={0.6}
                      >
                        <View style={styles.interfaceIconWrap}>
                          <Text style={styles.interfaceIconEmoji}>🌡️</Text>
                        </View>
                        <View style={[styles.aboutCardTextWrap, { flex: 1 }]}>
                          <Text style={styles.aboutCardTitle}>{tr('temperature')}</Text>
                          <Text style={styles.aboutCardDesc}>
                            {tr(TEMP_UNIT_OPTIONS.find((o) => o.value === tempUnit)?.labelKey ?? 'tempUnits.C.label')}
                          </Text>
                        </View>
                        <Text style={styles.settingsChevron}>›</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.aboutCard}
                        onPress={() => showUnitPicker('wind')}
                        activeOpacity={0.6}
                      >
                        <View style={styles.interfaceIconWrap}>
                          <Text style={styles.interfaceIconEmoji}>💨</Text>
                        </View>
                        <View style={[styles.aboutCardTextWrap, { flex: 1 }]}>
                          <Text style={styles.aboutCardTitle}>{tr('windSpeed')}</Text>
                          <Text style={styles.aboutCardDesc}>
                            {tr(WIND_UNIT_OPTIONS.find((o) => o.value === windUnit)?.labelKey ?? 'windUnits.kmh.label')}
                          </Text>
                        </View>
                        <Text style={styles.settingsChevron}>›</Text>
                      </TouchableOpacity>
                    </View>
                   <Text style={styles.settingsSectionTitle}>{tr('aboutProject')}</Text>
                   <View style={styles.cardStack}>
                     <TouchableOpacity
                       style={styles.aboutCard}
                       onPress={openGitHub}
                       activeOpacity={0.6}
                      >
                        <View style={styles.githubIconWrap}>
                          <GithubIcon size={22} color={theme.text} />
                        </View>
                        <View style={[styles.aboutCardTextWrap, { flex: 1 }]}>
                          <Text style={styles.aboutCardTitle}>{tr('sourceCode')}</Text>
                          <Text style={styles.aboutCardDesc}>
                            {tr('githubDesc')}
                          </Text>
                        </View>
                        <Text style={styles.settingsChevron}>›</Text>
                      </TouchableOpacity>
                  </View>
                </ScrollView>
                {themePickerVisible && (
                  <View style={styles.pickerLayer} pointerEvents="box-none">
                    <Animated.View style={[styles.pickerBackdrop, { opacity: pickerAnim }]}>
                      <TouchableOpacity
                        style={StyleSheet.absoluteFill}
                        activeOpacity={1}
                        onPress={closeThemePicker}
                      />
                    </Animated.View>
                    <Animated.View
                      style={[
                        styles.pickerCard,
                        {
                          opacity: pickerAnim,
                          transform: [
                            {
                              scale: pickerAnim.interpolate({
                                inputRange: [0, 1],
                                outputRange: [0.92, 1],
                              }),
                            },
                          ],
                        },
                      ]}
                    >
                      <Text style={styles.pickerTitle}>{tr('appTheme')}</Text>
                      {THEME_MODES.map((m) => {
                        const selected = m.value === themeMode;
                        return (
                          <TouchableOpacity
                            key={m.value}
                            style={styles.pickerOption}
                            onPress={() => selectThemeMode(m.value)}
                            activeOpacity={0.6}
                          >
                            <View
                              style={[styles.radioOuter, selected && { borderColor: theme.accent }]}
                            >
                              {selected && (
                                <View
                                  style={[styles.radioInner, { backgroundColor: theme.accent }]}
                                />
                              )}
                            </View>
                            <View style={styles.pickerOptionTextWrap}>
                              <Text style={styles.pickerOptionLabel}>{tr(m.labelKey)}</Text>
                              <Text style={styles.pickerOptionDesc}>{tr(m.descKey)}</Text>
                            </View>
                          </TouchableOpacity>
                        );
                       })}
                     </Animated.View>
                   </View>
                 )}
                 {unitPickerVisible && (
                   <View style={styles.pickerLayer} pointerEvents="box-none">
                     <Animated.View style={[styles.pickerBackdrop, { opacity: tempPickerAnim }]}>
                       <TouchableOpacity
                         style={StyleSheet.absoluteFill}
                         activeOpacity={1}
                         onPress={hideUnitPicker}
                       />
                     </Animated.View>
                     <Animated.View
                       style={[
                         styles.pickerCard,
                         {
                           opacity: tempPickerAnim,
                           transform: [
                             {
                               scale: tempPickerAnim.interpolate({
                                 inputRange: [0, 1],
                                 outputRange: [0.92, 1],
                               }),
                             },
                           ],
                         },
                       ]}
                     >
                        <Text style={styles.pickerTitle}>
                          {unitPickerMode === 'temp' ? tr('temperature') : tr('windSpeed')}
                        </Text>
                        {(unitPickerMode === 'temp' ? TEMP_UNIT_OPTIONS : WIND_UNIT_OPTIONS).map(
                          (o) => {
                            const selected =
                              (unitPickerMode === 'temp'
                                ? o.value === tempUnit
                                : o.value === windUnit) || false;
                            return (
                              <TouchableOpacity
                                key={o.value}
                                style={styles.pickerOption}
                                onPress={() => onSelectUnit(o.value)}
                                activeOpacity={0.6}
                              >
                                <View
                                  style={[styles.radioOuter, selected && { borderColor: theme.accent }]}
                                >
                                  {selected && (
                                    <View
                                      style={[styles.radioInner, { backgroundColor: theme.accent }]}
                                    />
                                  )}
                                </View>
                                <View style={styles.pickerOptionTextWrap}>
                                  <Text style={styles.pickerOptionLabel}>{tr(o.labelKey)}</Text>
                                  <Text style={styles.pickerOptionDesc}>{tr(o.descKey)}</Text>
                                </View>
                              </TouchableOpacity>
                            );
                          },
                        )}
                     </Animated.View>
                   </View>
                 )}
                   {languagePickerVisible && (
                     <View style={styles.pickerLayer} pointerEvents="box-none">
                       <Animated.View style={[styles.pickerBackdrop, { opacity: languagePickerAnim }]}>
                         <TouchableOpacity
                           style={StyleSheet.absoluteFill}
                           activeOpacity={1}
                           onPress={closeLanguagePicker}
                         />
                       </Animated.View>
                       <Animated.View
                         style={[
                           styles.pickerCard,
                           {
                             opacity: languagePickerAnim,
                             transform: [
                               {
                                 scale: languagePickerAnim.interpolate({
                                   inputRange: [0, 1],
                                   outputRange: [0.92, 1],
                                 }),
                               },
                             ],
                           },
                         ]}
                       >
                         <Text style={styles.pickerTitle}>{tr('language')}</Text>
                         {LANGUAGE_OPTIONS.map((lang) => {
                           const selected = lang.value === i18n.language;
                           return (
                             <TouchableOpacity
                               key={lang.value}
                               style={styles.pickerOption}
                               onPress={() => selectLanguage(lang.value)}
                               activeOpacity={0.6}
                             >
                               <View
                                 style={[styles.radioOuter, selected && { borderColor: theme.accent }]}
                               >
                                 {selected && (
                                   <View
                                     style={[styles.radioInner, { backgroundColor: theme.accent }]}
                                   />
                                 )}
                               </View>
                               <View style={styles.pickerOptionTextWrap}>
                                 <Text style={styles.pickerOptionLabel}>{tr(lang.labelKey)}</Text>
                               </View>
                             </TouchableOpacity>
                           );
                         })}
                       </Animated.View>
                     </View>
                   )}
                 </SafeAreaView>
            </Animated.View>
          </View>
        )}
        <PermissionModal
          visible={permissionModalVisible}
          onClose={() => setPermissionModalVisible(false)}
          onOpenSettings={() => {
            setPermissionModalVisible(false);
            Linking.openSettings();
          }}
          theme={theme}
          fs={fs}
        />
    </ScreenWrapper>
  );
}

function PermissionCard({ style, children, ...rest }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.92)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: 1,
        friction: 9,
        tension: 140,
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, scale]);

  return (
    // Forward the responder props so the inner TouchableWithoutFeedback can
    // keep card taps from falling through to the backdrop's close handler.
    <Animated.View {...rest} style={[style, { opacity, transform: [{ scale }] }]}>
      {children}
    </Animated.View>
  );
}

function PermissionModal({ visible, onClose, onOpenSettings, theme, fs }) {
  const { t: tr } = useTranslation();
  if (!visible) return null;
  return (
    <Modal transparent visible animationType="fade" statusBarTranslucent navigationBarTranslucent>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <TouchableWithoutFeedback>
            <PermissionCard style={{ width: '100%', maxWidth: 360, backgroundColor: theme.surfaceAlt || theme.background, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: theme.border || 'rgba(255,255,255,0.1)' }}>
              <Text style={{ fontSize: fs.base * 1.125, fontWeight: '600', color: theme.text, marginBottom: 8, textAlign: 'center' }}>{tr('permission_required')}</Text>
              <Text style={{ fontSize: fs.base * 0.9375, color: theme.textSecondary || theme.textMuted, marginBottom: 20, lineHeight: 20, textAlign: 'center' }}>{tr('location_permission_message')}</Text>
              <View style={{ flexDirection: 'column', gap: 10 }}>
                <PressableScale onPress={onOpenSettings} style={{ paddingVertical: 12, paddingHorizontal: 16, borderRadius: 8, backgroundColor: theme.accent, alignItems: 'center' }} scaleTo={0.97}>
                  <Text style={{ color: theme.onAccent || '#ffffff', fontSize: fs.base * 0.9375, fontWeight: '600' }}>{tr('open_settings')}</Text>
                </PressableScale>
                <PressableScale onPress={onClose} style={{ paddingVertical: 12, paddingHorizontal: 16, borderRadius: 8, alignItems: 'center' }} scaleTo={0.97}>
                  <Text style={{ color: theme.textMuted || theme.textSecondary, fontSize: fs.base * 0.9375, fontWeight: '500' }}>{tr('cancel')}</Text>
                </PressableScale>
              </View>
            </PermissionCard>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

function formatDay(iso) {
  const d = new Date(iso + 'T00:00:00');
  const locale = i18n.language === 'en' ? 'en-US' : 'ru-RU';
  return d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric' });
}

function formatCacheTime(ts) {
  try {
    const locale = i18n.language === 'en' ? 'en-US' : 'ru-RU';
    return new Date(ts).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}


const preloadStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#1c2333' },
  fill: { flex: 1 },
});

const buildStyles = (theme, fs, insets) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: theme.background },
    splash: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.background, alignItems: 'center', justifyContent: 'center' },
    splashIconWrap: { marginBottom: fs.spacing },
    splashText: { color: theme.textSecondary, fontSize: fs.small },
    title: { fontSize: fs.base * 2, fontWeight: '700', color: theme.text, textAlign: 'center', marginTop: 0, marginLeft: 0 },
    container: { flex: 1, position: 'relative', paddingHorizontal: fs.spacing },
    titleRow: { display: 'none' },
    gearButton: { width: fs.spacing * 2.75, height: fs.spacing * 3, alignItems: 'center', justifyContent: 'center', marginLeft: fs.spacing * 0.25 },
    gearIcon: { fontSize: fs.iconSize },
    menuBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-start', alignItems: 'flex-end', paddingTop: 60, paddingRight: 16 },
    dropdownMenu: { minWidth: 220, borderRadius: 16, borderWidth: 1, paddingVertical: 6, elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
    menuItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 18 },
    menuItemText: { fontSize: 16, fontWeight: '600' },
    menuDivider: { height: 1, width: '100%', marginVertical: 2 },
    searchBarContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.surface,
      borderRadius: 18,
      paddingHorizontal: fs.spacing * 0.75,
      height: fs.spacing * 3.125,
      marginTop: fs.spacing * 0.25,
      marginBottom: fs.spacing * 0.75,
      borderWidth: 1,
      borderColor: theme.border || 'rgba(255,255,255,0.08)',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.15,
      shadowRadius: 8,
      elevation: 4,
    },
    searchIconWrap: {
      paddingHorizontal: 4,
      justifyContent: 'center',
      alignItems: 'center',
    },
    inputWrap: {
      flex: 1,
      height: '100%',
      justifyContent: 'center',
      position: 'relative',
    },
    animatedPlaceholder: {
      position: 'absolute',
      left: fs.spacing * 0.5,
      color: theme.textMuted || 'rgba(255,255,255,0.4)',
      fontSize: fs.base,
    },
    searchInput: {
      flex: 1,
      height: '100%',
      color: theme.text,
      fontSize: fs.base,
      paddingHorizontal: fs.spacing * 0.5,
    },
    searchActionBtn: {
      padding: 6,
      borderRadius: 12,
      justifyContent: 'center',
      alignItems: 'center',
      marginLeft: 4,
    },
    searchRow: { flexDirection: 'row', alignItems: 'center', marginBottom: fs.spacing * 0.625, paddingTop: fs.spacing * 0.35 },
    input: { flex: 1, height: fs.spacing * 3, backgroundColor: theme.surface, borderRadius: 12, paddingHorizontal: fs.spacing * 0.875, color: theme.text, fontSize: fs.base, marginRight: fs.spacing * 0.5 },
    button: { height: fs.spacing * 3, paddingHorizontal: fs.spacing * 1.15, backgroundColor: theme.accent, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    locButton: { backgroundColor: theme.accent2, marginBottom: fs.spacing },
    buttonDisabled: { opacity: 0.5 },
    buttonText: { color: theme.onAccent, fontSize: fs.base, fontWeight: '600' },
    infoBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff9c4', borderRadius: 10, paddingVertical: fs.spacing * 0.625, paddingHorizontal: fs.spacing * 0.75, marginBottom: fs.spacing },
    infoBannerVpn: { backgroundColor: '#ffe0b2' },
    infoBannerOffline: { backgroundColor: '#fdecea' },
    infoBannerText: { flex: 1, color: '#4a3000', fontSize: fs.small, fontWeight: '600', marginRight: fs.spacing * 0.5 },
    infoBannerTextOffline: { color: '#7a1c1c' },
    bannerButton: { backgroundColor: '#4a3000', borderRadius: 8, paddingVertical: fs.spacing * 0.375, paddingHorizontal: fs.spacing * 0.625, marginRight: fs.spacing * 0.5 },
    bannerButtonText: { color: '#fff3cd', fontSize: fs.small, fontWeight: '700' },
    bannerClose: { padding: fs.spacing * 0.25 },
    bannerCloseText: { color: '#4a3000', fontSize: fs.base, fontWeight: '700' },
    center: { alignItems: 'center', justifyContent: 'center', flex: 1 },
    skyIconWrap: { marginBottom: fs.spacing },
    loadingText: { color: theme.textMuted, marginTop: fs.spacing * 0.625, fontSize: fs.base },
    hint: { color: theme.textMuted, fontSize: fs.base, textAlign: 'center' },
    result: { flex: 1 },
    resultContent: { paddingBottom: fs.spacing * 1.875 },
    cityName: { fontSize: fs.large * 1.15, fontWeight: '700', color: theme.text, textAlign: 'center' },
    subLabel: { fontSize: fs.small, color: theme.textMuted, textAlign: 'center', marginTop: fs.spacing * 0.125 },
    staleLabel: { fontSize: fs.small * 0.9, color: theme.textMuted, textAlign: 'center', marginTop: fs.spacing * 0.125, fontStyle: 'italic' },
    copiedHint: { fontSize: fs.small * 0.9, color: theme.textSecondary, textAlign: 'center', marginTop: fs.spacing * 0.125 },
    cityTime: { fontSize: fs.base, color: theme.textSecondary, textAlign: 'center', marginTop: fs.spacing * 0.25 },
    bigIconWrap: { alignItems: 'center', marginTop: fs.spacing },
    temperature: { fontSize: fs.large * 2.5, fontWeight: '300', color: theme.text, textAlign: 'center' },
    condition: { fontSize: fs.base * 1.25, color: theme.textSecondary, textAlign: 'center', marginBottom: fs.spacing },
    detailRow: { flexDirection: 'row', justifyContent: 'space-around', marginVertical: fs.spacing },
    detailCard: { backgroundColor: theme.surface, borderRadius: 12, paddingVertical: fs.spacing * 0.875, paddingHorizontal: fs.spacing * 1.25, alignItems: 'center', minHeight: fs.cardHeight * 0.7 },
    detailValue: { color: theme.text, fontSize: fs.base, fontWeight: '600' },
    detailLabel: { color: theme.textMuted, fontSize: fs.small, marginTop: fs.spacing * 0.25 },
    sectionTitle: { fontSize: fs.base * 1.125, fontWeight: '600', color: theme.text, marginTop: fs.spacing * 0.625, marginBottom: fs.spacing * 0.5 },
    forecastRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: theme.surfaceAlt, borderRadius: 8, paddingHorizontal: fs.spacing * 0.875, paddingVertical: fs.spacing * 0.625, marginBottom: fs.spacing * 0.375 },
    forecastDay: { color: theme.textSecondary, fontSize: fs.base * 0.9375, flex: 1, textAlign: 'left' },
    forecastIconCell: { width: 40, alignItems: 'center' },
    forecastTemp: { color: theme.text, fontSize: fs.base * 0.9375, fontWeight: '600', width: 90, textAlign: 'right' },
    hourlyRow: { gap: fs.spacing * 0.5, paddingBottom: fs.spacing * 0.25 },
    hourlyCard: { backgroundColor: theme.surfaceAlt, borderRadius: 10, paddingHorizontal: fs.spacing * 0.625, paddingVertical: fs.spacing * 0.5, alignItems: 'center', gap: fs.spacing * 0.25, minWidth: fs.spacing * 3.75 },
    hourlyTime: { color: theme.textSecondary, fontSize: fs.small * 0.95 },
    hourlyTemp: { color: theme.text, fontSize: fs.base * 0.9375, fontWeight: '600' },
    settingsLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100 },
    settingsDim: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.dim },
    settingsScreen: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.background },
    settingsSafe: { flex: 1 },
    settingsHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: fs.spacing, paddingTop: insets.top + fs.spacing * 0.5, paddingBottom: fs.spacing * 0.75, borderBottomWidth: 1, borderBottomColor: theme.border },
    settingsBackButton: { width: fs.spacing * 2.5, height: fs.spacing * 2.5, borderRadius: 12, backgroundColor: theme.surfaceRaised, alignItems: 'center', justifyContent: 'center', marginRight: fs.spacing * 0.625 },
    settingsBackIcon: { fontSize: fs.base * 1.375, color: theme.textSecondary },
    settingsHeaderTitle: { fontSize: fs.large * 1.15, fontWeight: '700', color: theme.text },
    settingsBody: { flex: 1 },
    settingsBodyContent: { paddingHorizontal: fs.spacing * 1.25, paddingTop: fs.spacing * 0.5, paddingBottom: fs.spacing * 2.125 },
    settingsHero: { alignItems: 'center', paddingTop: fs.spacing * 0.875, paddingBottom: fs.spacing * 0.5, marginBottom: fs.spacing },
    heroAppIcon: { width: fs.iconSize * 3.8, height: fs.iconSize * 3.8, borderRadius: 26, backgroundColor: '#FFFFFF', borderWidth: 0, marginBottom: fs.spacing * 0.75, alignItems: 'center', justifyContent: 'center', padding: fs.spacing },
    heroTitle: { fontSize: fs.large * 1.15, fontWeight: '700', color: theme.text },
    heroAuthor: { fontSize: fs.small, color: theme.textMuted, marginTop: fs.spacing * 0.25 },
    heroVersion: { fontSize: fs.small * 0.846, color: theme.textMuted, marginTop: fs.spacing * 0.125 },
    settingsSectionTitle: { fontSize: fs.small, fontWeight: '700', color: theme.textMuted, letterSpacing: 0.8, marginBottom: fs.spacing * 0.625, marginTop: fs.spacing * 1.375 },
    cardStack: { gap: fs.spacing * 0.625 },
    aboutCard: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: theme.surface, borderRadius: 16, paddingHorizontal: fs.spacing, paddingVertical: fs.spacing * 0.875, minHeight: 70 * fs.fontScale },
    aboutCardTextWrap: { flex: 1, marginRight: fs.spacing * 0.5, minWidth: 0 },
    aboutCardTitle: { fontSize: fs.base, fontWeight: '600', color: theme.text },
    aboutCardDesc: { fontSize: fs.small, color: theme.textMuted, marginTop: fs.spacing * 0.125, lineHeight: fs.small * 1.3 },
    interfaceIconWrap: {
      width: fs.spacing * 2.625, height: fs.spacing * 2.625, borderRadius: 12,
      backgroundColor: theme.background,
      alignItems: 'center', justifyContent: 'center',
      marginRight: fs.spacing * 0.75,
    },
    interfaceIconEmoji: { fontSize: fs.iconSize * 0.77 },
    githubIconWrap: {
      width: fs.spacing * 2.625, height: fs.spacing * 2.625, borderRadius: 12,
      backgroundColor: theme.background,
      alignItems: 'center', justifyContent: 'center',
      marginRight: fs.spacing * 0.75,
    },
    settingsChevron: { fontSize: fs.base * 1.5, color: theme.textMuted, marginLeft: 'auto', flexShrink: 0 },
    pickerLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: fs.spacing * 1.5 },
    pickerBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0, 0, 0, 0.45)' },
    pickerCard: { width: '100%', maxWidth: 360, backgroundColor: theme.surface, borderRadius: 20, borderWidth: 1, borderColor: theme.border, padding: fs.spacing * 1.125 },
    pickerTitle: { fontSize: fs.large * 1.15, fontWeight: '700', color: theme.text, marginBottom: fs.spacing * 0.75 },
    pickerOption: { flexDirection: 'row', alignItems: 'center', paddingVertical: fs.spacing * 0.6875 },
    radioOuter: { width: fs.spacing * 1.375, height: fs.spacing * 1.375, borderRadius: fs.spacing * 0.6875, borderWidth: 2, borderColor: theme.border, alignItems: 'center', justifyContent: 'center', marginRight: fs.spacing * 0.75 },
    radioInner: { width: fs.spacing * 0.625, height: fs.spacing * 0.625, borderRadius: fs.spacing * 0.3125 },
    pickerOptionTextWrap: { flex: 1 },
    pickerOptionLabel: { fontSize: fs.base, fontWeight: '600', color: theme.text },
    pickerOptionDesc: { fontSize: fs.small, color: theme.textMuted, marginTop: fs.spacing * 0.125 },
  });
