import { useState, useEffect, useLayoutEffect, useRef, useMemo, useContext, useCallback } from 'react';
import NetInfo from '@react-native-community/netinfo';
import * as Location from 'expo-location';
import {
  View,
  Text,
  StyleSheet,
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
  Linking,
  Modal,
  TouchableWithoutFeedback,
  Keyboard,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import ScreenWrapper from './ScreenWrapper';
import PressableScale from './components/PressableScale';
import FadeSlideIn from './components/FadeSlideIn';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRoute, useNavigation, useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import i18n from './i18n';
import { LoadingContext } from './LoadingContext';
import { SettingsContext } from './SettingsContext';
import { useFontSize } from './FontSizeContext';
import { useTheme } from './ThemeContext';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isOfflineError, isRegionLike, resolvePlaceName } from './geocoding';
import { fetchForecast, searchCity } from './utils/weatherProviders';
import { fetchJsonWithRetry, HttpError, isExternalAbortError } from './utils/http';
import { WeatherIcon, SunAnimation, FogAnimation } from './components/weather/WeatherIcons';
import {
  weathercodeToType,
  isNightHour,
  isCoordsLikeText,
  getHourlyTimeline,
  beaufortFromMs,
  convertWind,
  formatTemp,
  windDirectionKey,
  hpaToMmHg,
  computeWeeklyTempBounds,
  computeDayRangeFractions,
  extractCurrentExtras,
  computeCityClock,
} from './utils/weatherFormat';

const BASE_URL = 'https://api.open-meteo.com/v1/forecast';
const TIMEOUT_MS = 10000;
const SOURCE_NAMES = { '7timer': '7Timer', 'open-meteo': 'Open-Meteo', nominatim: 'Nominatim' };

const REMEMBER_CITY_ENABLED_KEY = 'remember_city_enabled';
const LAST_CITY_KEY = 'last_selected_city';
const LAST_WEATHER_KEY = 'last_weather_data';

const loadLastCity = async () => { try { return await AsyncStorage.getItem(LAST_CITY_KEY); } catch (e) { return null; } };
// Cache-First: last successfully loaded weather snapshot for instant display.
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
const loadRememberCity = async () => { try { const v = await AsyncStorage.getItem(REMEMBER_CITY_ENABLED_KEY); return v === null ? true : v === 'true'; } catch (e) { return true; } };

