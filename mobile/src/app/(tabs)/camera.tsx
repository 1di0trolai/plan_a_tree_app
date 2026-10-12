import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApp } from '@/store/AppStore';
import { theme } from '@/theme';
import type { Analysis, CaptureSource } from '@/types/app';

type CameraStep = 'capture' | 'preview' | 'analyzing' | 'result';

export default function CheckInCameraScreen() {
  const { ready, state, activePlant, setActivePlantIndex, checkIn } = useApp();
  const [step, setStep] = useState<CameraStep>('capture');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [source, setSource] = useState<CaptureSource>('library');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [firstToday, setFirstToday] = useState(false);
  const activeChibi = state.plantChibis.find((entry) => entry.plantId === activePlant?.id);

  const resetCapture = () => {
    setImageUri(null);
    setAnalysis(null);
    setStep('capture');
  };

  const choosePlant = (index: number) => {
    setActivePlantIndex(index);
    resetCapture();
  };

  const receiveImage = (uri: string, nextSource: CaptureSource) => {
    setImageUri(uri);
    setSource(nextSource);
    setAnalysis(null);
    setStep('preview');
  };

  const takePhoto = async () => {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Cần quyền Camera', 'Hãy cho phép PAT dùng camera để chụp ảnh check-in cây thật.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        cameraType: ImagePicker.CameraType.back,
        mediaTypes: ['images'],
        quality: 0.8,
      });
      const uri = result.canceled ? null : result.assets[0]?.uri;
      if (uri) receiveImage(uri, 'camera');
    } catch {
      Alert.alert('Không mở được camera', 'Bạn vẫn có thể chọn một ảnh có sẵn để thử luồng check-in.');
    }
  };

  const pickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: false,
        mediaTypes: ['images'],
        quality: 0.8,
        selectionLimit: 1,
      });
      const uri = result.canceled ? null : result.assets[0]?.uri;
      if (uri) receiveImage(uri, 'library');
    } catch {
      Alert.alert('Không mở được thư viện', 'Hãy kiểm tra quyền ảnh của PAT rồi thử lại.');
    }
  };

  const analyzePhoto = async () => {
    if (!activePlant || !imageUri) return;
    setStep('analyzing');
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const result = checkIn({ plantId: activePlant.id, imageUri, source });
    setAnalysis(result.analysis);
    setFirstToday(result.firstToday);
    setStep('result');
  };

  if (!ready) {
    return <SafeAreaView style={styles.safeArea}><ActivityIndicator color={theme.colors.primaryDark} size="large" /></SafeAreaView>;
  }

  if (!activePlant) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.emptyState}>
          <Text style={styles.emptyEmoji}>🌱</Text>
          <Text style={styles.emptyTitle}>Chưa có cây để check-in</Text>
          <Pressable onPress={() => router.navigate('/(tabs)/garden')} style={styles.primaryButton}><Text style={styles.primaryButtonText}>Về khu vườn</Text></Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>CAMERA CHECK-IN</Text>
            <Text style={styles.title}>Theo dõi cây thật</Text>
          </View>
          <View style={styles.livePill}><View style={styles.liveDot} /><Text style={styles.liveText}>MỖI NGÀY</Text></View>
        </View>

        <ScrollView contentContainerStyle={styles.plantSelector} horizontal showsHorizontalScrollIndicator={false}>
          {state.plants.map((plant, index) => {
            const selected = plant.id === activePlant.id;
            const chibi = state.plantChibis.find((entry) => entry.plantId === plant.id);
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected }}
                key={plant.id}
                onPress={() => choosePlant(index)}
                style={[styles.plantChip, selected && styles.plantChipSelected]}>
                <Text style={styles.plantChipEmoji}>{chibi?.fallbackEmoji ?? '🪴'}</Text>
                <Text style={[styles.plantChipText, selected && styles.plantChipTextSelected]}>{plant.name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.cameraFrame}>
          {imageUri ? (
            <Image accessibilityLabel={`Ảnh check-in của ${activePlant.name}`} source={{ uri: imageUri }} style={styles.previewImage} />
          ) : (
            <View style={styles.viewfinder}>
              <View style={[styles.corner, styles.cornerTopLeft]} />
              <View style={[styles.corner, styles.cornerTopRight]} />
              <View style={[styles.corner, styles.cornerBottomLeft]} />
              <View style={[styles.corner, styles.cornerBottomRight]} />
              <View style={styles.cameraLeaf}><Ionicons name="leaf" size={42} color="#DDF0D7" /></View>
              <Text style={styles.viewfinderTitle}>Đặt toàn bộ cây vào khung</Text>
              <Text style={styles.viewfinderCaption}>Giữ máy thẳng và chụp ở nơi đủ sáng</Text>
            </View>
          )}
          <View style={styles.plantLabel}><Ionicons name="location" size={14} color="#FFFFFF" /><Text style={styles.plantLabelText}>{activePlant.name} · {activePlant.species}</Text></View>
        </View>

        {step === 'capture' && (
          <View style={styles.captureActions}>
            <Pressable accessibilityRole="button" onPress={pickImage} style={styles.sideAction}>
              <Ionicons name="images-outline" size={23} color={theme.colors.primaryDark} />
              <Text style={styles.sideActionText}>Thư viện</Text>
            </Pressable>
            <Pressable accessibilityLabel="Chụp ảnh cây" accessibilityRole="button" onPress={takePhoto} style={styles.shutterOuter}>
              <View style={styles.shutterInner}><Ionicons name="camera" size={27} color="#FFFFFF" /></View>
            </Pressable>
            <View style={styles.sideHint}><Ionicons name="sunny-outline" size={23} color={theme.colors.primaryDark} /><Text style={styles.sideActionText}>Đủ sáng</Text></View>
          </View>
        )}

        {step === 'preview' && (
          <View style={styles.actionPanel}>
            <Text style={styles.actionTitle}>Ảnh này đã rõ toàn cây chưa?</Text>
            <Text style={styles.actionCaption}>Ảnh thật sẽ được lưu riêng, sau đó app tạo kết quả phân tích mẫu.</Text>
            <Pressable onPress={analyzePhoto} style={styles.primaryButton}><Ionicons name="sparkles" size={19} color="#FFFFFF" /><Text style={styles.primaryButtonText}>Phân tích và lưu check-in</Text></Pressable>
            <Pressable onPress={resetCapture} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Chụp lại</Text></Pressable>
          </View>
        )}

        {step === 'analyzing' && (
          <View style={styles.analyzingCard} accessibilityRole="progressbar">
            <ActivityIndicator color={theme.colors.primaryDark} size="large" />
            <Text style={styles.analyzingTitle}>Đang phân tích ảnh mẫu...</Text>
            <Text style={styles.actionCaption}>Màu lá · Độ ẩm · Dấu hiệu bất thường</Text>
          </View>
        )}

        {step === 'result' && analysis && (
          <View style={styles.resultCard}>
            <View style={styles.resultHeader}>
              <View style={styles.resultIcon}><Ionicons name="checkmark" size={22} color={theme.colors.primaryDark} /></View>
              <View style={styles.resultCopy}><Text style={styles.resultTitle}>{analysis.title}</Text><Text style={styles.resultLevel}>{analysis.level}</Text></View>
            </View>
            <Text style={styles.resultSummary}>{analysis.summary}</Text>
            {analysis.actions.map((action, index) => (
              <View key={action} style={styles.careRow}><View style={styles.careNumber}><Text style={styles.careNumberText}>{index + 1}</Text></View><Text style={styles.careText}>{action}</Text></View>
            ))}
            <View style={styles.chibiUpdate}>
              <Text style={styles.chibiEmoji}>{activeChibi?.fallbackEmoji ?? '🪴'}</Text>
              <View style={styles.chibiCopy}>
                <Text style={styles.chibiTitle}>Nguồn chibi đã được cập nhật</Text>
                <Text style={styles.chibiCaption}>Ảnh thật vừa chụp đã được liên kết riêng; bản demo dùng chibi tạm trong khi chưa có AI tạo ảnh.</Text>
              </View>
            </View>
            <View style={styles.streakResult}><Ionicons name={firstToday ? 'flame' : 'images-outline'} size={20} color={firstToday ? '#E88735' : theme.colors.primaryDark} /><Text style={styles.streakText}>{firstToday ? 'Streak của cây đã tăng 1 ngày!' : 'Đã thêm ảnh; streak hôm nay giữ nguyên.'}</Text></View>
            <Text style={styles.disclaimer}>Kết quả hiện tại là dữ liệu mô phỏng, chưa phải chẩn đoán AI.</Text>
            <Pressable onPress={() => router.navigate('/(tabs)/garden')} style={styles.primaryButton}><Text style={styles.primaryButtonText}>Xem cây trong vườn</Text></Pressable>
            <Pressable onPress={resetCapture} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Thêm ảnh khác</Text></Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.colors.background },
  content: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 125 },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  eyebrow: { color: theme.colors.primaryDark, fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  title: { color: theme.colors.text, fontSize: 28, fontWeight: '900', letterSpacing: -0.6, marginTop: 3 },
  livePill: { alignItems: 'center', backgroundColor: '#E8F2E4', borderRadius: 14, flexDirection: 'row', gap: 6, paddingHorizontal: 10, paddingVertical: 7 },
  liveDot: { backgroundColor: theme.colors.primary, borderRadius: 4, height: 7, width: 7 },
  liveText: { color: theme.colors.primaryDark, fontSize: 9, fontWeight: '900' },
  plantSelector: { gap: 8, paddingBottom: 14, paddingTop: 17 },
  plantChip: { alignItems: 'center', backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: 16, borderWidth: 1, flexDirection: 'row', gap: 7, paddingHorizontal: 12, paddingVertical: 9 },
  plantChipSelected: { backgroundColor: theme.colors.primaryDark, borderColor: theme.colors.primaryDark },
  plantChipEmoji: { fontSize: 19 },
  plantChipText: { color: theme.colors.text, fontSize: 12, fontWeight: '800' },
  plantChipTextSelected: { color: '#FFFFFF' },
  cameraFrame: { aspectRatio: 0.82, backgroundColor: '#1C2D25', borderRadius: 28, overflow: 'hidden' },
  previewImage: { height: '100%', width: '100%' },
  viewfinder: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 30 },
  cameraLeaf: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: 27, height: 72, justifyContent: 'center', width: 72 },
  viewfinderTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '800', marginTop: 16 },
  viewfinderCaption: { color: 'rgba(255,255,255,0.62)', fontSize: 12, marginTop: 5, textAlign: 'center' },
  corner: { borderColor: '#CDEFBF', height: 42, position: 'absolute', width: 42 },
  cornerTopLeft: { borderLeftWidth: 3, borderTopLeftRadius: 8, borderTopWidth: 3, left: 24, top: 24 },
  cornerTopRight: { borderRightWidth: 3, borderTopRightRadius: 8, borderTopWidth: 3, right: 24, top: 24 },
  cornerBottomLeft: { borderBottomLeftRadius: 8, borderBottomWidth: 3, borderLeftWidth: 3, bottom: 24, left: 24 },
  cornerBottomRight: { borderBottomRightRadius: 8, borderBottomWidth: 3, borderRightWidth: 3, bottom: 24, right: 24 },
  plantLabel: { alignItems: 'center', backgroundColor: 'rgba(10,18,14,0.72)', borderRadius: 14, flexDirection: 'row', gap: 5, left: 14, paddingHorizontal: 10, paddingVertical: 7, position: 'absolute', top: 14 },
  plantLabelText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  captureActions: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 18 },
  sideAction: { alignItems: 'center', width: 70 },
  sideHint: { alignItems: 'center', width: 70 },
  sideActionText: { color: theme.colors.textMuted, fontSize: 10, fontWeight: '700', marginTop: 4 },
  shutterOuter: { alignItems: 'center', borderColor: theme.colors.primaryDark, borderRadius: 40, borderWidth: 3, height: 78, justifyContent: 'center', width: 78 },
  shutterInner: { alignItems: 'center', backgroundColor: theme.colors.primaryDark, borderRadius: 31, height: 62, justifyContent: 'center', width: 62 },
  actionPanel: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: 23, borderWidth: 1, marginTop: 14, padding: 17 },
  actionTitle: { color: theme.colors.text, fontSize: 17, fontWeight: '800' },
  actionCaption: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 5, textAlign: 'center' },
  primaryButton: { alignItems: 'center', backgroundColor: theme.colors.primaryDark, borderRadius: 17, flexDirection: 'row', gap: 8, justifyContent: 'center', marginTop: 15, minHeight: 52, paddingHorizontal: 16 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  secondaryButton: { alignItems: 'center', backgroundColor: theme.colors.surfaceSoft, borderRadius: 17, justifyContent: 'center', marginTop: 9, minHeight: 48 },
  secondaryButtonText: { color: theme.colors.primaryDark, fontSize: 13, fontWeight: '800' },
  analyzingCard: { alignItems: 'center', backgroundColor: theme.colors.surface, borderRadius: 23, marginTop: 14, padding: 25 },
  analyzingTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '800', marginTop: 12 },
  resultCard: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: 24, borderWidth: 1, marginTop: 14, padding: 18 },
  resultHeader: { alignItems: 'center', flexDirection: 'row' },
  resultIcon: { alignItems: 'center', backgroundColor: theme.colors.surfaceAlt, borderRadius: 15, height: 46, justifyContent: 'center', width: 46 },
  resultCopy: { flex: 1, marginLeft: 11 },
  resultTitle: { color: theme.colors.text, fontSize: 17, fontWeight: '800' },
  resultLevel: { color: theme.colors.primaryDark, fontSize: 11, fontWeight: '800', marginTop: 2 },
  resultSummary: { color: theme.colors.textMuted, fontSize: 13, lineHeight: 19, marginVertical: 13 },
  careRow: { alignItems: 'center', backgroundColor: theme.colors.surfaceSoft, borderRadius: 15, flexDirection: 'row', marginBottom: 8, padding: 11 },
  careNumber: { alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 10, height: 29, justifyContent: 'center', width: 29 },
  careNumberText: { color: theme.colors.primaryDark, fontSize: 11, fontWeight: '900' },
  careText: { color: theme.colors.text, flex: 1, fontSize: 12, lineHeight: 17, marginLeft: 9 },
  chibiUpdate: { alignItems: 'center', backgroundColor: '#EEF5E8', borderRadius: 17, flexDirection: 'row', marginTop: 4, padding: 12 },
  chibiEmoji: { fontSize: 36 },
  chibiCopy: { flex: 1, marginLeft: 10 },
  chibiTitle: { color: theme.colors.text, fontSize: 12, fontWeight: '800' },
  chibiCaption: { color: theme.colors.textMuted, fontSize: 10, lineHeight: 14, marginTop: 2 },
  streakResult: { alignItems: 'center', backgroundColor: '#FFF4E5', borderRadius: 15, flexDirection: 'row', gap: 8, marginTop: 4, padding: 12 },
  streakText: { color: theme.colors.text, flex: 1, fontSize: 12, fontWeight: '700' },
  disclaimer: { color: theme.colors.textMuted, fontSize: 10, lineHeight: 15, marginTop: 10, textAlign: 'center' },
  emptyState: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 28 },
  emptyEmoji: { fontSize: 52 },
  emptyTitle: { color: theme.colors.text, fontSize: 19, fontWeight: '800', marginTop: 13 },
});
