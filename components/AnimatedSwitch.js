import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';

// Themed replacement for the platform Switch. The native control already
// animates, but its size/colors differ per Android skin; this one keeps the
// app's palette, springs the thumb and scales slightly while pressed.
const TRACK_W = 46;
const TRACK_H = 26;
const THUMB = 20;
const PAD = 3;
const TRAVEL = TRACK_W - THUMB - PAD * 2;

export default function AnimatedSwitch({
  value,
  onValueChange,
  trackColor = { false: '#7f8db0', true: '#38b06b' },
  thumbColor = '#ffffff',
  style,
  disabled = false,
  haptic = true,
  accessibilityLabel,
}) {
  const progress = useRef(new Animated.Value(value ? 1 : 0)).current;
  const pressScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.spring(progress, {
      toValue: value ? 1 : 0,
      friction: 8,
      tension: 90,
      // Color interpolation and the thumb translate are JS-driven; the
      // press scale lives on a separate outer view and stays native.
      useNativeDriver: false,
    }).start();
  }, [value, progress]);

  const toggle = () => {
    if (disabled) return;
    if (haptic) Haptics.selectionAsync().catch(() => {});
    if (onValueChange) onValueChange(!value);
  };

  const trackBackground = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [trackColor.false, trackColor.true],
  });
  const thumbTranslate = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, TRAVEL],
  });

  return (
    <Pressable
      onPress={toggle}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: !!value, disabled }}
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      onPressIn={() => {
        Animated.spring(pressScale, {
          toValue: 0.92,
          friction: 7,
          useNativeDriver: true,
        }).start();
      }}
      onPressOut={() => {
        Animated.spring(pressScale, {
          toValue: 1,
          friction: 7,
          useNativeDriver: true,
        }).start();
      }}
      style={[style, disabled && { opacity: 0.45 }]}
    >
      <Animated.View style={{ transform: [{ scale: pressScale }] }}>
        <Animated.View style={[styles.track, { backgroundColor: trackBackground }]}>
          <Animated.View
            style={[
              styles.thumb,
              {
                backgroundColor: thumbColor,
                transform: [{ translateX: thumbTranslate }],
              },
            ]}
          />
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: TRACK_W,
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    justifyContent: 'center',
  },
  thumb: {
    position: 'absolute',
    top: PAD,
    left: PAD,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.22,
    shadowRadius: 2,
    elevation: 2,
  },
});