const makeFetchJson = (signal) => async (url) => {
  try {
    return await fetchJsonWithRetry(url, { timeoutMs: TIMEOUT_MS, signal });
  } catch (e) {
    if (isExternalAbortError(e)) throw e;
    if (e?.isTimeout || (e && e.name === 'AbortError')) {
      const err = new Error(i18n.t('serverTimeout'));
      err.kind = 'timeout';
      throw err;
    }
    if (e instanceof TypeError) {
      const err = new Error(i18n.t('noInternet'));
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

function formatWind(speedKmh, unit, directionDeg = null) {
  const v = convertWind(speedKmh, unit);
  if (v === null) return '–';
  let text;
  if (unit === 'beaufort') {
    text = `${beaufortFromMs(speedKmh / 3.6)} ${i18n.t('windLabels.beaufort')}`;
  } else if (unit === 'kmh') {
    text = `${Math.round(v)} ${i18n.t('windLabels.kmh')}`;
  } else {
    text = `${v.toFixed(1)} ${i18n.t(`windLabels.${unit}`) || i18n.t('windLabels.kmh')}`;
  }
  const dirKey = windDirectionKey(directionDeg);
  if (dirKey) {
    const dirLabel = i18n.t(`windDir.${dirKey}`);
    if (dirLabel && dirLabel !== `windDir.${dirKey}`) {
      return `${text} · ${dirLabel}`;
    }
  }
  return text;
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
  const { theme, loaded: themeLoaded } = useTheme();
  const insets = useSafeAreaInsets();
  const [isConnected, setIsConnected] = useState(null);
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
  const [permissionModalVisible, setPermissionModalVisible] = useState(false);
  const menuAnim = useRef(new Animated.Value(0)).current;

  // Monotonic request guard + active AbortController so rapid city switches
  // or background refreshes never overwrite newer user selections.
  const requestSeqRef = useRef(0);
  const abortControllerRef = useRef(null);
  const beginRequest = useCallback(() => {
    const seq = ++requestSeqRef.current;
    if (abortControllerRef.current) {
      try { abortControllerRef.current.abort(); } catch (e) {}
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;
    return { seq, signal: controller.signal };
  }, []);

  useEffect(() => () => {
    requestSeqRef.current += 1;
    if (abortControllerRef.current) {
      try { abortControllerRef.current.abort(); } catch (e) {}
    }
  }, []);

  const toggleMenu = useCallback(() => {
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
  }, [menuVisible, menuAnim]);

  const closeMenu = useCallback(() => {
    Animated.timing(menuAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => setMenuVisible(false));
  }, [menuAnim]);

  const menuScale = useMemo(
    () => menuAnim.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }),
    [menuAnim],
  );
  const menuOpacity = useMemo(
    () => menuAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }),
    [menuAnim],
  );

  const lastRequest = useRef(null);
  const weatherRef = useRef(null);
  const rememberRef = useRef(true);
  const splashOpacity = useRef(new Animated.Value(1)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const sunScale = useRef(new Animated.Value(1)).current;
  const sunRotate = useRef(new Animated.Value(0)).current;
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
  }, [city, placeholderAnim, clearButtonAnim]);

  const fs = useFontSize();
  const styles = useMemo(
    () => buildStyles(theme, fs || { spacing: 16, base: 16, small: 12, large: 20, iconSize: 24, cardHeight: 80 }, insets),
    [theme, fs, insets],
  );
  const route = useRoute();
  const navigation = useNavigation();
  const cityParam = route.params?.city ?? route.params?.selectedCity;
  const latParam = route.params?.latitude;
  const lonParam = route.params?.longitude;
  const countryParam = route.params?.country;
  const navTsParam = route.params?.ts;
  const appliedCityParam = useRef(null);
  const { setLoading: setAppLoading } = useContext(LoadingContext);
  const { tempUnit, windUnit, showSourceBadge } = useContext(SettingsContext);

  const refreshColors = useMemo(
    () => (theme.mode === 'light' ? ['#3573c2', '#25945a'] : ['#4a90d9', '#38b06b']),
    [theme.mode],
  );

  // Dismiss splash screen once timer elapses.
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsSplashVisible(false);
      setIsContentVisible(true);
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  // Only drive the loading/splash sun animation while it is actually on screen.
  const sunAnimActive = splashRendered || ((loading || locating) && !weather);
  useEffect(() => {
    if (!sunAnimActive) return;
    const spin = Animated.loop(
      Animated.timing(sunRotate, { toValue: 1, duration: 6000, easing: Easing.linear, useNativeDriver: true }),
    );
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(sunScale, { toValue: 1.15, duration: 900, useNativeDriver: true }),
        Animated.timing(sunScale, { toValue: 1, duration: 900, useNativeDriver: true }),
      ]),
    );
    spin.start();
    pulse.start();
    return () => {
      spin.stop();
      pulse.stop();
    };
  }, [sunAnimActive, sunRotate, sunScale]);

  useEffect(() => {
    let active = true;
    const init = async () => {
      // Read connection state + Cache-First storage keys in parallel for fast startup.
      const [netState, remember, saved, cached] = await Promise.all([
        NetInfo.fetch().catch(() => ({ isConnected: true })),
        loadRememberCity(),
        loadLastCity(),
        loadCachedWeather(),
      ]);
      if (!active) return;
      setIsConnected(!!netState.isConnected);
      rememberRef.current = remember;

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
      setIsConnected(!!state.isConnected);
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
      })();
    }, []),
  );

  useEffect(() => {
    if (!isSplashVisible) {
      Animated.timing(splashOpacity, { toValue: 0, duration: 500, useNativeDriver: true }).start(
        ({ finished }) => {
          if (finished) setSplashRendered(false);
        },
      );
    }
  }, [isSplashVisible, splashOpacity]);

  useEffect(() => {
    if (isContentVisible) {
      Animated.timing(contentOpacity, { toValue: 1, duration: 500, useNativeDriver: true }).start();
    }
  }, [isContentVisible, contentOpacity]);

  const openSettings = useCallback(() => {
    navigation.getParent()?.navigate('Settings');
  }, [navigation]);

  const applyFetchError = (e) => {
    if (isExternalAbortError(e)) return;
    if (e?.kind === 'timeout') {
      setError(null);
      setHostUnreachable(true);
    } else if (isOfflineError(e)) {
      setError(tr('noInternet'));
    } else {
      setError(e?.message || tr('weatherFetchFailed'));
    }
  };

  const geocode = async (query, fetchJson) => {
    const hit = await searchCity(query, i18n.language || 'ru', fetchJson);
    if (!hit) {
      throw new Error(tr('cityNotFound'));
    }
    if (isRegionLike(hit)) {
      throw new Error(tr('enterCityNotCountry'));
    }
    return hit;
  };

  const reverseGeocode = async (lat, lon, fetchJson) => {
    const resolved = await resolvePlaceName(lat, lon, i18n.language, fetchJson);
    return {
      name: resolved?.name || tr('currentLocation'),
      country: resolved?.country || '',
      latitude: lat,
      longitude: lon,
    };
  };

  // Canonical forecast via the provider layer: Open-Meteo full shape (with
  // real feels-like, humidity, pressure, wind direction & precipitation
  // probability in the SAME single request), automatic 7Timer fallback.
  const fetchWeather = async (lat, lon, fetchJson) => {
    return fetchForecast(
      lat,
      lon,
      fetchJson,
      `${BASE_URL}?latitude=${lat}&longitude=${lon}&current_weather=true&current=apparent_temperature,relative_humidity_2m,surface_pressure,precipitation_probability,wind_direction_10m&hourly=temperature_2m,weathercode,precipitation_probability&daily=weathercode,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max&timezone=auto`,
    );
  };

  // Load weather for an already-known place (from CityList / Phenomena)
  // without redundant geocoding.
  const loadKnownPlace = async (place, silent = false) => {
    const { seq, signal } = beginRequest();
    const fetchJson = makeFetchJson(signal);
    if (!silent) setLoading(true);
    setError(null);
    setHostUnreachable(false);
    lastRequest.current = { type: 'coords', lat: place.latitude, lon: place.longitude, query: place.name };
    try {
      const data = await fetchWeather(place.latitude, place.longitude, fetchJson);
      if (seq !== requestSeqRef.current) return;
      const savedAt = Date.now();
      const snapshot = { place, data, savedAt };
      weatherRef.current = snapshot;
      setWeather(snapshot);
      setIsStale(false);
      await saveCachedWeather({ place, data, query: place.name, savedAt });
      if (rememberRef.current && place.name) {
        await saveLastCity(place.name);
      }
      setCity('');
    } catch (e) {
      if (seq !== requestSeqRef.current || isExternalAbortError(e)) return;
      applyFetchError(e);
      if (!silent && !weatherRef.current) {
        setWeather(null);
      }
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  };

  // Scenario A: refresh by saved coordinates — pure Open-Meteo fetch,
  // never touches Location.*. Scenario B (geolocation) lives ONLY in
  // detectMyLocation(), called from the "my location" button / first launch.
  const loadByCoords = async (lat, lon, silent = false, warningMsg = null) => {
    const { seq, signal } = beginRequest();
    const fetchJson = makeFetchJson(signal);
    if (!silent) setLoading(true);
    setError(warningMsg);
    setHostUnreachable(false);
    lastRequest.current = { type: 'coords', lat, lon };
    try {
      const [place, data] = await Promise.all([
        reverseGeocode(lat, lon, fetchJson),
        fetchWeather(lat, lon, fetchJson),
      ]);
      if (seq !== requestSeqRef.current) return;
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
      if (seq !== requestSeqRef.current || isExternalAbortError(e)) return;
      applyFetchError(e);
      if (!silent) {
        weatherRef.current = null;
        setWeather(null);
      }
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  };

  const detectMyLocation = async () => {
    setLocating(true);
    setError(null);
    setHostUnreachable(false);
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
      const approxWarning = accuracy && accuracy > 1000 ? tr('approximateLocation') : null;
      await loadByCoords(latitude, longitude, false, approxWarning);
    } catch (e) {
      setError(tr('locationFailed'));
    } finally {
      setLocating(false);
    }
  };

  const doSearch = async (query, silent = false) => {
    const { seq, signal } = beginRequest();
    const fetchJson = makeFetchJson(signal);
    if (!silent) setLoading(true);
    setError(null);
    setHostUnreachable(false);
    lastRequest.current = { type: 'city', query };
    try {
      const place = await geocode(query, fetchJson);
      if (seq !== requestSeqRef.current) return;
      const data = await fetchWeather(place.latitude, place.longitude, fetchJson);
      if (seq !== requestSeqRef.current) return;
      const savedAt = Date.now();
      const snapshot = { place, data, savedAt };
      weatherRef.current = snapshot;
      setWeather(snapshot);
      setIsStale(false);
      await saveCachedWeather({ place, data, query, savedAt });
      if (typeof place.latitude === 'number' && typeof place.longitude === 'number') {
        lastRequest.current = { type: 'coords', lat: place.latitude, lon: place.longitude, query };
      }
      if (rememberRef.current) {
        await saveLastCity(query);
      }
      setCity('');
    } catch (e) {
      if (seq !== requestSeqRef.current || isExternalAbortError(e)) return;
      applyFetchError(e);
      if (!silent) {
        weatherRef.current = null;
        setWeather(null);
      }
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (!cityParam) return;
    const navKey = `${cityParam}|${latParam ?? ''}|${lonParam ?? ''}|${navTsParam ?? ''}`;
    if (appliedCityParam.current === navKey) return;
    appliedCityParam.current = navKey;
    if (typeof latParam === 'number' && typeof lonParam === 'number' && Number.isFinite(latParam) && Number.isFinite(lonParam)) {
      loadKnownPlace({
        name: cityParam,
        country: countryParam || '',
        latitude: latParam,
        longitude: lonParam,
      });
    } else {
      doSearch(cityParam);
    }
  }, [cityParam, latParam, lonParam, countryParam, navTsParam]);

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
  // displayed place and keep its name/country untouched.
  const refreshCurrentWeather = async (silent = false) => {
    const cur = weatherRef.current;
    if (!cur || !cur.place || typeof cur.place.latitude !== 'number' || typeof cur.place.longitude !== 'number') {
      return false;
    }
    const { seq, signal } = beginRequest();
    const fetchJson = makeFetchJson(signal);
    if (!silent) setLoading(true);
    setError(null);
    setHostUnreachable(false);
    try {
      const data = await fetchWeather(cur.place.latitude, cur.place.longitude, fetchJson);
      if (seq !== requestSeqRef.current) return false;
      const savedAt = Date.now();
      const snapshot = { place: cur.place, data, savedAt };
      weatherRef.current = snapshot;
      setWeather(snapshot);
      setIsStale(false);
      const q = lastRequest.current?.query ?? cur.place.name;
      lastRequest.current = { type: 'coords', lat: cur.place.latitude, lon: cur.place.longitude, query: q ?? null };
      await saveCachedWeather({ place: cur.place, data, query: q, savedAt });
      return true;
    } catch (e) {
      if (seq !== requestSeqRef.current || isExternalAbortError(e)) return false;
      applyFetchError(e);
      return false;
    } finally {
      if (!silent && seq === requestSeqRef.current) setLoading(false);
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
      const state = await NetInfo.fetch().catch(() => ({ isConnected: true }));
      setIsConnected(!!state.isConnected);
      // No gate: a lying "offline" must not disable Retry — the attempt
      // below proves reachability one way or the other.
      setHostUnreachable(false);
      setDismissedMsg(null);
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
      tabBarInactiveTintColor: '#94a3b8',
    });
  }, [isSplashVisible, themeLoaded, loading, locating, weather, theme, navigation]);

  const hourlyTimeline = useMemo(
    () => getHourlyTimeline(weather?.data),
    [weather?.data],
  );
  const weeklyBounds = useMemo(
    () => computeWeeklyTempBounds(weather?.data?.daily),
    [weather?.data?.daily],
  );
  const currentExtras = useMemo(
    () => extractCurrentExtras(weather?.data),
    [weather?.data],
  );
  const pressureDisplay = useMemo(() => {
    if (currentExtras.pressureHpa === null) return null;
    if (i18n.language === 'en') {
      return `${Math.round(currentExtras.pressureHpa)} ${tr('pressureUnitHpa')}`;
    }
    const mm = hpaToMmHg(currentExtras.pressureHpa);
    return mm !== null ? `${mm} ${tr('pressureUnitMmHg')}` : null;
  }, [currentExtras.pressureHpa, tr, i18n.language]);
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
                {currentType === 'clear' && !currentIsNight ? (
                  <SunAnimation size={100} />
                ) : currentType === 'fog' ? (
                  <FogAnimation size={100} />
                ) : (
                  <WeatherIcon type={currentType} isNight={currentIsNight} size={100} />
                )}
              </View>
              <CrossfadeValue
                style={styles.temperature}
                value={formatTemp(weather.data.current_weather?.temperature, tempUnit)}
              />
              <CrossfadeValue
                style={styles.condition}
                value={conditionFor(weather.data.current_weather?.weathercode)}
              />
              {currentExtras.feelsLike !== null && (
                <Text style={styles.feelsLikeText}>
                  {tr('feelsLike', { temp: formatTemp(currentExtras.feelsLike, tempUnit) })}
                </Text>
              )}
              <View style={styles.detailGrid}>
                <View style={styles.detailCard}>
                  <CrossfadeValue
                    style={styles.detailValue}
                    value={formatWind(weather.data.current_weather?.windspeed, windUnit, currentExtras.windDirection)}
                  />
                  <Text style={styles.detailLabel}>{tr('wind')}</Text>
                </View>
                <View style={styles.detailCard}>
                  <CrossfadeValue
                    style={styles.detailValue}
                    value={weather.data.current_weather?.is_day ? tr('day') : tr('night')}
                  />
                  <Text style={styles.detailLabel}>{tr('timeOfDay')}</Text>
                </View>
                {currentExtras.humidity !== null && (
                  <View style={styles.detailCard}>
                    <CrossfadeValue
                      style={styles.detailValue}
                      value={`${Math.round(currentExtras.humidity)}%`}
                    />
                    <Text style={styles.detailLabel}>{tr('humidity')}</Text>
                  </View>
                )}
                {pressureDisplay !== null && (
                  <View style={styles.detailCard}>
                    <CrossfadeValue
                      style={styles.detailValue}
                      value={pressureDisplay}
                    />
                    <Text style={styles.detailLabel}>{tr('pressure')}</Text>
                  </View>
                )}
              </View>
              {hourlyTimeline.length > 0 && (
                <>
                  <Text style={styles.sectionTitle}>{tr('hourlyForecast')}</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.hourlyRow}
                  >
                    {hourlyTimeline.map((item, idx) => {
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
                            {formatTemp(item.temp, tempUnit)}
                          </Text>
                          <WeatherIcon
                            type={weathercodeToType(item.code)}
                            isNight={isNightHour(item.time)}
                            size={26}
                          />
                          {typeof item.precipProb === 'number' && item.precipProb >= 20 ? (
                            <Text style={styles.hourlyPrecip} numberOfLines={1}>
                              {item.precipProb}%
                            </Text>
                          ) : null}
                          <Text style={styles.hourlyTime}>{idx === 0 ? tr('now') : String(item.time).slice(11, 16)}</Text>
                        </View>
                      );
                    })}
                  </ScrollView>
                </>
              )}
              <Text style={styles.sectionTitle}>{tr('weeklyForecast')}</Text>
              {weather.data.daily && Array.isArray(weather.data.daily.time) && weather.data.daily.time.map((day, i) => {
                const dayMin = weather.data.daily.temperature_2m_min?.[i];
                const dayMax = weather.data.daily.temperature_2m_max?.[i];
                const dayProb = weather.data.daily.precipitation_probability_max?.[i];
                const range = weeklyBounds
                  ? computeDayRangeFractions(dayMin, dayMax, weeklyBounds.min, weeklyBounds.max)
                  : null;
                return (
                  <View key={day} style={styles.forecastRow}>
                    <Text style={styles.forecastDay} numberOfLines={1}>{formatDay(day)}</Text>
                    <View style={styles.forecastIconCell}>
                      <WeatherIcon
                        type={weathercodeToType(weather.data.daily.weathercode?.[i])}
                        isNight={false}
                        size={26}
                      />
                      {typeof dayProb === 'number' && dayProb >= 20 ? (
                        <Text style={styles.forecastPrecip}>{Math.round(dayProb)}%</Text>
                      ) : null}
                    </View>
                    {range && (
                      <View style={styles.rangeBarTrack}>
                        <View
                          style={[
                            styles.rangeBarFill,
                            { left: `${range.leftPct}%`, width: `${range.widthPct}%` },
                          ]}
                        />
                      </View>
                    )}
                    <Text style={styles.forecastTemp} numberOfLines={1}>
                      {formatTemp(dayMin, tempUnit)} / {formatTemp(dayMax, tempUnit)}
                    </Text>
                  </View>
                );
              })}
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

