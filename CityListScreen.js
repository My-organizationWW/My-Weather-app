import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import { View, Text, TextInput, FlatList, Alert, StatusBar, RefreshControl, StyleSheet, Animated as RNAnimated } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, useAnimatedReaction, withTiming, withSpring, Easing } from 'react-native-reanimated';
import ScreenWrapper from './ScreenWrapper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { CITIES_CHANGED_KEY } from './utils/citiesBackup';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from './ThemeContext';
import { useFontSize } from './FontSizeContext';
import { useSettings } from './SettingsContext';
import { useTranslation } from 'react-i18next';
import * as Location from 'expo-location';
import { isOfflineError, isRegionLike, resolvePlaceName } from './geocoding';
import { fetchForecast, searchCity } from './utils/weatherProviders';
import { fetchJsonWithRetry, isExternalAbortError } from './utils/http';
import { acquireCurrentPosition } from './utils/locationHelper';
import ConfirmDeleteModal from './ConfirmDeleteModal';
import DraggableCityCard from './DraggableCityCard';
import CurrentLocationCard from './CurrentLocationCard';
import PressableScale from './components/PressableScale';
import FadeSlideIn from './components/FadeSlideIn';
import { getPluralSelectedText } from './utils/plural';

const SAVED_CITIES_KEY = 'saved_cities_list';
const LAST_SELECTED_CITY_KEY = 'last_selected_city';
const CONFIRM_DELETE_KEY = 'confirm_delete_enabled';
const BASE_URL = 'https://api.open-meteo.com/v1/forecast';
const FETCH_TIMEOUT_MS = 15000;

function makeCityFetchJson(signal, timeoutMs = FETCH_TIMEOUT_MS, retries = 1) {
  return (url) => fetchJsonWithRetry(url, { timeoutMs, retries, signal });
}

