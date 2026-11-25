import React, {
  createContext,
  useState,
  useEffect,
  useContext,
  useCallback,
  useMemo,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const SettingsContext = createContext();

const TEMP_UNIT_KEY = 'tempUnit';
const WIND_UNIT_KEY = 'windUnit';
const SHOW_SOURCE_KEY = 'showSourceBadge';
const LOCATION_SUBTITLE_KEY = 'locationSubtitleMode';
const DEFAULT_TEMP_UNIT = 'C';
const DEFAULT_WIND_UNIT = 'kmh';
const DEFAULT_LOCATION_SUBTITLE_MODE = 'both';

export const TEMP_UNITS = ['C', 'F'];
export const WIND_UNITS = ['kmh', 'ms', 'mph', 'knots', 'beaufort'];
export const LOCATION_SUBTITLE_MODES = ['both', 'country', 'coords', 'hidden'];

export const SettingsProvider = ({ children }) => {
  const [tempUnit, setTempUnit] = useState(DEFAULT_TEMP_UNIT);
  const [windUnit, setWindUnit] = useState(DEFAULT_WIND_UNIT);
  // Badge with the live data source on the main screen (default ON).
  const [showSourceBadge, setShowSourceBadge] = useState(true);
  // Subtitle under city name on main screen: both | country | coords | hidden.
  const [locationSubtitleMode, setLocationSubtitleMode] = useState(DEFAULT_LOCATION_SUBTITLE_MODE);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const [savedTemp, savedWind, savedSource, savedSubtitle] = await Promise.all([
          AsyncStorage.getItem(TEMP_UNIT_KEY),
          AsyncStorage.getItem(WIND_UNIT_KEY),
          AsyncStorage.getItem(SHOW_SOURCE_KEY),
          AsyncStorage.getItem(LOCATION_SUBTITLE_KEY),
        ]);
        if (TEMP_UNITS.includes(savedTemp)) {
          setTempUnit(savedTemp);
        }
        if (WIND_UNITS.includes(savedWind)) {
          setWindUnit(savedWind);
        }
        if (savedSource !== null) {
          setShowSourceBadge(savedSource === 'true');
        }
        if (LOCATION_SUBTITLE_MODES.includes(savedSubtitle)) {
          setLocationSubtitleMode(savedSubtitle);
        }
      } catch (e) {
      } finally {
        setLoaded(true);
      }
    };
    loadSettings();
  }, []);

  const persistTempUnit = useCallback(async (value) => {
    if (!TEMP_UNITS.includes(value)) return;
    setTempUnit(value);
    try {
      await AsyncStorage.setItem(TEMP_UNIT_KEY, value);
    } catch (e) {}
  }, []);

  const persistWindUnit = useCallback(async (value) => {
    if (!WIND_UNITS.includes(value)) return;
    setWindUnit(value);
    try {
      await AsyncStorage.setItem(WIND_UNIT_KEY, value);
    } catch (e) {}
  }, []);

  const persistShowSourceBadge = useCallback(async (value) => {
    const next = !!value;
    setShowSourceBadge(next);
    try {
      await AsyncStorage.setItem(SHOW_SOURCE_KEY, next ? 'true' : 'false');
    } catch (e) {}
  }, []);

  const persistLocationSubtitleMode = useCallback(async (value) => {
    if (!LOCATION_SUBTITLE_MODES.includes(value)) return;
    setLocationSubtitleMode(value);
    try {
      await AsyncStorage.setItem(LOCATION_SUBTITLE_KEY, value);
    } catch (e) {}
  }, []);

  const value = useMemo(
    () => ({
      tempUnit,
      windUnit,
      setTempUnit: persistTempUnit,
      setWindUnit: persistWindUnit,
      showSourceBadge,
      setShowSourceBadge: persistShowSourceBadge,
      locationSubtitleMode,
      setLocationSubtitleMode: persistLocationSubtitleMode,
      loaded,
    }),
    [
      tempUnit,
      windUnit,
      persistTempUnit,
      persistWindUnit,
      showSourceBadge,
      persistShowSourceBadge,
      locationSubtitleMode,
      persistLocationSubtitleMode,
      loaded,
    ],
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => useContext(SettingsContext);

export default SettingsContext;
