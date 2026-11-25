import React, { useMemo, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withDelay,
  withSequence,
  cancelAnimation,
  useReducedMotion,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import FadeSlideIn from './components/FadeSlideIn';
import { saveDragTrace } from './utils/dragTrace';
import { convertTemp } from './utils/weatherFormat';

function displayCardTemp(item, tempUnit) {
  if (typeof item?.tempC === 'number' && Number.isFinite(item.tempC)) {
    const v = convertTemp(item.tempC, tempUnit);
    return v === null ? '–' : String(Math.round(v));
  }
  const parsed = item?.temp !== undefined && item?.temp !== '' ? Number(item.temp) : NaN;
  if (Number.isFinite(parsed)) {
    const v = convertTemp(parsed, tempUnit);
    return v === null ? '–' : String(Math.round(v));
  }
  return item?.temp || '–';
}

function displayCardMinMax(item, tempUnit) {
  if (
    typeof item?.maxC === 'number' && Number.isFinite(item.maxC) &&
    typeof item?.minC === 'number' && Number.isFinite(item.minC)
  ) {
    const hi = Math.round(convertTemp(item.maxC, tempUnit));
    const lo = Math.round(convertTemp(item.minC, tempUnit));
    return `${hi}° / ${lo}°`;
  }
  return item?.minMax || '';
}

const LANDING = { duration: 180, easing: Easing.out(Easing.quad) };

// Selection controls (3-line drag handle + round checkbox) live inside every
// card permanently. Their container collapses to width 0 instead of being
// unmounted, so entering/leaving selection mode is one continuous animation
// (no pop, no instant text jump).
// In normal mode, cardBody.paddingLeft = fs.spacing (~16px) gives city names
// a tight, natural inset. In selection mode, controlsWrap pulls left by 8px
// (placing the 3-line handle at 8px from the card edge) and groups the handle
// and checkbox closely together (~8px gap).
// Open width = handle (4+22+4=30) + 4 gap + checkbox 24 + 15 gap = 73.
const CONTROLS_WIDTH = 73;

// Module-level style cache keyed by font metrics: avoids creating 12+ identical
// StyleSheets on every CityList mount and lets StaticCityCardPreview match
// DraggableCityCard pixel-for-pixel.
let _cardStylesKey = '';
let _cardStylesCache = null;

function getCardStyles(fs) {
  const key = `${fs.spacing}:${fs.large}:${fs.base}:${fs.small}:${fs.cardHeight}`;
  if (_cardStylesKey === key && _cardStylesCache) return _cardStylesCache;
  _cardStylesKey = key;
  _cardStylesCache = StyleSheet.create({
    cardContainer: {
      borderRadius: 28,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: 'rgba(255, 255, 255, 0.14)',
      borderTopColor: 'rgba(255, 255, 255, 0.28)',
      elevation: 8,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.25,
      shadowRadius: 12,
      height: Math.round(fs.cardHeight * 1.375),
      marginBottom: fs.spacing,
    },
    cardBackground: {
      borderRadius: 28,
      overflow: 'hidden',
      width: '100%',
      height: '100%',
    },
    cardBody: {
      flex: 1,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingLeft: fs.spacing,
      paddingRight: fs.spacing * 1.25,
      paddingVertical: fs.spacing * 0.75,
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
      color: 'rgba(255, 255, 255, 0.85)',
      fontWeight: '500',
      flexShrink: 1,
    },
    conditionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
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
    tempDegree: {
      fontSize: fs.large * 1.1,
      fontWeight: '700',
      color: '#FFFFFF',
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
      marginRight: 15,
    },
    controlsWrap: {
      position: 'absolute',
      left: 8,
      top: 0,
      bottom: 0,
      justifyContent: 'center',
      zIndex: 2,
    },
    controlsRow: {
      width: CONTROLS_WIDTH,
      flexDirection: 'row',
      alignItems: 'center',
    },
    cardLeftSelected: {
      paddingRight: CONTROLS_WIDTH - 4,
    },
    dragHandle: {
      paddingHorizontal: 4,
      paddingVertical: 8,
      marginRight: 4,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
  return _cardStylesCache;
}

// Ultra-lightweight pixel-identical card used ONLY during the 380ms
// slide_from_right push transition (zero Reanimated worklets, zero RNGH
// gesture handlers, zero icon animations) so cards slide in immediately on
// frame 0 without dropping transition frames.
export const StaticCityCardPreview = React.memo(function StaticCityCardPreview({
  item,
  fs,
  t,
  tempUnit = 'C',
}) {
  const safeItem = { ...item, isNight: item?.isNight ?? false };
  const weatherTheme = getWeatherTheme(safeItem.weathercode, safeItem.isNight);
  const styles = getCardStyles(fs);
  return (
    <View style={styles.cardContainer}>
      <View style={styles.cardBackground}>
        <LinearGradient
          colors={weatherTheme.colors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={['rgba(255,255,255,0.14)', 'rgba(255,255,255,0.03)', 'rgba(255,255,255,0)']}
          start={{ x: 0.9, y: 0.1 }}
          end={{ x: 0.2, y: 0.9 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={styles.cardBody}>
          <View style={styles.cardLeft}>
            <Text
              style={styles.cityName}
              numberOfLines={1}
              ellipsizeMode="tail"
              adjustsFontSizeToFit
              minimumFontScale={0.65}
            >
              {safeItem.name}
            </Text>
            <View style={styles.conditionRow}>
              <StaticWeatherConditionIcon
                code={safeItem.weathercode}
                isNight={safeItem.isNight}
              />
              <Text style={styles.cityCondition} numberOfLines={1} ellipsizeMode="tail">
                {safeItem.condition || t('condition.cloudy')}
              </Text>
            </View>
          </View>
          <View style={styles.cardRight}>
            <View style={styles.tempRow}>
              <Text style={styles.cityTemp}>{displayCardTemp(safeItem, tempUnit)}</Text>
              <Text style={styles.tempDegree}>°</Text>
            </View>
            <Text style={styles.cityMinMax}>{displayCardMinMax(safeItem, tempUnit)}</Text>
          </View>
        </View>
      </View>
    </View>
  );
});
// Same curve/timing on the card controls and on the search row in
// CityListScreen so the whole transition reads as a single motion.
const SELECTION_TIMING = {
  duration: 260,
  easing: Easing.bezier(0.22, 1, 0.36, 1),
};

const DraggableCityCard = React.memo(function DraggableCityCard({
  item,
  index,
  isSelectionMode,
  isSelected,
  theme,
  fs,
  t,
  tempUnit = 'C',
  onSelectToggle,
  onLongPressCity,
  dragOffset,
  activeIndex,
  activeId,
  beginDrag,
  endDrag,
  commitReorder,
  itemCount,
  trace,
  released,
  order,
}) {
  const safeItem = { ...item, isNight: item?.isNight ?? false };
  // Stable per-instance identity for the active branch (see below).
  const itemId = safeItem.id ?? String(index);
  // 0..1 "lifted in hand" amount: scale, opacity, shadow, layer.
  // All positional movement lives on the FlatList cell (see DragCell in
  // CityListScreen), so the card itself never needs a translate.
  const lift = useSharedValue(0);
  // 0 = normal card, 1 = selection mode controls fully open.
  const selectionProgress = useSharedValue(isSelectionMode ? 1 : 0);
  useEffect(() => {
    selectionProgress.value = withTiming(
      isSelectionMode ? 1 : 0,
      SELECTION_TIMING,
    );
  }, [isSelectionMode]);

  const weatherTheme = getWeatherTheme(safeItem.weathercode, safeItem.isNight);
  const subText = 'rgba(255, 255, 255, 0.75)';
  const minMaxColor = 'rgba(255, 255, 255, 0.7)';

  const styles = getCardStyles(fs);

  // Real slot height: exact card height + bottom margin (matches styles above).
  const cardH = Math.round(fs.cardHeight * 1.375);
  const stride = cardH + fs.spacing;

  const finishCommit = useCallback((from, to, snapshot) => {
    commitReorder(from, to);
    saveDragTrace(snapshot);
  }, [commitReorder]);

  const finishCancel = useCallback((snapshot) => {
    endDrag();
    saveDragTrace(snapshot);
  }, [endDrag]);

  const panGesture = useMemo(() => Gesture.Pan()
    .onStart(() => {
      'worklet';
      const from = order.value.indexOf(itemId);
      if (from < 0 || activeId.value !== null) return;
      activeId.value = itemId;
      activeIndex.value = from;
      dragOffset.value = 0;
      trace.value = [];
      released.value = 0;
      lift.value = withTiming(1, { duration: 120, easing: Easing.out(Easing.quad) });
      runOnJS(beginDrag)(from);
    })
    .onUpdate((e) => {
      'worklet';
      if (activeId.value !== itemId || released.value === 1) return;
      dragOffset.value = e.translationY;
    })
    .onEnd(() => {
      'worklet';
      if (activeId.value !== itemId || released.value === 1) return;
      released.value = 1;
      const from = activeIndex.value;
      const offset = dragOffset.value;
      const steps = offset >= 0
        ? Math.floor((offset + stride * 0.5) / stride)
        : -Math.floor((-offset + stride * 0.5) / stride);
      const to = Math.max(0, Math.min(itemCount - 1, from + steps));
      const shouldReorder = to !== from;

      if (trace.value.length < 1500) {
        trace.value.push(['e', Date.now(), Math.round(offset), shouldReorder ? to : -1]);
      }

      // Smooth landing into slot
      lift.value = withTiming(0, LANDING);
      const targetOffset = (to - from) * stride;
      dragOffset.value = withTiming(targetOffset, LANDING, (finished) => {
        'worklet';
        if (!finished) return;
        if (shouldReorder) {
          const next = order.value.slice();
          next.splice(from, 1);
          next.splice(to, 0, itemId);
          order.value = next;
        }
        dragOffset.value = 0;
        activeIndex.value = -1;
        activeId.value = null;
        const snapshot = trace.value;
        trace.value = [];
        if (shouldReorder) {
          runOnJS(finishCommit)(from, to, snapshot);
        } else {
          runOnJS(finishCancel)(snapshot);
        }
      });
    }),
    [index, itemCount, stride, itemId, beginDrag, finishCommit, finishCancel, released, order]);

  const animatedStyle = useAnimatedStyle(() => {
    const active = activeId.value === itemId;
    const l = lift.value;

    if (active) {
      // Drag telemetry: one sample per frame (~60Hz) for offline analysis.
      if (trace.value.length < 1500) {
        trace.value.push(['s', Date.now(), Math.round(dragOffset.value), 0]);
      }
    }

    return {
      transform: [{ scale: 1 + 0.04 * l }],
      opacity: 1 - 0.04 * l,
      zIndex: active || l > 0 ? 9999 : 1,
      shadowColor: '#000',
      shadowOpacity: 0.25 + 0.1 * l,
      shadowRadius: 12 + 6 * l,
      elevation: 8 + 22 * l,
    };
  });

  const canSelectItem = isSelectionMode;

  // 100% GPU-only selection animation (zero Yoga width/marginLeft relayouts
  // across 12 cards per frame): controls fade/slide in from an absolute overlay
  // while the city text block shifts right via pure translateX.
  const controlsInnerStyle = useAnimatedStyle(() => {
    const p = selectionProgress.value;
    return {
      opacity: p,
      transform: [
        { translateX: -14 * (1 - p) },
        { scale: 0.85 + 0.15 * p },
      ],
    };
  });
  const cardLeftAnimStyle = useAnimatedStyle(() => {
    const p = selectionProgress.value;
    return {
      transform: [{ translateX: (CONTROLS_WIDTH - 8) * p }],
    };
  });

  return (
    <Animated.View
      style={[styles.cardContainer, animatedStyle]}
    >
      <Pressable
        onPress={() => onSelectToggle(safeItem.id, safeItem.name, index)}
        onLongPress={() => onLongPressCity?.(safeItem.id, safeItem.name, index)}
        delayLongPress={400}
      >
      <View style={styles.cardBackground}>
        <LinearGradient
          colors={weatherTheme.colors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={['rgba(255,255,255,0.14)', 'rgba(255,255,255,0.03)', 'rgba(255,255,255,0)']}
          start={{ x: 0.9, y: 0.1 }}
          end={{ x: 0.2, y: 0.9 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={styles.cardBody}>
          <View
            style={styles.controlsWrap}
            pointerEvents={canSelectItem ? 'auto' : 'none'}
          >
            <Animated.View style={[styles.controlsRow, controlsInnerStyle]}>
              <GestureDetector gesture={panGesture}>
                <View style={styles.dragHandle}>
                  <Ionicons name="menu" size={22} color={subText} />
                </View>
              </GestureDetector>
              <Pressable
                style={[
                  styles.checkbox,
                  { borderColor: 'rgba(255, 255, 255, 0.85)' },
                  isSelected && { backgroundColor: theme.accent || '#3a7bd5', borderColor: theme.accent || '#3a7bd5' },
                ]}
                hitSlop={8}
                onPress={() => onSelectToggle(safeItem.id, safeItem.name, index)}
              >
                {isSelected && (
                  <FadeSlideIn duration={150} distance={0}>
                    <Ionicons name="checkmark" size={16} color="#FFFFFF" />
                  </FadeSlideIn>
                )}
              </Pressable>
            </Animated.View>
          </View>
          <Animated.View style={[styles.cardLeft, canSelectItem && styles.cardLeftSelected, cardLeftAnimStyle]}>
            <Text
              style={styles.cityName}
              numberOfLines={1}
              ellipsizeMode="tail"
              adjustsFontSizeToFit
              minimumFontScale={0.65}
            >
              {safeItem.name}
            </Text>
            <View style={styles.conditionRow}>
              <WeatherConditionIcon
                code={safeItem.weathercode}
                isNight={safeItem.isNight}
              />
              <Text style={styles.cityCondition} numberOfLines={1} ellipsizeMode="tail">
                {safeItem.condition || t('condition.cloudy')}
              </Text>
            </View>
          </Animated.View>
          <View style={styles.cardRight}>
            <View style={styles.tempRow}>
              <Text style={styles.cityTemp}>{displayCardTemp(safeItem, tempUnit)}</Text>
              <Text style={styles.tempDegree}>°</Text>
            </View>
            <Text style={styles.cityMinMax}>{displayCardMinMax(safeItem, tempUnit)}</Text>
          </View>
        </View>
      </View>
      </Pressable>
    </Animated.View>
  );
});

export default DraggableCityCard;

export const getWeatherTheme = (code, isNight) => {
  const c = code ?? 2;
  // 1. clear (Ясно): днём лазурно-голубой (#2563eb → #38bdf8), ночью звёздный индиго-фиолетовый (#1e1b4b → #312e81)
  if (c === 0) {
    return {
      colors: isNight ? ['#1e1b4b', '#312e81'] : ['#2563eb', '#38bdf8'],
      icon: isNight ? 'moon' : 'sunny',
      iconColor: isNight ? '#fbbf24' : '#fde047',
    };
  }
  // 2. cloudy / partly (Облачно): мягкий серо-синий графит (#334155 → #475569 днём, #1e293b → #334155 ночью)
  if (c <= 3) {
    return {
      colors: isNight ? ['#1e293b', '#334155'] : ['#334155', '#475569'],
      icon: isNight ? 'cloudy-night' : 'partly-sunny',
      iconColor: '#fbbf24',
    };
  }
  // 3. fog (Туман): дымчато-сизый (#3f4c59 → #64748b днём, #222b35 → #3b4754 ночью)
  if (c <= 48) {
    return {
      colors: isNight ? ['#222b35', '#3b4754'] : ['#3f4c59', '#64748b'],
      icon: 'cloudy',
      iconColor: '#94a3b8',
    };
  }
  // 4. rain (Дождь): морской сине-бирюзовый (#1d4ed8 → #0f766e днём, #172554 → #134e4a ночью)
  if (c <= 67) {
    return {
      colors: isNight ? ['#172554', '#134e4a'] : ['#1d4ed8', '#0f766e'],
      icon: 'rainy',
      iconColor: '#7dd3fc',
    };
  }
  // 5. snow (Снег, вкл. WMO 85–86 снежные ливни): морозный льдисто-голубой
  if (c <= 77 || (c >= 85 && c <= 86)) {
    return {
      colors: isNight ? ['#1e3a5f', '#2563eb'] : ['#3b82f6', '#60a5fa'],
      icon: 'snow',
      iconColor: '#f0f9ff',
    };
  }
  // 6. showers (Ливень, WMO 80–82): штормовой кобальт с цианом
  if (c <= 82) {
    return {
      colors: isNight ? ['#0f172a', '#164e63'] : ['#1e3a8a', '#0369a1'],
      icon: 'rainy',
      iconColor: '#7dd3fc',
    };
  }
  // 7. thunder (Гроза): пурпурно-сланцевый (#3b0764 → #1e293b)
  return {
    colors: ['#3b0764', '#1e293b'],
    icon: 'thunderstorm',
    iconColor: '#facc15',
  };
};

// Micro-animations for the 16px status icons. They run on the UI thread
// (Reanimated) and stay subtle: a slow spin for sun/snow, falling rain drops,
// a soft pulse for the moon, a small drift for fog and an occasional lightning
// flash. Reduced-motion users get static icons.
function AnimatedWeatherIcon({
  name,
  size = 16,
  color,
  style,
  animation = 'none',
  duration = 20000,
}) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(animation === 'flash' ? 1 : 0);

  useEffect(() => {
    if (reduceMotion || animation === 'none') {
      progress.value = animation === 'flash' ? 1 : 0;
      return undefined;
    }
    if (animation === 'spin') {
      progress.value = withRepeat(
        withTiming(1, { duration, easing: Easing.linear }),
        -1,
        false,
      );
    } else if (animation === 'drift') {
      progress.value = withRepeat(
        withTiming(1, { duration, easing: Easing.inOut(Easing.quad) }),
        -1,
        true,
      );
    } else if (animation === 'pulse') {
      progress.value = withRepeat(
        withTiming(1, { duration, easing: Easing.inOut(Easing.sin) }),
        -1,
        true,
      );
    } else if (animation === 'flash') {
      progress.value = 1;
      progress.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 0 }),
          withDelay(2400, withTiming(1, { duration: 1 })),
          withTiming(0.35, { duration: 70 }),
          withTiming(1, { duration: 70 }),
          withDelay(120, withTiming(0.45, { duration: 60 })),
          withTiming(1, { duration: 60 }),
        ),
        -1,
        false,
      );
    }
    return () => cancelAnimation(progress);
  }, [animation, duration, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => {
    switch (animation) {
      case 'spin':
        return { transform: [{ rotate: `${progress.value * 360}deg` }] };
      case 'drift':
        return { transform: [{ translateX: progress.value * 3 - 1.5 }] };
      case 'pulse':
        return {
          opacity: 1 - progress.value * 0.18,
          transform: [{ scale: 1 + progress.value * 0.06 }],
        };
      case 'flash':
        return { opacity: progress.value };
      default:
        return {};
    }
  });

  return (
    <Animated.View style={[iconStyles.iconBox, style, animatedStyle]}>
      <Ionicons name={name} size={size} color={color} />
    </Animated.View>
  );
}

// A single rain streak. Streaks live in a clipped 5px strip under the cloud,
// fall at constant speed and are cut off at the bottom of the icon, so the
// loop never shows a jump or a blinking drop.
function RainStreak({ left, delay = 0, duration = 560 }) {
  const reduceMotion = useReducedMotion();
  const fall = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      fall.value = 0.45;
      return undefined;
    }
    fall.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration, easing: Easing.linear }), -1, false),
    );
    return () => cancelAnimation(fall);
  }, [delay, duration, reduceMotion]);

  const streakStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: fall.value * 5 }, { rotate: '10deg' }],
  }));

  return (
    <Animated.View style={[iconStyles.rainStreak, { left }, streakStyle]} />
  );
}