// Pulsing placeholder shown only when there is genuinely nothing cached
// yet (first launch / wiped storage). Module-level identity keeps the
// pulse loop stable across parent re-renders; renders instead of the
// FlatList branch, so it never meets the drag system.
function SkeletonCard({ theme, fs }) {
  // RNAnimated (react-native), NOT Reanimated's Animated: a plain
  // opacity pulse needs no worklets. Aliased import — the Reanimated
  // default import above owns the bare `Animated` name.
  const pulse = useRef(new RNAnimated.Value(0.35)).current;
  useEffect(() => {
    const loop = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(pulse, { toValue: 1, duration: 750, useNativeDriver: true }),
        RNAnimated.timing(pulse, { toValue: 0.35, duration: 750, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const bar = { backgroundColor: theme.border, borderRadius: 8 };
  return (
    <RNAnimated.View
      style={{
        opacity: pulse,
        backgroundColor: theme.surfaceRaised,
        borderRadius: 28,
        paddingHorizontal: fs.spacing * 1.25,
        paddingVertical: fs.spacing,
        minHeight: fs.cardHeight * 1.375,
        marginBottom: fs.spacing,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}
    >
      <View style={{ flex: 0.65 }}>
        <View style={[bar, { width: '70%', height: fs.base * 1.1, marginBottom: 8 }]} />
        <View style={[bar, { width: '45%', height: fs.small }]} />
      </View>
      <View style={[bar, { width: fs.spacing * 3, height: fs.spacing * 3, borderRadius: 16 }]} />
    </RNAnimated.View>
  );
}

// FlatList wraps every row in its own cell. All movement is applied to the
// CELL itself, not to the card inside it. This matters for touch handling:
// Android clips hit-testing to each cell's own layout box, so a card shifted
// by a transform inside a stationary cell becomes untouchable at its visual
// position (and its old position swallows taps). Moving the cell moves both
// the drawing AND the hit box with it, so every card stays tappable after any
// number of reorders.
//
// The list still keeps a stable render order (cells never move in layout), so
// committing a reorder produces no native layout pass and therefore no drag
// flicker. Only transforms on the UI thread change.
const NEIGHBOUR_SPRING = { damping: 22, stiffness: 220, mass: 0.8 };
const DragCellContext = React.createContext(null);

function DragCell({ item, index, cellKey, style, children, ...props }) {
  const ctx = React.useContext(DragCellContext);
  const itemId = item?.id ?? cellKey;
  const slotShift = useSharedValue(0);
  const slotTarget = useSharedValue(0);

  // Same slot math as before, moved from the card to its cell.
  useAnimatedReaction(
    () => {
      if (!ctx) return 0;
      const pos = ctx.order.value.indexOf(itemId);
      if (pos < 0) return 0;
      let slot = pos;
      const from = ctx.activeIndex.value;
      if (ctx.activeId.value !== null && ctx.activeId.value !== itemId && from >= 0) {
        const offset = ctx.dragOffset.value;
        const stride = ctx.stride;
        const steps = offset >= 0
          ? Math.floor((offset + stride * 0.5) / stride)
          : -Math.floor((-offset + stride * 0.5) / stride);
        const to = Math.max(0, Math.min(ctx.itemCount - 1, from + steps));
        if (pos > from && pos <= to) slot = pos - 1;
        else if (pos < from && pos >= to) slot = pos + 1;
      }
      return (slot - index) * ctx.stride;
    },
    (target) => {
      if (!ctx) return;
      if (target === slotTarget.value) return;
      slotTarget.value = target;
      slotShift.value = ctx.activeId.value !== null
        ? withSpring(target, NEIGHBOUR_SPRING)
        : target;
    },
    [index, itemId, ctx],
  );

  const cellStyle = useAnimatedStyle(() => {
    const isActive = Boolean(ctx && ctx.activeId.value !== null && ctx.activeId.value === itemId);
    let y = slotShift.value;
    if (isActive) {
      // Active card: committed slot + live finger delta.
      const pos = ctx.order.value.indexOf(itemId);
      const resting = pos >= 0 ? (pos - index) * ctx.stride : 0;
      y = resting + ctx.dragOffset.value;
    }
    return {
      zIndex: isActive ? 99999 : 1,
      elevation: isActive ? 50 : 0,
      transform: [{ translateY: y }],
    };
  });

  return (
    <Animated.View {...props} style={[style, cellStyle]}>
      {children}
    </Animated.View>
  );
}

export default function CityListScreen() {
  const navigation = useNavigation();
  const { theme } = useTheme();
  const fs = useFontSize();
  const { tempUnit } = useSettings();
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const mountedRef = useRef(true);
  const refreshSeqRef = useRef(0);
  const refreshAbortRef = useRef(null);

  useEffect(() => () => {
    mountedRef.current = false;
    refreshSeqRef.current += 1;
    if (refreshAbortRef.current) {
      try { refreshAbortRef.current.abort(); } catch (e) {}
    }
  }, []);

  // Saved cities ONLY — the geolocation card lives in `currentLocation`
  // and is never part of this array (not draggable, selectable or deletable).
  const [cities, setCities] = useState([]);
  // Device geolocation weather card. null = unavailable/denied -> no card at all.
  const [currentLocation, setCurrentLocation] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // The heavy native subtree (FlatList + Reanimated cards + gestures)
  // mounts only after the push transition: its UI-thread inflation cost
  // during the animation window starves both screens of frames, exposing
  // the window background as a grey strip. First paint is header + search
  // only — same weight class as the (smooth) Settings screen.
  const [listMounted, setListMounted] = useState(false);
   const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedCities, setSelectedCities] = useState(new Set());
  const [deleteTarget, setDeleteTarget] = useState(null);
  // Delete-confirmation switch from Settings (default ON).
  const [confirmDelete, setConfirmDelete] = useState(true);
  // True while a drag gesture is active — FlatList scrolling is locked for
  // that time so the scroll view never fights the pan gesture (that fight
  // shows up as jitter of the whole list mid-drag).
  const [isDragging, setIsDragging] = useState(false);
  // FlatList cell index of the dragged card (-1 = none). Only used to lift
  // that cell above its siblings (see DragCell).
  const [dragBase, setDragBase] = useState(-1);

  const CARD_HEIGHT = 90;

  // Slot (position in `order`) of the dragged card. Written only from the
  // gesture worklets, so it never lags behind the UI thread.
  const activeIndex = useSharedValue(-1);
  const dragOffset = useSharedValue(0);
  // Stable identity of the dragged card (item id survives reorder, unlike
  // the numeric index — see DraggableCityCard).
  const activeId = useSharedValue(null);
  // Drag telemetry ring for offline jitter analysis (see utils/dragTrace).
  const trace = useSharedValue([]);
  // 1 = finger up: neighbour thresholds are frozen, cards only ease back.
  // Set synchronously in onStart/onEnd (zero bridge delay).
  const released = useSharedValue(1);
  const positionsRef = useRef([]);

  // Mutable mirror of the list: the drag gesture object must stay identical
  // across background setCities calls (weather refresh landing mid-drag),
  // otherwise RNGH restarts the active gesture and the card jumps. A plain
  // ref object would be serialized stale into the UI-runtime closure, so the
  // pattern is: stable useCallback (empty deps) + ref read at call time on
  // the JS thread — always fresh data, never a recreated gesture.
  const citiesRef = useRef(cities);
  citiesRef.current = cities;

  // Visual order of the cards (ids) on the UI thread.
  const order = useSharedValue([]);

  // Exact card stride (card height + gap) used by the cell shift math.
  const cardStride = Math.round(fs.cardHeight * 1.375) + fs.spacing;

  // Everything a cell needs to compute its visual slot on the UI thread.
  const dragCellValue = useMemo(
    () => ({
      order,
      activeId,
      activeIndex,
      dragOffset,
      itemCount: cities.length,
      stride: cardStride,
    }),
    [order, activeId, activeIndex, dragOffset, cities.length, cardStride],
  );

  // Search row collapse/expand. Animating its height (instead of unmounting
  // it) prevents the one-frame overlap/jump that looked like flicker when
  // entering or leaving selection mode.
  const searchRowHeight = Math.round(fs.spacing * 3.5 + 8);
  const searchRowProgress = useSharedValue(isSelectionMode ? 0 : 1);
  useEffect(() => {
    searchRowProgress.value = withTiming(isSelectionMode ? 0 : 1, {
      duration: 260,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
    });
  }, [isSelectionMode]);
  const searchRowAnimStyle = useAnimatedStyle(() => ({
    height: searchRowProgress.value * searchRowHeight,
    opacity: searchRowProgress.value,
  }));

  // Delete bar. It stays mounted for the whole screen lifetime and is only
  // faded/slid by a shared value. Mounting/unmounting an Animated.View with
  // entering/exiting layout animations races the first frame on Android and
  // occasionally showed the bar at full opacity for one frame (visible
  // flicker). A persistent view driven by useAnimatedStyle has no such race.
  const showDeleteBar = isSelectionMode && selectedCities.size > 0;
  const deleteBarProgress = useSharedValue(0);
  useEffect(() => {
    deleteBarProgress.value = withTiming(showDeleteBar ? 1 : 0, {
      duration: showDeleteBar ? 220 : 160,
      easing: showDeleteBar ? Easing.out(Easing.quad) : Easing.in(Easing.quad),
    });
  }, [showDeleteBar]);
  const deleteBarAnimStyle = useAnimatedStyle(() => ({
    opacity: deleteBarProgress.value,
    transform: [{ translateY: (1 - deleteBarProgress.value) * 70 }],
  }));

  // Header title ("Управление городами" <-> "N объектов"). The label itself
  // has to swap the instant the mode changes, so instead of a crossfade we
  // blank it for one frame and fade the new text in. useLayoutEffect (not
  // useEffect) is what makes that work: it runs before the commit reaches the
  // screen, so the first painted frame of the new label is already at
  // opacity 0 — no flash of the old/new string side by side.
  const headerTitleProgress = useSharedValue(1);
  const headerTitleMounted = useRef(false);
  useLayoutEffect(() => {
    if (!headerTitleMounted.current) {
      headerTitleMounted.current = true;
      return;
    }
    headerTitleProgress.value = 0;
    headerTitleProgress.value = withTiming(1, {
      duration: 180,
      easing: Easing.out(Easing.quad),
    });
  }, [isSelectionMode]);
  const headerTitleAnimStyle = useAnimatedStyle(() => ({
    opacity: headerTitleProgress.value,
  }));

  // Stable cell order: cells in FlatList stay in their original render positions,
  // so committing a reorder NEVER triggers a native layout re-render pass (0px jump/flicker).
  // All card positioning is handled with exact pixel precision via Reanimated transforms.
  const renderOrderRef = useRef([]);
  const renderList = useMemo(() => {
    const byId = new Map(cities.map((c) => [c.id, c]));
    const prev = renderOrderRef.current;
    const sameSet = prev.length === cities.length && prev.every((id) => byId.has(id));
    const ids = sameSet ? prev : cities.map((c) => c.id);
    renderOrderRef.current = ids;
    return ids.map((id) => byId.get(id));
  }, [cities]);

  useLayoutEffect(() => {
    order.value = cities.map((c) => c.id);
  }, [cities]);

  const onReorder = useCallback(async (fromIndex, toIndex) => {
    const list = citiesRef.current;
    if (fromIndex < 0 || toIndex < 0 || toIndex >= list.length) return;
    const newCities = [...list];
    const [moved] = newCities.splice(fromIndex, 1);
    newCities.splice(toIndex, 0, moved);
    setCities(newCities);
    await AsyncStorage.setItem(SAVED_CITIES_KEY, JSON.stringify(newCities));
  }, []);

  // Stable drag-lifecycle entries for the gesture (all empty-deps, so the
  // gesture object is created once and never restarted mid-drag). The drag
  // shared values are reset by the card's landing worklet, not here.
  const beginDrag = useCallback((i) => {
    setDragBase(i);
    setIsDragging(true);
  }, []);
  const endDrag = useCallback(() => {
    setDragBase(-1);
    setIsDragging(false);
  }, []);
  const commitReorder = useCallback((fromIndex, toIndex) => {
    onReorder(fromIndex, toIndex);
    setDragBase(-1);
    setIsDragging(false);
  }, [onReorder]);

  const styles = useMemo(() => StyleSheet.create({
    safe: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: fs.spacing,
      paddingTop: 0,
      paddingBottom: 4,
      borderBottomWidth: 1,
    },
    backButton: {
      width: fs.iconSize * 1.35,
      height: fs.iconSize * 1.35,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerTitle: {
      fontSize: fs.large,
      fontWeight: '700',
      marginLeft: fs.spacing * 0.75,
      flex: 1,
      flexShrink: 1,
    },
    searchRow: {
      flexDirection: 'row',
      paddingHorizontal: fs.spacing,
      paddingTop: fs.spacing * 0.5,
      paddingBottom: 8,
      alignItems: 'center',
      overflow: 'hidden',
    },
    input: {
      flex: 1,
      height: fs.spacing * 3,
      borderRadius: 16,
      borderWidth: 1,
      paddingHorizontal: fs.spacing,
      fontSize: fs.base,
    },
    addButton: {
      width: fs.spacing * 3,
      height: fs.spacing * 3,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: fs.spacing * 0.625,
    },
    listContainer: {
      paddingHorizontal: fs.spacing,
      paddingTop: 0,
      paddingBottom: fs.spacing * 1.75,
    },
    // Fixed geolocation layer above the list. Android draw order is global
    // by elevation (card itself gets 32 > dragged card's 30); iOS stacks
    // siblings by zIndex, so 30 wins over the whole FlatList subtree.
    locationHeader: {
      paddingHorizontal: fs.spacing,
      paddingTop: fs.spacing * 0.5,
      zIndex: 30,
    },
    // Section titles («Текущее местоположение», «Сохранённые города»).
    // Чистые стили, на драг не влияют.
    sectionHeader: {
      paddingHorizontal: 4,
      paddingTop: fs.spacing * 0.5,
      paddingBottom: 6,
    },
    sectionHeaderText: {
      fontSize: fs.small,
      fontWeight: '600',
      color: theme.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    emptyListText: {
      fontSize: fs.base,
      color: theme.textMuted,
      textAlign: 'center',
      marginTop: fs.spacing * 1.5,
    },
    cardContainer: {
      marginBottom: fs.spacing,
      borderRadius: 28,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: 'rgba(255, 255, 255, 0.15)',
      borderTopColor: 'rgba(255, 255, 255, 0.35)',
      elevation: 8,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.25,
      shadowRadius: 12,
    },
    cardContainerLight: {
      borderColor: 'rgba(255, 255, 255, 0.85)',
      elevation: 3,
      shadowColor: '#64748b',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.1,
      shadowRadius: 8,
    },
    blurContainer: {
      flex: 1,
      borderRadius: 28,
      overflow: 'hidden',
      width: '100%',
      height: '100%',
    },
    cardGradient: {
      borderRadius: 28,
      overflow: 'hidden',
    },
    cardBody: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: fs.spacing * 1.25,
      paddingVertical: fs.spacing,
      minHeight: fs.cardHeight * 1.375,
    },
    cardLeft: {
      flex: 0.65,
      justifyContent: 'center',
      paddingRight: fs.spacing * 0.5,
    },
    cardRight: {
      flex: 0.35,
      alignItems: 'flex-end',
      justifyContent: 'center',
    },

    cityName: {
      fontSize: fs.large * 1.1,
      fontWeight: '800',
      color: '#FFFFFF',
      marginBottom: 4,
      letterSpacing: 0.3,
    },
    cityCondition: {
      fontSize: fs.small * 1.05,
      color: 'rgba(255, 255, 255, 0.8)',
      fontWeight: '500',
      flexShrink: 1,
    },
    conditionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    // Xiaomi-style temp block, right-pinned like min/max: right edges
    // coincide, so every "°" lands exactly above the last min/max "°".
    // Proportions match Xiaomi too: min/max is ~1/3 of the big temp, so the
    // bottom line is as wide as (or wider than) the top one and the top
    // digits never stick out past the bottom width.
    cityTemp: {
      fontSize: fs.large * 1.95,
      fontWeight: '700',
      color: '#FFFFFF',
      lineHeight: fs.large * 2.15,
      textAlign: 'right',
      fontVariant: ['tabular-nums'],
    },
    tempRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
    },
    // Separate degree mark, glued to the digit (marginLeft 1), its ring
    // top flush with the digit cap height (small positive marginTop).
    // Glued => can't drift away on its own.
    tempDegree: {
      fontSize: fs.large * 1.1,
      fontWeight: '700',
      marginTop: 4,
      marginLeft: 1,
    },
    cityMinMax: {
      fontSize: fs.small * 1.25,
      color: 'rgba(255, 255, 255, 0.7)',
      marginTop: 2,
      fontWeight: '600',
      textAlign: 'right',
      fontVariant: ['tabular-nums'],
    },
    checkbox: {
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    batchBottomBar: {
      position: 'absolute',
      bottom: Math.max(insets.bottom, 12) + 8,
      left: 0,
      right: 0,
      alignItems: 'center',
      justifyContent: 'center',
      pointerEvents: 'box-none',
      zIndex: 90,
    },
    batchDeleteButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingHorizontal: fs.spacing * 1.5,
      paddingVertical: fs.spacing * 0.75,
      borderRadius: 26,
      backgroundColor: 'rgba(255, 59, 48, 0.85)',
      borderWidth: 1,
      borderColor: 'rgba(255, 255, 255, 0.3)',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.35,
      shadowRadius: 14,
      elevation: 14,
    },
    batchDeleteText: {
      color: '#FFFFFF',
      fontSize: fs.base * 1.05,
      fontWeight: '700',
      letterSpacing: 0.2,
    },
  }), [theme, fs, insets]);

  useEffect(() => {
    // Deferred past the first frames so the push transition owns them
    // (double requestAnimationFrame replaces the deprecated
    // InteractionManager.runAfterInteractions — same effect, no warning).
    // Storage read is fast, so the cached list paints almost instantly;
    // network refresh lands in the background afterwards. Cancelled on
    // unmount/language switch.
    let cancelled = false;
    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (cancelled) return;
        setListMounted(true);
        loadSavedCitiesAndRefresh();
        loadCurrentLocation();
        (async () => {
          try {
            const v = await AsyncStorage.getItem(CONFIRM_DELETE_KEY);
            setConfirmDelete(v === null ? true : v === 'true');
          } catch (e) {}
        })();
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [i18n.language]);

  // Import happened in Settings (list replaced on disk): reload once on
  // return. Runs in the background over the visible cached list, so no
  // spinner flash. Flag consumed here, set in citiesBackup.importCities.
  useFocusEffect(
    useCallback(() => {
      (async () => {
        try {
          const dirty = await AsyncStorage.getItem(CITIES_CHANGED_KEY);
          if (dirty === '1') {
            await AsyncStorage.removeItem(CITIES_CHANGED_KEY);
            loadSavedCitiesAndRefresh();
          }
        } catch (e) {}
      })();
    }, [])
  );

  const fetchWeatherForCoords = async (lat, lon, fetchJson) => {
    const weatherData = await fetchForecast(
      lat,
      lon,
      fetchJson,
      `${BASE_URL}?latitude=${lat}&longitude=${lon}&current_weather=true&daily=temperature_2m_max,temperature_2m_min,weathercode&timezone=auto`
    );
    if (!weatherData || !weatherData.current_weather) return null;
    const rawTemp = weatherData.current_weather.temperature;
    const tempC = typeof rawTemp === 'number' && Number.isFinite(rawTemp) ? rawTemp : null;
    const rawMin = weatherData.daily?.temperature_2m_min?.[0];
    const rawMax = weatherData.daily?.temperature_2m_max?.[0];
    const minC = typeof rawMin === 'number' && Number.isFinite(rawMin) ? rawMin : null;
    const maxC = typeof rawMax === 'number' && Number.isFinite(rawMax) ? rawMax : null;
    const code = weatherData.current_weather.weathercode;
    const isNight = weatherData.current_weather.is_day === 0;
    return {
      tempC,
      minC,
      maxC,
      temp: tempC !== null ? `${Math.round(tempC)}` : '–',
      minMax: minC !== null && maxC !== null ? `${Math.round(maxC)}° / ${Math.round(minC)}°` : '',
      condition: getWeatherConditionText(code),
      weathercode: code,
      isNight,
    };
  };

  const loadSavedCitiesAndRefresh = async () => {
    const seq = ++refreshSeqRef.current;
    if (refreshAbortRef.current) {
      try { refreshAbortRef.current.abort(); } catch (e) {}
    }
    const controller = new AbortController();
    refreshAbortRef.current = controller;
    const fetchJson = makeCityFetchJson(controller.signal, FETCH_TIMEOUT_MS, 1);
    const probeFetch = makeCityFetchJson(controller.signal, 5000, 0);

    try {
      const data = await AsyncStorage.getItem(SAVED_CITIES_KEY);
      if (!mountedRef.current || seq !== refreshSeqRef.current) return;
      let list = [];
      if (data) {
        try {
          list = JSON.parse(data);
        } catch (e) {
          list = [];
        }
      } else {
        list = [
          { id: '1', name: 'Москва', latitude: 55.7558, longitude: 37.6173 },
          { id: '2', name: 'Санкт-Петербург', latitude: 59.9343, longitude: 30.3351 },
          { id: '3', name: 'Сочи', latitude: 43.5974, longitude: 39.7154 },
        ];
      }

      // Deduplicate loaded cities by normalized name and ensure unique IDs
      if (Array.isArray(list)) {
        const seenNames = new Set();
        const seenIds = new Set();
        list = list.filter((city) => {
          if (!city || !city.name) return false;
          const normName = city.name.trim().toLowerCase();
          if (seenNames.has(normName)) return false;
          seenNames.add(normName);
          return true;
        }).map((city, idx) => {
          let id = String(city.id ?? `city_${idx}`);
          if (seenIds.has(id)) {
            id = `${id}_${idx}`;
          }
          seenIds.add(id);
          return { ...city, id };
        });
      }
      if (list.length > 0) {
        setCities(list);
      } else {
        setIsLoading(true);
      }

      const currentLang = i18n.language || 'ru';
      const showStored = () => {
        if (mountedRef.current && seq === refreshSeqRef.current) setCities(list);
      };
      try {
        await fetchForecast(
          55.75,
          37.61,
          probeFetch,
          `${BASE_URL}?latitude=55.75&longitude=37.61&current_weather=true&timezone=auto`
        );
      } catch (e) {
        if (isExternalAbortError(e)) return;
        showStored();
        return;
      }
      if (!mountedRef.current || seq !== refreshSeqRef.current) return;

      let circuitOpen = false;
      const updatedList = [];
      for (const city of list) {
        if (!mountedRef.current || seq !== refreshSeqRef.current) return;
        if (circuitOpen) {
          updatedList.push(city);
          continue;
        }
        try {
          let lat = city.latitude;
          let lon = city.longitude;
          if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) {
            const hit = await searchCity(city.name, currentLang, fetchJson);
            if (hit && !isRegionLike(hit)) {
              lat = hit.latitude;
              lon = hit.longitude;
            }
          }

          if (typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon)) {
            const enrichment = await fetchWeatherForCoords(lat, lon, fetchJson);
            if (enrichment) {
              updatedList.push({
                ...city,
                latitude: lat,
                longitude: lon,
                name: city.name,
                ...enrichment,
              });
              continue;
            }
          }
        } catch (e) {
          if (isExternalAbortError(e)) return;
          if (!isOfflineError(e)) {
            console.warn(`Failed to refresh city ${city.name}:`, e?.message || e);
          } else {
            circuitOpen = true;
          }
        }
        updatedList.push(city);
      }

      if (!mountedRef.current || seq !== refreshSeqRef.current) return;
      const byId = new Map(updatedList.map(c => [c.id, c]));
      const merged = citiesRef.current.map(c => byId.get(c.id) ?? c);
      setCities(merged);
      await AsyncStorage.setItem(SAVED_CITIES_KEY, JSON.stringify(merged));
    } catch (e) {
      if (!isExternalAbortError(e)) console.error(e);
    } finally {
      if (mountedRef.current && seq === refreshSeqRef.current) {
        setIsLoading(false);
        setRefreshing(false);
      }
    }
  };

  // GEOLOCATION STREAM (top card). Uses requestPermission: false so opening
  // CityList never spams an OS permission dialog when previously denied.
  const loadCurrentLocation = async () => {
    try {
      const res = await acquireCurrentPosition(Location, {
        requestPermission: false,
        singleShotTimeoutMs: 5000,
        watchTimeoutMs: 6000,
      });
      if (res.status !== 'granted' || !res.position?.coords || !mountedRef.current) {
        if (mountedRef.current) setCurrentLocation(null);
        return;
      }
      const { latitude, longitude } = res.position.coords;
      const currentLang = i18n.language || 'ru';
      const locFetch = makeCityFetchJson(refreshAbortRef.current?.signal, FETCH_TIMEOUT_MS, 1);
      const revFetch = makeCityFetchJson(refreshAbortRef.current?.signal, 4000, 0);
      const [enrichment, resolved] = await Promise.all([
        fetchWeatherForCoords(latitude, longitude, locFetch),
        resolvePlaceName(latitude, longitude, currentLang, revFetch),
      ]);
      if (!mountedRef.current) return;
      if (!enrichment) {
        setCurrentLocation(null);
        return;
      }
      setCurrentLocation({
        id: '__current_location__',
        name: resolved?.name ?? `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`,
        latitude,
        longitude,
        isCoordinateFallback: !resolved,
        ...enrichment,
      });
    } catch (e) {
      if (mountedRef.current && !isExternalAbortError(e)) setCurrentLocation(null);
    }
  };

  // Solid fallback (no-gradient design); gradient experiment below.
  const getWeatherCardColor = (code, isNight) => {
    const isLight = theme.mode === 'light';
    const c = code ?? 2;
    if (isNight) return '#232f45';
    // Clear sky
    if (c === 0) return isLight ? '#7cc0ee' : '#2471a3';
    // Cloudy / overcast
    if (c <= 3) return isLight ? '#b9c9d8' : '#4a6b8a';
    // Fog
    if (c <= 48) return isLight ? '#c3cad4' : '#5d6d7e';
    // Drizzle / rain
    if (c <= 67) return isLight ? '#7d9fc4' : '#2e5f8a';
    // Snow
    if (c <= 77) return isLight ? '#cfe3f7' : '#6b7f99';
    // Showers
    if (c <= 82) return isLight ? '#8ba9cc' : '#33608c';
    // Thunderstorm
    return isLight ? '#9aa0c3' : '#4a4a8a';
  };

  const getWeatherIcon = (code, isNight) => {
    const c = code ?? 2;
    if (c === 0) return isNight ? 'moon' : 'sunny';
    if (c <= 3) return isNight ? 'cloudy-night' : 'partly-sunny';
    if (c <= 48) return 'cloudy';
    if (c <= 67) return 'rainy';
    if (c <= 77) return 'snow';
    if (c <= 82) return 'rainy';
    return 'thunderstorm';
  };

  const getWeatherConditionText = (code) => {
    if (code === 0) return t('condition.clear');
    if (code <= 3) return t('condition.cloudy');
    if (code <= 48) return t('condition.fog');
    if (code <= 67) return t('condition.rain');
    if (code <= 77) return t('condition.snow');
    if (code <= 82) return t('condition.showers');
    return t('condition.thunder');
  };

  const handleAddCity = async () => {
    if (!searchQuery.trim()) return;
    const cityName = searchQuery.trim();
    const currentLang = i18n.language || 'ru';
    const addFetch = makeCityFetchJson(undefined, FETCH_TIMEOUT_MS, 1);
    try {
      setIsLoading(true);
      const hit = await searchCity(cityName, currentLang, addFetch);

      if (!hit) {
        Alert.alert(t('cities.error'), t('cities.city_not_found'));
        return;
      }
      if (isRegionLike(hit)) {
        Alert.alert(t('cities.error'), t('enterCityNotCountry'));
        return;
      }
      const { latitude, longitude, name } = hit;
      const resolvedName = name || cityName;
      const isDuplicate = citiesRef.current.some(
        c => c.name?.trim().toLowerCase() === resolvedName.trim().toLowerCase()
      );
      if (isDuplicate) {
        Alert.alert(t('cities.notice'), t('cities.already_added'));
        setSearchQuery('');
        return;
      }

      const enrichment = await fetchWeatherForCoords(latitude, longitude, addFetch);
      const newCity = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        name: resolvedName,
        latitude,
        longitude,
        ...(enrichment || { temp: '–', minMax: '', condition: getWeatherConditionText(0), weathercode: 0, isNight: false }),
      };

      const updated = [...citiesRef.current, newCity];
      setCities(updated);
      await AsyncStorage.setItem(SAVED_CITIES_KEY, JSON.stringify(updated));
      setSearchQuery('');
    } catch (e) {
      Alert.alert(t('cities.error'), t('cities.add_failed'));
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  };

  const toggleSelectCity = useCallback((id) => {
    setSelectedCities(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleSelectCity = useCallback(async (cityName, latitude, longitude) => {
    try {
      await AsyncStorage.setItem(LAST_SELECTED_CITY_KEY, cityName);
      // Use unified `city` key (same as WeatherPhenomenonFinder) so an older
      // `city` param never shadows `selectedCity`, and pass `{ pop: true }`
      // so React Navigation v7 returns to the EXISTING Tabs screen instead of
      // pushing a duplicate Tabs instance onto the stack.
      const params = { city: cityName, selectedCity: cityName, ts: Date.now() };
      if (typeof latitude === 'number' && typeof longitude === 'number' && Number.isFinite(latitude) && Number.isFinite(longitude)) {
        params.latitude = latitude;
        params.longitude = longitude;
      } else {
        params.latitude = undefined;
        params.longitude = undefined;
      }
      navigation.navigate('Tabs', { screen: 'weather', params }, { pop: true });
    } catch (e) {
      navigation.navigate('Tabs', { screen: 'weather' }, { pop: true });
    }
  }, [navigation]);

  const handleLongPressCity = useCallback((id) => {
    if (!isSelectionMode) {
      setIsSelectionMode(true);
      setSelectedCities(new Set());
    } else {
      toggleSelectCity(id);
    }
  }, [isSelectionMode, toggleSelectCity]);

  const handlePressCity = useCallback((id, name) => {
    if (isSelectionMode) {
      toggleSelectCity(id);
    } else {
      const found = citiesRef.current.find((c) => c.id === id);
      handleSelectCity(name, found?.latitude, found?.longitude);
    }
  }, [isSelectionMode, toggleSelectCity, handleSelectCity]);

  const cancelSelectionMode = useCallback(() => {
    setIsSelectionMode(false);
    setSelectedCities(new Set());
  }, []);

  const allSelected = cities.length > 0 && selectedCities.size === cities.length;

  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedCities(new Set());
    } else {
      setSelectedCities(new Set(citiesRef.current.map((c) => c.id)));
    }
  }, [allSelected]);

  const handlePromptBatchDelete = () => {
    if (selectedCities.size === 0) return;
    if (confirmDelete) {
      setDeleteTarget({ count: selectedCities.size });
    } else {
      handleConfirmDelete();
    }
  };

  const handleConfirmDelete = async () => {
    if (isSelectionMode) {
      if (selectedCities.size === 0) return;
      const updated = citiesRef.current.filter(c => !selectedCities.has(c.id));
      setCities(updated);
      await AsyncStorage.setItem(SAVED_CITIES_KEY, JSON.stringify(updated));
      setIsSelectionMode(false);
      setSelectedCities(new Set());
      setDeleteTarget(null);
    } else {
      if (!deleteTarget) return;
      const updated = citiesRef.current.filter(c => c.id !== deleteTarget.id);
      setCities(updated);
      await AsyncStorage.setItem(SAVED_CITIES_KEY, JSON.stringify(updated));
      setDeleteTarget(null);
    }
  };

  const handleCancelDelete = useCallback(() => {
    setDeleteTarget(null);
  }, []);

  // NOTE: rows intentionally carry NO entering animation. A per-row
  // Animated wrapper destabilized the drag system on-device; the list
  // entrance is animated once at the container level below instead.
  const renderItem = useCallback(({ item, index }) => {
    return (
      <DraggableCityCard
        item={item}
        index={index}
        isSelectionMode={isSelectionMode}
        isSelected={selectedCities.has(item.id)}
        theme={theme}
        fs={fs}
        t={t}
        tempUnit={tempUnit}
        onSelectToggle={handlePressCity}
        onLongPressCity={handleLongPressCity}
        dragOffset={dragOffset}
        activeIndex={activeIndex}
        activeId={activeId}
        beginDrag={beginDrag}
        endDrag={endDrag}
        commitReorder={commitReorder}
        trace={trace}
        released={released}
        order={order}
        itemCount={cities.length}
      />
    );
  }, [
    isSelectionMode, selectedCities, theme, fs, t, tempUnit,
    handlePressCity, handleLongPressCity, dragOffset, activeIndex, activeId,
    beginDrag, endDrag, commitReorder, trace, released, order, cities.length,
  ]);

  const keyExtractor = useCallback((item, index) => String(item?.id ?? index), []);

  const listHeaderElement = useMemo(() => (
    <View>
      {currentLocation ? (
        <View>
          <View style={[styles.sectionHeader, { paddingTop: 8 }]}>
            <Text style={styles.sectionHeaderText}>{t('cities.current_location')}</Text>
          </View>
          <CurrentLocationCard
            item={currentLocation}
            theme={theme}
            fs={fs}
            t={t}
            tempUnit={tempUnit}
            style={{ marginBottom: fs.spacing * 0.6 }}
            onPress={currentLocation.isCoordinateFallback
              ? undefined
              : () => handleSelectCity(currentLocation.name, currentLocation.latitude, currentLocation.longitude)}
          />
        </View>
      ) : null}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionHeaderText}>{t('cities.saved_cities')}</Text>
      </View>
    </View>
  ), [currentLocation, styles, t, theme, fs, tempUnit, handleSelectCity]);

  return (
    <ScreenWrapper contentStyle={{ paddingTop: Math.max(insets.top - 12, 0) }}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <PressableScale
          style={[styles.backButton, { backgroundColor: theme.surfaceRaised }]}
          onPress={() => isSelectionMode ? cancelSelectionMode() : navigation.goBack()}
          scaleTo={0.9}
          haptic
        >
          <Ionicons name={isSelectionMode ? "close" : "arrow-back"} size={22} color={theme.text} />
        </PressableScale>
        <Animated.Text
          style={[styles.headerTitle, { color: theme.text }, headerTitleAnimStyle]}
          numberOfLines={1}
          ellipsizeMode="tail"
          adjustsFontSizeToFit
          minimumFontScale={0.8}
        >
          {isSelectionMode ? getPluralSelectedText(selectedCities.size, t) : t('cities.title')}
        </Animated.Text>
        {isSelectionMode && (
          <PressableScale onPress={toggleSelectAll} style={{ paddingHorizontal: fs.spacing * 0.5 }} scaleTo={0.94}>
            <Text style={{ color: theme.accent, fontSize: fs.base, fontWeight: '600' }}>
              {allSelected ? t('cities.deselect_all') : t('cities.select_all')}
            </Text>
          </PressableScale>
        )}
      </View>

      {/* Search / Add Bar (height collapses smoothly in selection mode) */}
      <Animated.View
        style={[styles.searchRow, searchRowAnimStyle]}
        pointerEvents={isSelectionMode ? 'none' : 'auto'}
      >
        <TextInput
          style={[styles.input, { backgroundColor: theme.surfaceRaised, color: theme.text, borderColor: theme.border }]}
          placeholder={t('cities.add_placeholder')}
          placeholderTextColor={theme.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
          onSubmitEditing={handleAddCity}
          editable={!isSelectionMode}
        />
        <PressableScale
          style={[styles.addButton, { backgroundColor: theme.accent }]}
          onPress={handleAddCity}
          scaleTo={0.9}
          haptic
        >
          <Ionicons name="add" size={24} color={theme.onAccent || '#FFFFFF'} />
        </PressableScale>
      </Animated.View>

      {!listMounted ? (
        <View style={{ flex: 1 }} />
      ) : isLoading && cities.length === 0 ? (
        <View style={{ flex: 1, paddingHorizontal: fs.spacing, paddingTop: fs.spacing * 0.5 }}>
          <SkeletonCard theme={theme} fs={fs} />
          <SkeletonCard theme={theme} fs={fs} />
          <SkeletonCard theme={theme} fs={fs} />
        </View>
      ) : (
        <FadeSlideIn duration={260} distance={12} style={{ flex: 1 }}>
          <DragCellContext.Provider value={dragCellValue}>
          <FlatList
            data={renderList}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            CellRendererComponent={DragCell}
            // Cards are placed by transforms; clipping by layout bounds
            // could detach a card that is visually on screen.
            removeClippedSubviews={false}
            ListHeaderComponent={listHeaderElement}
            ListEmptyComponent={
              <Text style={styles.emptyListText}>{t('cities.empty_list')}</Text>
            }
            style={{ flex: 1 }}
            scrollEnabled={!isDragging}
            contentContainerStyle={[
              styles.listContainer,
              // Reserve the delete-bar space for the WHOLE selection session,
              // not only after the first checkbox. Changing the content height
              // at the same moment the search row collapses made the ScrollView
              // re-clamp (visible jump) when the list was scrolled to the bottom.
              isSelectionMode && { paddingBottom: 110 },
            ]}
            showsVerticalScrollIndicator={false}
            // RefreshControl MUST stay mounted for the whole screen lifetime.
            // On Android RN wraps the ScrollView in a SwipeRefreshLayout only
            // when this prop is set; swapping element <-> undefined changes
            // the root component type and remounts the native ScrollView and
            // every cell (visible flash when entering/leaving selection
            // mode). Keeping it mounted and disabling it avoids the remount.
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                enabled={!isSelectionMode}
                onRefresh={() => {
                  if (isSelectionMode) return;
                  setRefreshing(true);
                  loadSavedCitiesAndRefresh();
                  loadCurrentLocation();
                }}
              />
            }
          />
          </DragCellContext.Provider>
        </FadeSlideIn>
      )}

      {/* Persistent delete bar: mounted always, shown/hidden by shared value
          (opacity + slide). No mount/unmount layout animation => no flash. */}
      <Animated.View
        style={[styles.batchBottomBar, deleteBarAnimStyle]}
        pointerEvents={showDeleteBar ? 'box-none' : 'none'}
      >
        <PressableScale
          style={styles.batchDeleteButton}
          onPress={handlePromptBatchDelete}
          scaleTo={0.97}
          activeOpacity={0.85}
          haptic
        >
          <Ionicons name="trash-outline" size={20} color="#FFFFFF" />
          <Text style={styles.batchDeleteText}>
            {t('cities.delete')} ({selectedCities.size})
          </Text>
        </PressableScale>
      </Animated.View>

      {deleteTarget !== null && (
        <ConfirmDeleteModal
          visible={true}
          cityName={deleteTarget?.name}
          count={deleteTarget?.count || selectedCities.size}
          onCancel={handleCancelDelete}
          onConfirm={handleConfirmDelete}
        />
      )}
    </ScreenWrapper>
  );
}