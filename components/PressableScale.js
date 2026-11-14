import React, { useRef } from 'react';
import { Animated, Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';

// Drop-in replacement for TouchableOpacity with a tactile press:
// a quick scale-down + fade on press-in, spring back on release.
// Everything stays on the native driver, so it is safe inside
// ScrollViews/FlatLists and does not block JS frames.
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const PRESS_IN_SPRING = { friction: 7, tension: 220, useNativeDriver: true };
const PRESS_OUT_SPRING = { friction: 6, tension: 160, useNativeDriver: true };

export default function PressableScale({
  children,
  style,
  scaleTo = 0.96,
  activeOpacity = 0.85,
  haptic = false,
  disabled = false,
  disabledOpacity = 1,
  onPressIn,
  onPressOut,
  ...rest
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  const animateIn = () => {
    Animated.parallel([
      Animated.spring(scale, { toValue: scaleTo, ...PRESS_IN_SPRING }),
      Animated.timing(opacity, {
        toValue: activeOpacity,
        duration: 90,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const animateOut = () => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, ...PRESS_OUT_SPRING }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();
  };

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(event) => {
        if (!disabled) {
          animateIn();
          if (haptic) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          }
        }
        if (onPressIn) onPressIn(event);
      }}
      onPressOut={(event) => {
        if (!disabled) animateOut();
        if (onPressOut) onPressOut(event);
      }}
      style={[
        style,
        {
          opacity: disabled ? disabledOpacity : opacity,
          transform: [{ scale }],
        },
      ]}
    >
      {children}
    </AnimatedPressable>
  );
}
