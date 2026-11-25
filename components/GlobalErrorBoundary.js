import React, { Component } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { logCrash } from '../utils/crashLogger';
import i18n from '../i18n';

class GlobalErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    const appState = this._getAppState();
    logCrash(error, errorInfo, appState);
    this.setState({ errorInfo });
  }

  _getAppState() {
    return {
      theme: 'unknown',
      language: i18n?.language || 'unknown',
      citiesCount: 0,
      selectedCity: 'none',
    };
  }

  handleRecover = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      const tr = (key, fallback) => {
        try {
          const val = i18n.t(key);
          return val && val !== key ? val : fallback;
        } catch {
          return fallback;
        }
      };
      return (
        <View style={styles.fallbackContainer}>
          <Text style={styles.fallbackText}>
            {tr('errorBoundaryTitle', 'Что-то пошло не так')}
          </Text>
          <Text style={styles.fallbackSubText}>
            {tr('errorBoundarySubtitle', 'Попробуйте восстановить экран или перезапустить приложение.')}
          </Text>
          <Pressable style={styles.recoverBtn} onPress={this.handleRecover}>
            <Text style={styles.recoverBtnText}>
              {tr('errorBoundaryRecover', 'Попробовать снова')}
            </Text>
          </Pressable>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  fallbackContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#1c2333',
  },
  fallbackText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FF453A',
    marginBottom: 10,
    textAlign: 'center',
  },
  fallbackSubText: {
    fontSize: 15,
    color: '#aab3cc',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 20,
  },
  recoverBtn: {
    backgroundColor: '#4a90d9',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  recoverBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
});

export default GlobalErrorBoundary;