function RainConditionIcon() {
  return (
    <View style={iconStyles.rainWithDrops}>
      <Ionicons
        name="cloud"
        size={14}
        color="#FFFFFF"
        style={iconStyles.rainCloud}
      />
      <View style={iconStyles.rainFallArea}>
        <RainStreak left={3} />
        <RainStreak left={8} delay={185} />
        <RainStreak left={13} delay={370} />
      </View>
    </View>
  );
}

function StaticWeatherConditionIcon({ code, isNight }) {
  const c = code ?? 2;
  if (c === 0) {
    return (
      <View style={iconStyles.iconBox}>
        <Ionicons name={isNight ? 'moon' : 'sunny'} size={16} color={isNight ? '#fbbf24' : '#fde047'} />
      </View>
    );
  }
  if (c <= 3) {
    return (
      <View style={iconStyles.cloudWithSunMoon}>
        <View style={[iconStyles.iconBox, iconStyles.sunMoonBack]}>
          <Ionicons name={isNight ? 'moon' : 'sunny'} size={12} color="#fbbf24" />
        </View>
        <Ionicons name="cloud" size={14} color="#FFFFFF" style={iconStyles.cloudFront} />
      </View>
    );
  }
  if (c <= 48) {
    return (
      <View style={iconStyles.iconBox}>
        <Ionicons name="cloudy" size={16} color="#94a3b8" />
      </View>
    );
  }
  if (c <= 67 || (c >= 80 && c <= 82)) {
    return (
      <View style={iconStyles.rainWithDrops}>
        <Ionicons name="cloud" size={14} color="#FFFFFF" style={iconStyles.rainCloud} />
        <View style={iconStyles.rainFallArea}>
          <View style={[iconStyles.rainStreak, { left: 3, transform: [{ translateY: 1 }, { rotate: '10deg' }] }]} />
          <View style={[iconStyles.rainStreak, { left: 8, transform: [{ translateY: 2.5 }, { rotate: '10deg' }] }]} />
          <View style={[iconStyles.rainStreak, { left: 13, transform: [{ translateY: 1.5 }, { rotate: '10deg' }] }]} />
        </View>
      </View>
    );
  }
  if (c <= 77 || (c >= 85 && c <= 86)) {
    return (
      <View style={iconStyles.iconBox}>
        <Ionicons name="snow" size={16} color="#f0f9ff" />
      </View>
    );
  }
  return (
    <View style={iconStyles.iconBox}>
      <Ionicons name="thunderstorm" size={16} color="#facc15" />
    </View>
  );
}

