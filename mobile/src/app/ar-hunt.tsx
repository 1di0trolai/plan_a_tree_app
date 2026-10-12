import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { localDateKey } from '@/data/seed';
import { useApp } from '@/store/AppStore';
import { theme } from '@/theme';
import type { Beast } from '@/types/app';

type HuntStep = 'ready' | 'scanning' | 'result';

export default function ArHuntScreen() {
  const { plantId } = useLocalSearchParams<{ plantId?: string }>();
  const { ready, state, activePlant, catchCreature } = useApp();
  const [permission, requestPermission] = useCameraPermissions();
  const [step, setStep] = useState<HuntStep>('ready');
  const [progress, setProgress] = useState(0);
  const [caught, setCaught] = useState<{ beast: Beast; isNew: boolean } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const completingRef = useRef(false);

  const plant = state.plants.find((entry) => entry.id === plantId) ?? activePlant;
  const chibi = state.plantChibis.find((entry) => entry.plantId === plant?.id);
  const arUsedToday = state.daily.lastCatchDate === localDateKey();
  const lastHuntPlant = state.plants.find((entry) => entry.id === state.daily.lastCatchPlantId);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const finishScan = () => {
    if (completingRef.current) return;
    completingRef.current = true;
    const result = catchCreature(plant?.id ?? activePlant.id);
    setCaught(result);
    setStep('result');
    completingRef.current = false;
  };

  const startScan = () => {
    if (arUsedToday || step === 'scanning') return;
    setCaught(null);
    setProgress(0);
    setStep('scanning');
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setProgress((current) => {
        const next = Math.min(100, current + 4);
        if (next === 100) {
          if (timerRef.current) clearInterval(timerRef.current);
          timerRef.current = null;
          setTimeout(finishScan, 180);
        }
        return next;
      });
    }, 75);
  };

  if (!ready || !permission) {
    return <View style={styles.loading}><ActivityIndicator color="#CDEFBF" size="large" /></View>;
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      {permission.granted && step !== 'result' ? (
        <CameraView active facing="back" style={StyleSheet.absoluteFill} />
      ) : (
        <View style={styles.cameraFallback}>
          <View style={styles.fallbackGlow} />
          <Text style={styles.fallbackEmoji}>{chibi?.fallbackEmoji ?? '🌿'}</Text>
        </View>
      )}
      <View style={styles.scrim} />

      <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable accessibilityLabel="Đóng săn AR" accessibilityRole="button" onPress={() => router.back()} style={styles.roundButton}>
            <Ionicons name="close" size={24} color="#FFFFFF" />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>SĂN THÚ AR · {plant?.name.toLocaleUpperCase('vi')}</Text>
            <Text style={styles.title}>{step === 'scanning' ? 'Đang dò chuyển động...' : step === 'result' ? 'Đã phát hiện sinh vật!' : 'Soi quanh cây thật'}</Text>
          </View>
          <View style={styles.roundButton}><Ionicons name="flashlight-outline" size={21} color="#FFFFFF" /></View>
        </View>

        <View style={styles.scannerArea}>
          {step === 'result' && caught?.beast ? (
            <View style={styles.creatureReveal}>
              <View style={styles.creatureHalo} />
              <Text style={styles.creatureEmoji}>{caught.beast.icon}</Text>
            </View>
          ) : (
            <View style={[styles.reticle, step === 'scanning' && styles.reticleActive]}>
              <View style={[styles.corner, styles.topLeft]} />
              <View style={[styles.corner, styles.topRight]} />
              <View style={[styles.corner, styles.bottomLeft]} />
              <View style={[styles.corner, styles.bottomRight]} />
              <Ionicons name={step === 'scanning' ? 'scan' : 'paw-outline'} size={74} color="#CDEFBF" />
              <Text style={styles.reticleText}>{step === 'scanning' ? 'Di chuyển chậm quanh chậu cây' : 'Đưa camera lại gần cây'}</Text>
            </View>
          )}
        </View>

        <View style={styles.controlPanel}>
          {arUsedToday && step === 'ready' ? (
            <>
              <View style={styles.lockIcon}><Ionicons name="lock-closed" size={25} color="#203A2F" /></View>
              <Text style={styles.panelTitle}>Lượt săn hôm nay đã dùng</Text>
              <Text style={styles.panelCaption}>Lượt chung đã được dùng quanh {lastHuntPlant?.name ?? 'một cây trong vườn'}. Lượt mới sẽ mở vào ngày mai.</Text>
              <Pressable onPress={() => router.back()} style={styles.primaryButton}><Text style={styles.primaryButtonText}>Trở về khu vườn</Text></Pressable>
            </>
          ) : null}

          {!arUsedToday && step === 'ready' ? (
            <>
              {!permission.granted && (
                <Pressable onPress={requestPermission} style={styles.permissionButton}>
                  <Ionicons name="camera-outline" size={20} color="#203A2F" />
                  <Text style={styles.permissionText}>Cho phép hiển thị Camera</Text>
                </Pressable>
              )}
              <Text style={styles.panelTitle}>1 lượt săn chung hôm nay</Text>
              <Text style={styles.panelCaption}>{permission.granted ? 'Camera đang hoạt động. Hãy đứng cạnh cây và bắt đầu quét.' : 'Bạn có thể cấp quyền camera hoặc chạy mô phỏng để kiểm tra luồng.'}</Text>
              <Pressable onPress={startScan} style={styles.primaryButton}>
                <Ionicons name="scan" size={20} color="#203A2F" />
                <Text style={styles.primaryButtonText}>{permission.granted ? 'Bắt đầu quét' : 'Chạy mô phỏng'}</Text>
              </Pressable>
            </>
          ) : null}

          {step === 'scanning' ? (
            <>
              <View style={styles.progressHeader}><Text style={styles.scanningText}>Đang tìm dấu chân và chuyển động</Text><Text style={styles.progressText}>{progress}%</Text></View>
              <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress}%` }]} /></View>
              <Text style={styles.panelCaption}>Giữ camera hướng về khu vực quanh {plant?.name ?? 'cây'}.</Text>
            </>
          ) : null}

          {step === 'result' ? (
            <>
              <Text style={styles.panelTitle}>{caught?.beast.name ?? 'Chưa tìm thấy dấu vết'}</Text>
              <Text style={styles.rarity}>{caught?.beast ? `${caught.beast.rarity} · ${caught.isNew ? 'Thú mới!' : 'Đã có, +1 số lượng'}` : 'Hãy thử lại vào ngày mai'}</Text>
              <Text style={styles.panelCaption}>{caught?.beast ? 'Sinh vật đã được chuyển vào Kho đồ. Lượt săn chung hôm nay đã hoàn thành.' : 'Lượt săn hôm nay đã được ghi nhận.'}</Text>
              <Pressable onPress={() => router.back()} style={styles.primaryButton}><Text style={styles.primaryButtonText}>Cất vào kho và trở về</Text></Pressable>
            </>
          ) : null}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#14231C', flex: 1 },
  loading: { alignItems: 'center', backgroundColor: '#14231C', flex: 1, justifyContent: 'center' },
  cameraFallback: { alignItems: 'center', backgroundColor: '#274438', flex: 1, justifyContent: 'center' },
  fallbackGlow: { backgroundColor: 'rgba(205,239,191,0.10)', borderRadius: 150, height: 300, position: 'absolute', width: 300 },
  fallbackEmoji: { fontSize: 130, opacity: 0.65 },
  scrim: { backgroundColor: 'rgba(7,17,12,0.28)', bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  safeArea: { flex: 1 },
  header: { alignItems: 'center', flexDirection: 'row', paddingHorizontal: 16, paddingTop: 6 },
  roundButton: { alignItems: 'center', backgroundColor: 'rgba(10,20,15,0.58)', borderColor: 'rgba(255,255,255,0.16)', borderRadius: 17, borderWidth: 1, height: 46, justifyContent: 'center', width: 46 },
  headerCopy: { flex: 1, marginHorizontal: 12 },
  eyebrow: { color: '#CDEFBF', fontSize: 9, fontWeight: '900', letterSpacing: 0.9, textAlign: 'center' },
  title: { color: '#FFFFFF', fontSize: 17, fontWeight: '800', marginTop: 3, textAlign: 'center' },
  scannerArea: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  reticle: { alignItems: 'center', height: 260, justifyContent: 'center', width: 260 },
  reticleActive: { backgroundColor: 'rgba(205,239,191,0.05)', borderRadius: 130 },
  corner: { borderColor: '#CDEFBF', height: 54, position: 'absolute', width: 54 },
  topLeft: { borderLeftWidth: 3, borderTopLeftRadius: 12, borderTopWidth: 3, left: 0, top: 0 },
  topRight: { borderRightWidth: 3, borderTopRightRadius: 12, borderTopWidth: 3, right: 0, top: 0 },
  bottomLeft: { borderBottomLeftRadius: 12, borderBottomWidth: 3, borderLeftWidth: 3, bottom: 0, left: 0 },
  bottomRight: { borderBottomRightRadius: 12, borderBottomWidth: 3, borderRightWidth: 3, bottom: 0, right: 0 },
  reticleText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700', marginTop: 12 },
  creatureReveal: { alignItems: 'center', justifyContent: 'center' },
  creatureHalo: { backgroundColor: 'rgba(205,239,191,0.24)', borderColor: 'rgba(255,255,255,0.32)', borderRadius: 110, borderWidth: 2, height: 220, position: 'absolute', width: 220 },
  creatureEmoji: { fontSize: 126 },
  controlPanel: { alignItems: 'center', backgroundColor: 'rgba(249,250,244,0.96)', borderTopLeftRadius: 30, borderTopRightRadius: 30, minHeight: 220, paddingBottom: 22, paddingHorizontal: 22, paddingTop: 20 },
  lockIcon: { alignItems: 'center', backgroundColor: '#DDECD8', borderRadius: 17, height: 48, justifyContent: 'center', width: 48 },
  panelTitle: { color: theme.colors.text, fontSize: 19, fontWeight: '900', textAlign: 'center' },
  rarity: { color: theme.colors.primaryDark, fontSize: 12, fontWeight: '900', marginTop: 4 },
  panelCaption: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 6, textAlign: 'center' },
  permissionButton: { alignItems: 'center', backgroundColor: '#E8F2E4', borderRadius: 14, flexDirection: 'row', gap: 7, marginBottom: 12, paddingHorizontal: 13, paddingVertical: 9 },
  permissionText: { color: theme.colors.primaryDark, fontSize: 11, fontWeight: '800' },
  primaryButton: { alignItems: 'center', backgroundColor: '#CDEFBF', borderRadius: 17, flexDirection: 'row', gap: 8, justifyContent: 'center', marginTop: 15, minHeight: 51, paddingHorizontal: 22, width: '100%' },
  primaryButtonText: { color: '#203A2F', fontSize: 14, fontWeight: '900' },
  progressHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', width: '100%' },
  scanningText: { color: theme.colors.text, fontSize: 13, fontWeight: '800' },
  progressText: { color: theme.colors.primaryDark, fontSize: 13, fontWeight: '900' },
  progressTrack: { backgroundColor: '#DDE3DA', borderRadius: 8, height: 9, marginTop: 11, overflow: 'hidden', width: '100%' },
  progressFill: { backgroundColor: theme.colors.primary, borderRadius: 8, height: '100%' },
});
