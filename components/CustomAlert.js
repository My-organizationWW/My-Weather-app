// Themed replacement for the system Alert (which renders light/system-styled
// and breaks the app's dark theme). Two modes:
//
// 1. Dialog (default): title + message + buttons. 1 button = full width,
//    2 buttons = side-by-side row (system-alert style), 3+ = stacked.
//    Button styles: cancel = ghost/bordered, destructive = red fill,
//    default (OK/confirm) = accent fill. Overlay taps do NOT dismiss (same
//    as the native alert); Android back falls back to the cancel button.
//
// 2. Toast ({ toast: true }): compact centered notification, no buttons,
//    auto-dismisses after 3s (fade out 300ms). Appear: fade in + scale.
//    Non-blocking — touches pass through.
//
// Usage:
//   const { alert, showAlert, hideAlert } = useCustomAlert();
//   showAlert({ title, message, icon, buttons });
//   showAlert({ toast: true, title, message });
//   <CustomAlert state={alert} onDismiss={hideAlert} theme={theme} fs={fs} />
import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Modal,
  Animated,
  Dimensions,
  Easing,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import PressableScale from './PressableScale';

// On some MIUI builds the Modal content host measures children with
// wrap-content height instead of fullscreen — then absoluteFill/flex can't
// stretch the container and justifyContent:center has nothing to center in
// (card sticks to the top). An explicit min-height forces it.
// 'screen' (not 'window'): with translucent system bars the modal window
// spans the full display, and 'window' height misses the bar zones leaving
// an undimmed strip at the bottom.
const SCREEN_H = Dimensions.get('screen').height;

export function useCustomAlert() {
  const [state, setState] = useState(null);
  const nextId = useRef(0);
  // `_id` lets CustomAlert remount the dialog for every showAlert call, so a
  // new alert never inherits the previous dialog's closing state.
  const showAlert = useCallback((opts) => setState({ ...opts, _id: ++nextId.current }), []);
  const hideAlert = useCallback(() => setState(null), []);
  return { alert: state, showAlert, hideAlert };
}

function ToastContent({ title, message, onDone, fs }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 10, useNativeDriver: true }),
    ]).start();
    const t = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(onDone);
    }, 2700);
    return () => clearTimeout(t);
  }, []);

  const styles = StyleSheet.create({
    toast: {
      backgroundColor: 'rgba(26,31,46,0.95)',
      borderRadius: 16,
      paddingHorizontal: 24,
      paddingVertical: 20,
      alignItems: 'center',
      maxWidth: 300,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.35,
      shadowRadius: 16,
      elevation: 24,
      transform: [{ scale }],
      opacity,
    },
    toastTitle: {
      color: '#ffffff',
      fontSize: fs.base,
      fontWeight: '700',
      textAlign: 'center',
      marginTop: 8,
    },
    toastMessage: {
      color: '#aab3cc',
      fontSize: fs.base * 0.85,
      textAlign: 'center',
      marginTop: 4,
    },
  });

  return (
    <Animated.View style={styles.toast}>
      <Ionicons name="checkmark-circle" size={48} color="#38b06b" />
      <Text style={styles.toastTitle}>{title}</Text>
      {message ? <Text style={styles.toastMessage}>{message}</Text> : null}
    </Animated.View>
  );
}