function WeatherConditionIcon({ code, isNight }) {
  const c = code ?? 2;
  // 1. Clear (Ясно): солнце медленно вращается, месяц мягко «дышит»
  if (c === 0) {
    return (
      <AnimatedWeatherIcon
        name={isNight ? 'moon' : 'sunny'}
        size={16}
        color={isNight ? '#fbbf24' : '#fde047'}
        animation={isNight ? 'pulse' : 'spin'}
        duration={isNight ? 2600 : 22000}
      />
    );
  }
  // 2. Cloudy / Partly / Overcast (Облачно): Модерн Флат (белоснежное облако + золотое солнце/месяц сзади)
  if (c <= 3) {
    return (
      <View style={iconStyles.cloudWithSunMoon}>
        <AnimatedWeatherIcon
          name={isNight ? 'moon' : 'sunny'}
          size={12}
          color="#fbbf24"
          style={iconStyles.sunMoonBack}
          animation={isNight ? 'pulse' : 'spin'}
          duration={isNight ? 2600 : 26000}
        />
        <Ionicons
          name="cloud"
          size={14}
          color="#FFFFFF"
          style={iconStyles.cloudFront}
        />
      </View>
    );
  }
  // 3. Fog (Туман): облако едва заметно дрейфует
  if (c <= 48) {
    return (
      <AnimatedWeatherIcon
        name="cloudy"
        size={16}
        color="#94a3b8"
        animation="drift"
        duration={3600}
      />
    );
  }
  // 4. Rain (Дождь)
  if (c <= 67) {
    return <RainConditionIcon />;
  }
  // 5. Snow (Снег): снежинка медленно вращается
  if (c <= 77 || (c >= 85 && c <= 86)) {
    return (
      <AnimatedWeatherIcon
        name="snow"
        size={16}
        color="#f0f9ff"
        animation="spin"
        duration={16000}
      />
    );
  }
  // 6. Showers (Ливень, WMO 80–82)
  if (c <= 82) {
    return <RainConditionIcon />;
  }
  // 7. Thunder (Гроза): редкие вспышки
  return (
    <AnimatedWeatherIcon
      name="thunderstorm"
      size={16}
      color="#facc15"
      animation="flash"
    />
  );
}

const iconStyles = StyleSheet.create({
  iconBox: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cloudWithSunMoon: {
    width: 20,
    height: 16,
    position: 'relative',
    justifyContent: 'center',
  },
  sunMoonBack: {
    position: 'absolute',
    top: -1,
    right: 0,
  },
  cloudFront: {
    position: 'absolute',
    bottom: -1,
    left: 0,
  },
  rainWithDrops: {
    width: 20,
    height: 16,
    position: 'relative',
    justifyContent: 'center',
  },
  rainCloud: {
    position: 'absolute',
    top: -1,
    left: 0,
  },
  rainFallArea: {
    position: 'absolute',
    top: 11,
    left: 0,
    width: 20,
    height: 5,
    overflow: 'hidden',
  },
  rainStreak: {
    position: 'absolute',
    top: 0,
    width: 1.5,
    height: 3.5,
    borderRadius: 1,
    backgroundColor: '#7dd3fc',
  },
});