const buildStyles = (theme, fs, insets) => {
  const isLight = theme.mode === 'light';
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: theme.background },
    splash: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.background, alignItems: 'center', justifyContent: 'center' },
    splashIconWrap: { marginBottom: fs.spacing },
    splashText: { color: theme.textSecondary, fontSize: fs.small },
    container: { flex: 1, position: 'relative', paddingHorizontal: fs.spacing },
    menuBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-start', alignItems: 'flex-end', paddingTop: insets.top + 52, paddingRight: 16 },
    dropdownMenu: { minWidth: 220, borderRadius: 16, borderWidth: 1, paddingVertical: 6, elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
    menuItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 18 },
    menuItemText: { fontSize: fs.base, fontWeight: '600' },
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
      shadowOpacity: isLight ? 0.08 : 0.15,
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
      color: theme.textMuted,
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
    infoBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: isLight ? '#fff8e1' : 'rgba(255, 193, 7, 0.14)',
      borderWidth: 1,
      borderColor: isLight ? '#ffe082' : 'rgba(255, 193, 7, 0.35)',
      borderRadius: 12,
      paddingVertical: fs.spacing * 0.625,
      paddingHorizontal: fs.spacing * 0.75,
      marginBottom: fs.spacing * 0.75,
    },
    infoBannerVpn: {
      backgroundColor: isLight ? '#fff3e0' : 'rgba(255, 159, 10, 0.15)',
      borderColor: isLight ? '#ffcc80' : 'rgba(255, 159, 10, 0.38)',
    },
    infoBannerOffline: {
      backgroundColor: isLight ? '#fdecea' : 'rgba(255, 69, 58, 0.15)',
      borderColor: isLight ? '#f5c2c0' : 'rgba(255, 69, 58, 0.38)',
    },
    infoBannerText: {
      flex: 1,
      color: isLight ? '#5c3c00' : '#ffe082',
      fontSize: fs.small,
      fontWeight: '600',
      marginRight: fs.spacing * 0.5,
    },
    infoBannerTextOffline: {
      color: isLight ? '#8a1c1c' : '#ff8a80',
    },
    bannerButton: {
      backgroundColor: theme.accent,
      borderRadius: 8,
      paddingVertical: fs.spacing * 0.375,
      paddingHorizontal: fs.spacing * 0.625,
      marginRight: fs.spacing * 0.5,
    },
    bannerButtonText: { color: theme.onAccent, fontSize: fs.small, fontWeight: '700' },
    bannerClose: { padding: fs.spacing * 0.25 },
    bannerCloseText: { color: theme.textSecondary, fontSize: fs.base, fontWeight: '700' },
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
    bigIconWrap: { alignItems: 'center', marginTop: fs.spacing * 0.85 },
    temperature: { fontSize: fs.large * 2.5, fontWeight: '300', color: theme.text, textAlign: 'center', fontVariant: ['tabular-nums'] },
    condition: { fontSize: fs.base * 1.2, color: theme.textSecondary, textAlign: 'center' },
    feelsLikeText: { fontSize: fs.small, color: theme.textMuted, textAlign: 'center', marginTop: fs.spacing * 0.2 },
    detailGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: fs.spacing * 0.625,
      marginVertical: fs.spacing,
    },
    detailCard: {
      flexGrow: 1,
      flexBasis: '45%',
      backgroundColor: theme.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.border,
      paddingVertical: fs.spacing * 0.75,
      paddingHorizontal: fs.spacing * 0.875,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: fs.cardHeight * 0.7,
    },
    detailValue: { color: theme.text, fontSize: fs.base, fontWeight: '600', textAlign: 'center', fontVariant: ['tabular-nums'] },
    detailLabel: { color: theme.textMuted, fontSize: fs.small, marginTop: fs.spacing * 0.2, textAlign: 'center' },
    sectionTitle: { fontSize: fs.base * 1.125, fontWeight: '600', color: theme.text, marginTop: fs.spacing * 0.625, marginBottom: fs.spacing * 0.5 },
    forecastRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.surfaceAlt,
      borderRadius: 10,
      paddingHorizontal: fs.spacing * 0.75,
      paddingVertical: fs.spacing * 0.6,
      marginBottom: fs.spacing * 0.375,
      gap: fs.spacing * 0.5,
    },
    forecastDay: { color: theme.textSecondary, fontSize: fs.base * 0.92, width: fs.spacing * 4.5, flexShrink: 0, textAlign: 'left' },
    forecastIconCell: { width: 38, alignItems: 'center', justifyContent: 'center' },
    forecastPrecip: { color: theme.accent, fontSize: Math.max(10, fs.small * 0.8), fontWeight: '700', marginTop: -2 },
    rangeBarTrack: {
      flex: 1,
      height: 5,
      borderRadius: 3,
      backgroundColor: theme.border,
      overflow: 'hidden',
      position: 'relative',
      minWidth: 36,
    },
    rangeBarFill: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      borderRadius: 3,
      backgroundColor: theme.accent,
    },
    forecastTemp: { color: theme.text, fontSize: fs.base * 0.92, fontWeight: '600', minWidth: 74, textAlign: 'right', fontVariant: ['tabular-nums'] },
    hourlyRow: { gap: fs.spacing * 0.5, paddingBottom: fs.spacing * 0.25 },
    hourlyCard: { backgroundColor: theme.surfaceAlt, borderRadius: 12, paddingHorizontal: fs.spacing * 0.625, paddingVertical: fs.spacing * 0.5, alignItems: 'center', gap: fs.spacing * 0.2, minWidth: fs.spacing * 3.75 },
    hourlyTime: { color: theme.textSecondary, fontSize: fs.small * 0.92, fontVariant: ['tabular-nums'] },
    hourlyTemp: { color: theme.text, fontSize: fs.base * 0.92, fontWeight: '600', fontVariant: ['tabular-nums'] },
    hourlyPrecip: { color: theme.accent, fontSize: Math.max(10, fs.small * 0.82), fontWeight: '700' },
  });
};
