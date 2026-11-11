import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, RadialGradient, Stop, Rect } from 'react-native-svg';
import { getWeatherTheme } from './DraggableCityCard';

// Top card for the device's geolocation. Rendered ONLY when coordinates were
// successfully resolved (location !== null). Deliberately NOT a DraggableCityCard:
// no drag handle, no checkbox, no delete — it is not part of the saved list.
export default function CurrentLocationCard({ item, theme, fs, t, onPress, style }) {
  const safeItem = { ...item, isNight: item?.isNight ?? false };
  const weatherTheme = getWeatherTheme(safeItem.weathercode, safeItem.isNight);
  const subText = 'rgba(255, 255, 255, 0.85)';
  const minMaxColor = 'rgba(255, 255, 255, 0.7)';

  const styles = useMemo(() => StyleSheet.create({
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
      marginBottom: fs.spacing,
    },
    cardBackground: {
      borderRadius: 28,
      overflow: 'hidden',
      width: '100%',
    },
    cardBody: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: fs.spacing * 1.25,
      paddingVertical: fs.spacing,
      minHeight: fs.cardHeight * 1.375,
    },
    pinWrap: {
      width: fs.spacing * 2.5,
      height: fs.spacing * 2.5,
      borderRadius: 12,
      backgroundColor: 'rgba(255, 255, 255, 0.2)',
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: fs.spacing * 0.75,
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
    locationBadge: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    locationBadgeText: {
      fontSize: fs.small * 1.05,
      fontWeight: '500',
      color: 'rgba(255, 255, 255, 0.85)',
      marginLeft: 4,
      flexShrink: 1,
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
  }), [theme, fs]);

  return (
    <View style={[styles.cardContainer, style]}>
      <Pressable onPress={onPress} disabled={!onPress}>
        <View style={styles.cardBackground}>
          <LinearGradient
            colors={weatherTheme.colors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
            <Defs>
              <RadialGradient
                id="current-location-glow"
                cx="82%"
                cy="35%"
                rx="55%"
                ry="65%"
                fx="82%"
                fy="35%"
              >
                <Stop offset="0%" stopColor="#ffffff" stopOpacity={0.16} />
                <Stop offset="55%" stopColor="#ffffff" stopOpacity={0.05} />
                <Stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#current-location-glow)" />
          </Svg>
          <View style={styles.cardBody}>
            <View style={styles.pinWrap}>
              <Ionicons name="location-sharp" size={22} color="#FFFFFF" />
            </View>
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
              <View style={styles.locationBadge}>
                <Ionicons
                  name="compass"
                  size={15}
                  color="#38bdf8"
                />
                <Text style={styles.locationBadgeText} numberOfLines={1} ellipsizeMode="tail">
                  {t('cities.current_location')}
                </Text>
              </View>
            </View>
            <View style={styles.cardRight}>
              <View style={styles.tempRow}>
                <Text style={styles.cityTemp}>{safeItem.temp || '0'}</Text>
                <Text style={styles.tempDegree}>°</Text>
              </View>
              <Text style={styles.cityMinMax}>{safeItem.minMax || ''}</Text>
            </View>
          </View>
        </View>
      </Pressable>
    </View>
  );
}
