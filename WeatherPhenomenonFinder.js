import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { View, Text, FlatList, ActivityIndicator, StyleSheet, Animated, Easing } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import Svg, { Circle, Path } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useFontSize } from './FontSizeContext';
import { useTheme } from './ThemeContext';
import { useSettings } from './SettingsContext';
import { fetchForecast } from './utils/weatherProviders';
import { fetchJsonWithRetry, isExternalAbortError } from './utils/http';
import { formatTemp, weathercodeToType } from './utils/weatherFormat';
import { WeatherIcon } from './components/weather/WeatherIcons';
import PressableScale from './components/PressableScale';
import FadeSlideIn from './components/FadeSlideIn';

const POLL_CONCURRENCY = 6;
const SNAPSHOT_TTL_MS = 3 * 60 * 1000;

const CITIES = [
  { ru: 'Москва', en: 'Moscow', latitude: 55.7558, longitude: 37.6173 },
  { ru: 'Лондон', en: 'London', latitude: 51.5074, longitude: -0.1278 },
  { ru: 'Нью-Йорк', en: 'New York', latitude: 40.7128, longitude: -74.006 },
  { ru: 'Токио', en: 'Tokyo', latitude: 35.6762, longitude: 139.6503 },
  { ru: 'Сочи', en: 'Sochi', latitude: 43.5974, longitude: 39.7154 },
  { ru: 'Мумбаи', en: 'Mumbai', latitude: 19.076, longitude: 72.8777 },
  { ru: 'Пекин', en: 'Beijing', latitude: 39.9042, longitude: 116.4074 },
  { ru: 'Санкт-Петербург', en: 'Saint Petersburg', latitude: 59.9343, longitude: 30.3351 },
  { ru: 'Новосибирск', en: 'Novosibirsk', latitude: 55.0302, longitude: 82.9784 },
  { ru: 'Екатеринбург', en: 'Yekaterinburg', latitude: 56.8389, longitude: 60.6159 },
  { ru: 'Норильск', en: 'Norilsk', latitude: 69.35, longitude: 88.2 },
  { ru: 'Мурманск', en: 'Murmansk', latitude: 68.97, longitude: 33.08 },
  { ru: 'Рейкьявик', en: 'Reykjavik', latitude: 64.15, longitude: -21.94 },
  { ru: 'Красноярск', en: 'Krasnoyarsk', latitude: 56.0153, longitude: 92.8567 },
  { ru: 'Сеул', en: 'Seoul', latitude: 37.5665, longitude: 126.978 },
  { ru: 'Берлин', en: 'Berlin', latitude: 52.52, longitude: 13.405 },
  { ru: 'Париж', en: 'Paris', latitude: 48.8566, longitude: 2.3522 },
  { ru: 'Майами', en: 'Miami', latitude: 25.7617, longitude: -80.1918 },
  { ru: 'Лос-Анджелес', en: 'Los Angeles', latitude: 34.0522, longitude: -118.2437 },
  { ru: 'Дубай', en: 'Dubai', latitude: 25.2048, longitude: 55.2708 },
  { ru: 'Сингапур', en: 'Singapore', latitude: 1.3521, longitude: 103.8198 },
  { ru: 'Сидней', en: 'Sydney', latitude: -33.8688, longitude: 151.2093 },
  { ru: 'Якутск', en: 'Yakutsk', latitude: 62.0355, longitude: 129.6755 },
  { ru: 'Рованиеми', en: 'Rovaniemi', latitude: 66.5039, longitude: 25.7294 },
  { ru: 'Эдмонтон', en: 'Edmonton', latitude: 53.5461, longitude: -113.4938 },
  { ru: 'Саппоро', en: 'Sapporo', latitude: 43.0642, longitude: 141.3469 },
  { ru: 'Чунцин', en: 'Chongqing', latitude: 29.563, longitude: 106.5516 },
];

const PHENOMENA_KEYS = ['clear', 'rain', 'snow', 'cloudy', 'fog', 'thunder'];

