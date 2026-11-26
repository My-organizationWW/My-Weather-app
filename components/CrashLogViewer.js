import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableWithoutFeedback,
  ScrollView,
  ActivityIndicator,
  Share,
  StyleSheet,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import PressableScale from './PressableScale';
import * as FileSystem from 'expo-file-system/legacy';
import {
  listInternalLogs,
  listDownloadLogs,
  readDownloadLog,
  deleteDownloadLog,
  getInternalLogDir,
  getPublicLogDir,
  testLogWrite,
} from '../utils/crashLogger';

export default function CrashLogViewer({ visible, onClose, theme, fs, showAlert }) {
  const { t } = useTranslation();
  const [internalFiles, setInternalFiles] = useState([]);
  const [downloadFiles, setDownloadFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandedKey, setExpandedKey] = useState(null);
  const [contents, setContents] = useState({});
  const [loadingContent, setLoadingContent] = useState(null);
  const [selfTest, setSelfTest] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [internal, download] = await Promise.all([listInternalLogs(), listDownloadLogs()]);
      setInternalFiles(internal);
      setDownloadFiles(download);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      setExpandedKey(null);
      setContents({});
      setSelfTest(null);
      refresh();
    }
  }, [visible, refresh]);

  const readContent = async (file) => {
    if (file.location === 'download') {
      return readDownloadLog(file.path);
    }
    return FileSystem.readAsStringAsync(file.path);
  };

  const toggleExpand = async (file) => {
    const key = `${file.location}:${file.path}`;
    if (expandedKey === key) {
      setExpandedKey(null);
      return;
    }
    setExpandedKey(key);
    if (!contents[key]) {
      setLoadingContent(key);
      try {
        const text = await readContent(file);
        setContents((prev) => ({ ...prev, [key]: text }));
      } catch (e) {
        setContents((prev) => ({ ...prev, [key]: t('crashLogsReadError', { error: e?.message || String(e) }) }));
      } finally {
        setLoadingContent(null);
      }
    }
  };

  const shareLog = async (file) => {
    try {
      const key = `${file.location}:${file.path}`;
      let text = contents[key];
      if (!text) text = await readContent(file);
      await Share.share({ message: `Crash log ${file.name}:\n\n${text}` });
    } catch (e) {}
  };

  const runSelfTest = async () => {
    setSelfTest({ running: true });
    const result = await testLogWrite();
    setSelfTest(result);
    if (result.ok) refresh();
  };

  const clearInternal = () => {
    const doClear = async () => {
      try {
        for (const f of internalFiles) {
          await FileSystem.deleteAsync(f.path, { idempotent: true });
        }
      } catch (e) {}
      refresh();
    };
    if (showAlert) {
      showAlert({
        title: t('crashLogsClearTitle'),
        message: t('crashLogsClearMsg', { count: internalFiles.length }),
        buttons: [
          { text: t('cancel'), style: 'cancel' },
          { text: t('crashLogsDelete'), style: 'destructive', onPress: doClear },
        ],
      });
    } else {
      doClear();
    }
  };

  const deleteOneDownload = async (file) => {
    try {
      await deleteDownloadLog(file.path);
    } catch (e) {}
    refresh();
  };

  const styles = useMemo(() => StyleSheet.create({
    overlay: { flex: 1, backgroundColor: theme.dim || 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: theme.background,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      maxHeight: '88%',
      paddingBottom: 24,
    },
    handle: { width: 48, height: 6, borderRadius: 3, backgroundColor: theme.border, alignSelf: 'center', marginTop: 10, marginBottom: 8 },
    title: { fontSize: fs.base, fontWeight: '700', color: theme.text, textAlign: 'center', marginBottom: 4 },
    subtitle: { fontSize: fs.small, color: theme.textMuted, textAlign: 'center', marginBottom: 10, paddingHorizontal: 16 },
    sectionTitle: { fontSize: fs.small, fontWeight: '700', color: theme.textMuted, paddingHorizontal: 16, marginTop: 8, marginBottom: 6 },
    list: { paddingHorizontal: 16 },
    fileCard: { backgroundColor: theme.surface, borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: theme.border },
    fileName: { fontSize: fs.small, fontWeight: '600', color: theme.text },
    fileMeta: { fontSize: fs.small * 0.85, color: theme.textMuted, marginTop: 2 },
    row: { flexDirection: 'row', marginTop: 8, flexWrap: 'wrap' },
    btn: { backgroundColor: theme.accent, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, marginRight: 8, marginBottom: 4 },
    btnText: { color: theme.onAccent || '#fff', fontSize: fs.small, fontWeight: '600' },
    btnGhost: { backgroundColor: theme.surfaceRaised, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, marginRight: 8, marginBottom: 4 },
    btnGhostText: { color: theme.text, fontSize: fs.small, fontWeight: '600' },
    btnDangerText: { color: theme.danger || '#dc2626', fontSize: fs.small, fontWeight: '600' },
    content: { fontSize: fs.small * 0.85, color: theme.text, marginTop: 8, backgroundColor: theme.background, borderRadius: 8, padding: 8 },
    empty: { fontSize: fs.base, color: theme.textMuted, textAlign: 'center', marginVertical: 12, paddingHorizontal: 16 },
    selfTestOk: { fontSize: fs.small, color: theme.accent2 || '#16a34a', textAlign: 'center', paddingHorizontal: 16, marginBottom: 6 },
    selfTestFail: { fontSize: fs.small, color: theme.danger || '#dc2626', textAlign: 'center', paddingHorizontal: 16, marginBottom: 6 },
    footer: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, marginTop: 12 },
  }), [theme, fs]);

  if (!visible) return null;

  const renderFile = (file) => {
    const key = `${file.location}:${file.path}`;
    return (
      <View key={key} style={styles.fileCard}>
        <Text style={styles.fileName}>{file.name}</Text>
        <Text style={styles.fileMeta}>
          {file.size ? `${(file.size / 1024).toFixed(1)} KB · ` : ''}
          {file.location === 'download' ? t('crashLogsAppFolder') : t('crashLogsInternalFolder')}
          {file.mtime ? ` · ${new Date(file.mtime > 1e12 ? file.mtime : file.mtime * 1000).toLocaleString()}` : ''}
        </Text>
        <View style={styles.row}>
          <PressableScale style={styles.btnGhost} onPress={() => toggleExpand(file)} scaleTo={0.97}>
            <Text style={styles.btnGhostText}>{expandedKey === key ? t('crashLogsHide') : t('crashLogsShow')}</Text>
          </PressableScale>
          <PressableScale style={styles.btn} onPress={() => shareLog(file)} scaleTo={0.97}>
            <Text style={styles.btnText}>{t('crashLogsShare')}</Text>
          </PressableScale>
          {file.location === 'download' && (
            <PressableScale style={styles.btnGhost} onPress={() => deleteOneDownload(file)} scaleTo={0.97}>
              <Text style={styles.btnDangerText}>{t('crashLogsDelete')}</Text>
            </PressableScale>
          )}
        </View>
        {expandedKey === key &&
          (loadingContent === key ? (
            <ActivityIndicator size="small" color={theme.accent} style={{ marginTop: 8 }} />
          ) : (
            <Text style={styles.content} selectable>
              {contents[key] || ''}
            </Text>
          ))}
      </View>
    );
  };

  return (
    <Modal transparent visible animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay} />
      </TouchableWithoutFeedback>
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title}>{t('crashLogsTitle')}</Text>
        <Text style={styles.subtitle}>{t('crashLogsSubtitle')}</Text>
        {selfTest && !selfTest.running && (
          selfTest.ok ? (
            <Text style={styles.selfTestOk}>{t('crashLogsTestOk', { dir: selfTest.dir })}</Text>
          ) : (
            <Text style={styles.selfTestFail}>{t('crashLogsTestFail', { error: selfTest.error })}</Text>
          )
        )}
        {loading ? (
          <ActivityIndicator size="large" color={theme.accent} style={{ marginVertical: 24 }} />
        ) : (
          <ScrollView style={styles.list}>
            <Text style={styles.sectionTitle}>{t('crashLogsPublicSection')}</Text>
            {downloadFiles.length === 0 ? (
              <Text style={styles.empty}>{t('crashLogsEmptyPublic')}</Text>
            ) : (
              downloadFiles.map(renderFile)
            )}
            <Text style={styles.sectionTitle}>{t('crashLogsInternalSection')}</Text>
            {internalFiles.length === 0 ? (
              <Text style={styles.empty}>{t('crashLogsEmptyInternal')}</Text>
            ) : (
              internalFiles.map(renderFile)
            )}
            <Text style={styles.sectionTitle}>{t('crashLogsDiagSection')}</Text>
            <Text style={[styles.fileMeta, { paddingHorizontal: 0, marginBottom: 2 }]}>
              {t('crashLogsAppFolder')}: {getPublicLogDir() || t('crashLogsUnavailable')}
            </Text>
            <Text style={[styles.fileMeta, { paddingHorizontal: 0, marginBottom: 8 }]}>
              {t('crashLogsInternalFolder')}: {getInternalLogDir() || t('crashLogsUnavailable')}
            </Text>
            <View style={styles.row}>
              <PressableScale style={styles.btnGhost} onPress={runSelfTest} disabled={selfTest?.running} scaleTo={0.97}>
                <Text style={styles.btnGhostText}>
                  {selfTest?.running ? t('crashLogsTesting') : t('crashLogsTestWrite')}
                </Text>
              </PressableScale>
            </View>
          </ScrollView>
        )}
        <View style={styles.footer}>
          <PressableScale style={styles.btnGhost} onPress={onClose} scaleTo={0.97}>
            <Text style={styles.btnGhostText}>{t('netdiagClose')}</Text>
          </PressableScale>
          {internalFiles.length > 0 && (
            <PressableScale style={styles.btnGhost} onPress={clearInternal} scaleTo={0.97}>
              <Text style={styles.btnDangerText}>{t('crashLogsClearInternal')}</Text>
            </PressableScale>
          )}
        </View>
      </View>
    </Modal>
  );
}
