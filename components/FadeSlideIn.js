import React, { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';

// Small mount/reveal helper: fades in while rising a few pixels. Used for
// short lists (phenomena results, probe rows) where a stagger reads well
// without touching the heavy forecast lists.
export default function FadeSlideIn({
  children,
  style,
  delay = 0,
  distance = 8,
  duration = 240,
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(distance)).current;

  useEffect(() => {
    const animation = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration,
        delay,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: duration + 40,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [delay, distance, duration, opacity, translateY]);

  return (
    <Animated.View
      style={[style, { opacity, transform: [{ translateY }] }]}
    >
      {children}
    </Animated.View>
  );
}