function AlertDialog({ state, onDismiss, styles }) {
  const { title, message, icon, buttons = [] } = state;
  const row = buttons.length === 2;
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.92)).current;
  const translateY = useRef(new Animated.Value(10)).current;
  const dim = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(dim, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
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
      Animated.timing(translateY, {
        toValue: 0,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [dim, opacity, scale, translateY]);

  // Play a short exit, then hand control back to the caller. Without this the
  // dialog used to vanish on the same frame the button was pressed.
  const finish = (after) => {
    if (closing.current) return;
    closing.current = true;
    Animated.parallel([
      Animated.timing(dim, {
        toValue: 0,
        duration: 140,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 130,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        toValue: 0.96,
        duration: 140,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(() => {
      try {
        onDismiss();
      } catch (e) {}
      if (after) {
        try {
          after();
        } catch (e) {}
      }
    });
  };

  const press = (btn) => finish(() => btn.onPress && btn.onPress());

  const cancelFallback = () => {
    const cancelBtn = buttons.find((b) => b.style === 'cancel');
    if (cancelBtn) press(cancelBtn);
    else finish();
  };

  return (
    <Modal
      transparent
      visible
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={cancelFallback}
    >
      <View style={styles.overlay}>
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFillObject, styles.dim, { opacity: dim }]}
        />
        <Animated.View
          style={[styles.card, { opacity, transform: [{ scale }, { translateY }] }]}
        >
          {icon ? (
            <View style={styles.iconWrap}>
              <Ionicons name={icon.name} size={44} color={icon.color} />
            </View>
          ) : null}
          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          <View style={row ? styles.btnRow : styles.btnColumn}>
            {buttons.map((b, i) => {
              const isDestructive = b.style === 'destructive';
              const isGhost = b.style === 'cancel';
              return (
                <PressableScale
                  key={`${b.text}-${i}`}
                  style={[
                    styles.btn,
                    row && styles.btnFlex,
                    isGhost ? styles.btnGhost : isDestructive ? styles.btnDestructive : styles.btnDefault,
                  ]}
                  onPress={() => press(b)}
                  scaleTo={0.97}
                  activeOpacity={0.8}
                >
                  <Text style={isGhost ? styles.btnGhostText : styles.btnFillText}>{b.text}</Text>
                </PressableScale>
              );
            })}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

export default function CustomAlert({ state, onDismiss, theme, fs }) {
  if (!state) return null;

  if (state.toast) {
    return (
      <Modal transparent visible animationType="none" statusBarTranslucent navigationBarTranslucent>
        <View
          pointerEvents="box-none"
          style={{ flex: 1, minHeight: SCREEN_H, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 }}
        >
          <View pointerEvents="none" style={{ alignItems: 'center' }}>
            <ToastContent title={state.title} message={state.message} onDone={onDismiss} fs={fs} />
          </View>
        </View>
      </Modal>
    );
  }

  const styles = StyleSheet.create({
    overlay: {
      ...StyleSheet.absoluteFillObject,
      minHeight: SCREEN_H,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 32,
    },
    dim: {
      backgroundColor: 'rgba(0,0,0,0.55)',
    },
    card: {
      width: '100%',
      maxWidth: 340,
      backgroundColor: theme.surface,
      borderRadius: 14,
      paddingHorizontal: 18,
      paddingTop: 18,
      paddingBottom: 10,
      borderWidth: 1,
      borderColor: theme.border,
    },
    iconWrap: {
      alignSelf: 'center',
      marginBottom: 10,
    },
    title: {
      color: theme.text,
      fontSize: fs.base,
      fontWeight: '700',
      textAlign: 'center',
      marginBottom: 6,
    },
    message: {
      color: theme.textSecondary,
      fontSize: fs.base * 0.9,
      textAlign: 'center',
      marginBottom: 16,
    },
    btnColumn: {
      marginBottom: 0,
    },
    btnRow: {
      flexDirection: 'row',
      gap: 8,
    },
    btn: {
      borderRadius: 10,
      paddingVertical: 11,
      alignItems: 'center',
      marginBottom: 8,
    },
    btnFlex: {
      flex: 1,
    },
    btnGhost: {
      borderWidth: 1,
      borderColor: theme.border,
    },
    btnDestructive: {
      backgroundColor: theme.danger,
    },
    btnDefault: {
      backgroundColor: theme.accent,
    },
    btnGhostText: {
      color: theme.text,
      fontWeight: '600',
      fontSize: fs.base * 0.9,
    },
    btnFillText: {
      color: theme.onAccent,
      fontWeight: '700',
      fontSize: fs.base * 0.9,
    },
  });

  return (
    <AlertDialog
      key={state._id ?? 'alert'}
      state={state}
      onDismiss={onDismiss}
      styles={styles}
    />
  );
}