const PHENOMENON_WMO_MAP = {
  clear: [0],
  cloudy: [1, 2, 3],
  fog: [45, 48],
  rain: [51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 63, 64, 65, 66, 67, 80, 81, 82],
  snow: [71, 72, 73, 75, 77, 85, 86],
  thunder: [95, 96, 99],
};

function isCodeInPhenomenon(code, phenomenon) {
  const codes = PHENOMENON_WMO_MAP[phenomenon];
  return codes ? codes.includes(code) : false;
}

function cityDisplayName(city, lang) {
  return lang === 'en' ? city.en : city.ru;
}

function formatSnapTime(ts, lang) {
  try {
    return new Date(ts).toLocaleTimeString(lang === 'en' ? 'en-US' : 'ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

async function mapWithConcurrency(items, limit, worker, signal) {
  const out = new Array(items.length);
  let cursor = 0;
  const runWorker = async () => {
    while (cursor < items.length) {
      if (signal?.aborted) return;
      const idx = cursor++;
      out[idx] = await worker(items[idx], idx);
    }
  };
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => runWorker());
  await Promise.all(workers);
  return out;
}

function SunTabIcon({ color = '#fbbf24', size = 26 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="4" stroke={color} strokeWidth="2" />
      <Path d="M12 2v4M12 18v4M2 12h4M18 12h4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

function SearchTabIcon({ color = '#fbbf24', size = 26 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="10" cy="10" r="6" stroke={color} strokeWidth="2" />
      <Path d="M15 15l5 5" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

const PhenomenonChip = React.memo(function PhenomenonChip({ label, active, onPress, theme, styles }) {
  const progress = useRef(new Animated.Value(active ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: active ? 1 : 0,
      duration: 180,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, [active, progress]);

  const backgroundColor = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [theme.surface, theme.surfaceAlt],
  });
  const borderColor = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [theme.border, theme.accent],
  });
  const color = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [theme.textSecondary, theme.accent],
  });

  return (
    <PressableScale style={styles.chipWrap} onPress={onPress} scaleTo={0.97} activeOpacity={0.9}>
      <Animated.View style={[styles.phenomenonButton, { backgroundColor, borderColor }]}>
        <Animated.Text style={[styles.phenomenonButtonText, { color }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
          {label}
        </Animated.Text>
      </Animated.View>
    </PressableScale>
  );
});

export default function WeatherPhenomenonFinder() {
  const navigation = useNavigation();
  const { t, i18n } = useTranslation();
  const { theme } = useTheme();
  const fs = useFontSize();
  const { tempUnit } = useSettings();
  const titleOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(titleOpacity, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [titleOpacity]);

  const [selectedPhenomenon, setSelectedPhenomenon] = useState('clear');
  const [loading, setLoading] = useState(false);
  const [progressDone, setProgressDone] = useState(0);
  const [results, setResults] = useState([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [snapshotAt, setSnapshotAt] = useState(null);

  const snapshotRef = useRef({ at: 0, items: null });
  const abortRef = useRef(null);
  const searchSeqRef = useRef(0);

  useEffect(() => () => {
    searchSeqRef.current += 1;
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch (e) {}
    }
  }, []);

  const styles = useMemo(() => StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.background,
      padding: fs.spacing,
    },
    title: {
      fontSize: fs.large,
      fontWeight: '700',
      color: theme.text,
      textAlign: 'center',
      marginBottom: fs.spacing * 0.75,
    },
    buttonGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: fs.spacing * 0.5,
      marginBottom: fs.spacing * 0.75,
    },
    chipWrap: {
      flexGrow: 1,
      flexBasis: '46%',
    },
    phenomenonButton: {
      backgroundColor: theme.surface,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: theme.border,
      paddingVertical: fs.spacing * 0.7,
      paddingHorizontal: fs.spacing * 0.75,
      alignItems: 'center',
    },
    phenomenonButtonText: {
      color: theme.textSecondary,
      fontSize: fs.base * 0.95,
      fontWeight: '600',
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: fs.spacing * 0.625,
      paddingHorizontal: 2,
    },
    metaText: {
      color: theme.textMuted,
      fontSize: fs.small,
    },
    refreshBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingVertical: 4,
      paddingHorizontal: 10,
      borderRadius: 10,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
    },
    refreshBtnText: {
      color: theme.accent,
      fontSize: fs.small,
      fontWeight: '600',
    },
    loadingContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      flex: 1,
    },
    loadingText: {
      color: theme.textMuted,
      marginTop: fs.spacing * 0.75,
      fontSize: fs.small,
    },
    listContent: {
      gap: fs.spacing * 0.625,
      paddingBottom: fs.spacing,
    },
    resultCard: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: theme.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.border,
      paddingVertical: fs.spacing * 0.8,
      paddingHorizontal: fs.spacing * 1.1,
      minHeight: fs.cardHeight * 0.9,
    },
    resultLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: fs.spacing * 0.625,
      flex: 1,
      marginRight: fs.spacing * 0.5,
    },
    resultCity: {
      color: theme.text,
      fontSize: fs.base * 1.08,
      fontWeight: '600',
      flexShrink: 1,
    },
    resultTemp: {
      color: theme.accent,
      fontSize: fs.large,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
    },
    hintContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: fs.spacing * 1.5,
      gap: fs.spacing * 0.75,
    },
    hint: {
      color: theme.textMuted,
      fontSize: fs.base,
      textAlign: 'center',
    },
    retryBtn: {
      backgroundColor: theme.accent,
      borderRadius: 10,
      paddingVertical: fs.spacing * 0.55,
      paddingHorizontal: fs.spacing * 1.25,
    },
    retryBtnText: {
      color: theme.onAccent,
      fontSize: fs.base * 0.92,
      fontWeight: '700',
    },
  }), [theme, fs]);

  const filterSnapshot = useCallback((items, phenomenon) => {
    return items
      .filter((r) => r && r.weathercode !== null && isCodeInPhenomenon(r.weathercode, phenomenon))
      .slice(0, 8);
  }, []);

  const handleSearch = useCallback(async (phenomenon, forceRefresh = false) => {
    setHasSearched(true);
    setSearchError(null);

    // Fast path: reuse recent 27-city snapshot when switching phenomenon chips.
    const snap = snapshotRef.current;
    if (!forceRefresh && snap.items && Date.now() - snap.at < SNAPSHOT_TTL_MS) {
      setResults(filterSnapshot(snap.items, phenomenon));
      setSnapshotAt(snap.at);
      setLoading(false);
      return;
    }

    const seq = ++searchSeqRef.current;
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch (e) {}
    }
    const controller = new AbortController();
    abortRef.current = controller;
    const phFetch = (url) => fetchJsonWithRetry(url, { timeoutMs: 10000, retries: 1, signal: controller.signal });

    setLoading(true);
    setProgressDone(0);
    setResults([]);
    try {
      let done = 0;
      const allResults = await mapWithConcurrency(
        CITIES,
        POLL_CONCURRENCY,
        async (city) => {
          try {
            const data = await fetchForecast(
              city.latitude,
              city.longitude,
              phFetch,
              `https://api.open-meteo.com/v1/forecast?latitude=${city.latitude}&longitude=${city.longitude}&current=weather_code,temperature_2m`,
            );
            const cw = data?.current_weather;
            if (!cw || typeof cw.temperature !== 'number' || typeof cw.weathercode !== 'number') {
              return { ...city, temperature: null, weathercode: null };
            }
            return {
              ...city,
              temperature: cw.temperature,
              weathercode: cw.weathercode,
            };
          } catch (e) {
            if (isExternalAbortError(e)) throw e;
            return { ...city, temperature: null, weathercode: null };
          } finally {
            done += 1;
            if (seq === searchSeqRef.current && !controller.signal.aborted) {
              setProgressDone(done);
            }
          }
        },
        controller.signal,
      );

      if (seq !== searchSeqRef.current || controller.signal.aborted) return;

      const allFailed = allResults.every((r) => !r || (r.weathercode === null && r.temperature === null));
      if (allFailed) {
        setSearchError('offline');
        setResults([]);
        return;
      }

      const now = Date.now();
      snapshotRef.current = { at: now, items: allResults };
      setSnapshotAt(now);
      setResults(filterSnapshot(allResults, phenomenon));
    } catch (e) {
      if (seq !== searchSeqRef.current || isExternalAbortError(e)) return;
      setSearchError('offline');
      setResults([]);
    } finally {
      if (seq === searchSeqRef.current) {
        setLoading(false);
      }
    }
  }, [filterSnapshot]);

  const handlePress = useCallback((key) => {
    setSelectedPhenomenon(key);
    handleSearch(key, false);
  }, [handleSearch]);

  const handleForceRefresh = useCallback(() => {
    handleSearch(selectedPhenomenon, true);
  }, [handleSearch, selectedPhenomenon]);

  const lang = i18n.language === 'en' ? 'en' : 'ru';

  const renderItem = useCallback(({ item, index }) => {
    const label = cityDisplayName(item, lang);
    return (
      <FadeSlideIn delay={index * 35} distance={6}>
        <PressableScale
          style={styles.resultCard}
          onPress={() =>
            navigation.navigate('weather', {
              city: label,
              latitude: item.latitude,
              longitude: item.longitude,
              ts: Date.now(),
            })
          }
          scaleTo={0.97}
        >
          <View style={styles.resultLeft}>
            <WeatherIcon type={weathercodeToType(item.weathercode)} isNight={false} size={28} />
            <Text style={styles.resultCity} numberOfLines={1}>{label}</Text>
          </View>
          <Text style={styles.resultTemp}>{formatTemp(item.temperature, tempUnit)}</Text>
        </PressableScale>
      </FadeSlideIn>
    );
  }, [lang, styles, navigation, tempUnit]);

  const keyExtractor = useCallback((item) => `${item.en}-${item.weathercode}`, []);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <Animated.Text style={[styles.title, { opacity: titleOpacity }]}>{t('weatherByPhenomena')}</Animated.Text>
      <View style={styles.buttonGrid}>
        {PHENOMENA_KEYS.map((key) => (
          <PhenomenonChip
            key={key}
            label={t(`phenomenon.${key}`)}
            active={selectedPhenomenon === key}
            onPress={() => handlePress(key)}
            theme={theme}
            styles={styles}
          />
        ))}
      </View>
      {snapshotAt && !loading ? (
        <View style={styles.metaRow}>
          <Text style={styles.metaText}>
            {t('phenomenaCachedHint', { time: formatSnapTime(snapshotAt, lang) })}
          </Text>
          <PressableScale style={styles.refreshBtn} onPress={handleForceRefresh} scaleTo={0.95} haptic>
            <Ionicons name="refresh" size={14} color={theme.accent} />
            <Text style={styles.refreshBtnText}>{t('refresh')}</Text>
          </PressableScale>
        </View>
      ) : null}
      {loading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.accent} />
          <Text style={styles.loadingText}>
            {t('loadingCitiesProgress', { done: progressDone, total: CITIES.length })}
          </Text>
        </View>
      )}
      {!loading && results.length > 0 && (
        <FlatList
          data={results}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
      {!loading && results.length === 0 && (
        <View style={styles.hintContainer}>
          <FadeSlideIn distance={4}>
            <Text style={styles.hint}>
              {searchError === 'offline'
                ? t('noInternet')
                : hasSearched
                  ? t('noResultsAfterSearch')
                  : t('noResultsBeforeSearch')}
            </Text>
          </FadeSlideIn>
          {searchError === 'offline' && (
            <PressableScale style={styles.retryBtn} onPress={handleForceRefresh} scaleTo={0.96} haptic>
              <Text style={styles.retryBtnText}>{t('retry')}</Text>
            </PressableScale>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

export { SunTabIcon, SearchTabIcon };
