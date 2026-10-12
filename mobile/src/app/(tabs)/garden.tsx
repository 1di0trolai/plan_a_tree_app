import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useRef, useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { localDateKey } from '@/data/seed';
import { useApp } from '@/store/AppStore';
import { COLORS, RADIUS, SHADOWS, SPACING } from '@/theme';
import type { Plant, PlantChibi } from '@/types/app';

type SheetName = 'care' | 'history' | 'timelapse' | null;

const PALETTE = {
  background: COLORS.background ?? '#F6F7EF',
  surface: COLORS.surface ?? '#FFFFFF',
  primary: COLORS.primary ?? '#407A52',
  primaryDark: COLORS.primaryDark ?? '#285D3A',
  primarySoft: '#DDECD8',
  text: COLORS.text ?? '#1F2B22',
  textMuted: COLORS.textMuted ?? '#748078',
  border: COLORS.border ?? '#E4E8DF',
  warning: COLORS.warning ?? '#F1A340',
  white: '#FFFFFF',
};

const PLANT_EMOJIS = ['🌿', '🪴', '🌵', '🌻', '🍀', '🌱'];

function formatDate(value?: string) {
  if (!value) return 'Chưa có dữ liệu';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(parsed);
}

function IconButton({ icon, label, onPress }: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={10}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
      <Ionicons name={icon} size={20} color={PALETTE.text} />
    </Pressable>
  );
}

function PlantAvatar({ chibi, label, large = false }: { chibi?: PlantChibi; label: string; large?: boolean }) {
  if (chibi?.imageUri) {
    return (
      <Image
        accessibilityLabel={`Ảnh chibi của ${label}`}
        resizeMode="cover"
        source={{ uri: chibi.imageUri }}
        style={large ? styles.plantChibiImage : styles.smallChibiImage}
      />
    );
  }

  return (
    <View style={large ? styles.plantEmojiWrap : styles.smallChibiWrap}>
      {large && <View style={styles.plantGlow} />}
      <Text style={large ? styles.plantEmoji : styles.smallChibiEmoji}>
        {chibi?.fallbackEmoji ?? '🪴'}
      </Text>
    </View>
  );
}

function Sheet({ visible, title, onClose, children }: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal animationType="slide" onRequestClose={onClose} statusBarTranslucent transparent visible={visible}>
      <View style={styles.modalBackdrop}>
        <Pressable accessibilityLabel="Đóng cửa sổ" accessibilityRole="button" onPress={onClose} style={StyleSheet.absoluteFill} />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <IconButton icon="close" label="Đóng" onPress={onClose} />
          </View>
          {children}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

export default function GardenScreen() {
  const { ready, state, activePlant, activePlantIndex, setActivePlantIndex, addPlant } = useApp();
  const { width } = useWindowDimensions();
  const plantListRef = useRef<FlatList<Plant>>(null);
  const [sheet, setSheet] = useState<SheetName>(null);
  const [addVisible, setAddVisible] = useState(false);
  const [plantName, setPlantName] = useState('');
  const [plantSpecies, setPlantSpecies] = useState('');
  const [plantEmoji, setPlantEmoji] = useState(PLANT_EMOJIS[0]);
  const [formError, setFormError] = useState('');

  const plants = state.plants;
  const activeChibi = state.plantChibis.find((entry) => entry.plantId === activePlant?.id);
  const history = state.checkIns.filter((entry) => entry.plantId === activePlant?.id);
  const latestCheckIn = history[0];
  const latestAnalysis = state.plantAnalyses.find((entry) => entry.id === latestCheckIn?.analysisId)?.result;
  const checkedInToday = activePlant?.lastCheckIn === localDateKey();
  const arUsedToday = state.daily.lastCatchDate === localDateKey();

  const resetAddForm = () => {
    setPlantName('');
    setPlantSpecies('');
    setPlantEmoji(PLANT_EMOJIS[0]);
    setFormError('');
  };

  const submitPlant = () => {
    const cleanName = plantName.trim();
    const cleanSpecies = plantSpecies.trim();
    if (cleanName.length < 2 || cleanSpecies.length < 2) {
      setFormError('Hãy nhập tên và loại cây, mỗi mục ít nhất 2 ký tự.');
      return;
    }
    addPlant({ name: cleanName, species: cleanSpecies, emoji: plantEmoji });
    setAddVisible(false);
    resetAddForm();
  };

  const onPlantScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width <= 0) return;
    const index = Math.round(event.nativeEvent.contentOffset.x / width);
    if (plants[index] && index !== activePlantIndex) setActivePlantIndex(index);
  };

  const selectPlant = (index: number) => {
    setActivePlantIndex(index);
    plantListRef.current?.scrollToIndex({ index, animated: true });
  };

  const openCamera = () => router.navigate('/(tabs)/camera');
  const openArHunt = () => {
    if (!activePlant) return;
    router.push({ pathname: '/ar-hunt', params: { plantId: activePlant.id } });
  };

  if (!ready) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerState} accessibilityRole="progressbar">
          <ActivityIndicator color={PALETTE.primary} size="large" />
          <Text style={styles.stateTitle}>Đang mở khu vườn...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>KHU VƯỜN THẬT CỦA BẠN</Text>
          <Text style={styles.headerTitle}>Chào buổi sáng 👋</Text>
        </View>
        <IconButton icon="notifications-outline" label="Xem thông báo" onPress={() => Alert.alert('Thông báo', 'Bạn chưa có thông báo mới.')} />
      </View>

      {plants.length === 0 ? (
        <View style={styles.centerState}>
          <View style={styles.emptyIcon}><Text style={styles.emptyEmoji}>🌱</Text></View>
          <Text style={styles.stateTitle}>Khu vườn đang trống</Text>
          <Text style={styles.stateCaption}>Thêm cây thật đầu tiên để bắt đầu theo dõi mỗi ngày.</Text>
          <Pressable onPress={() => setAddVisible(true)} style={styles.primaryButton}>
            <Ionicons name="add" size={21} color={PALETTE.white} />
            <Text style={styles.primaryButtonText}>Thêm cây đầu tiên</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.sectionHeadingRow}>
            <View>
              <Text style={styles.sectionTitle}>Những người bạn xanh</Text>
              <Text style={styles.sectionCaption}>Vuốt ngang để đổi cây</Text>
            </View>
            <Pressable onPress={() => setAddVisible(true)} style={styles.addPlantButton}>
              <Ionicons name="add" size={18} color={PALETTE.primaryDark} />
              <Text style={styles.addPlantText}>Thêm cây</Text>
            </Pressable>
          </View>

          <FlatList
            data={plants}
            getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
            horizontal
            initialScrollIndex={activePlantIndex > 0 ? activePlantIndex : undefined}
            keyExtractor={(item) => item.id}
            onMomentumScrollEnd={onPlantScrollEnd}
            pagingEnabled
            ref={plantListRef}
            showsHorizontalScrollIndicator={false}
            style={{ marginHorizontal: -SPACING.lg }}
            renderItem={({ item }) => {
              const chibi = state.plantChibis.find((entry) => entry.plantId === item.id);
              return (
                <View style={[styles.plantPage, { width }]}>
                  <LinearGradient colors={['#EEF5DF', '#DCE9D4']} style={styles.plantCard}>
                    <View style={styles.plantCardTop}>
                      <View>
                        <Text style={styles.plantName}>{item.name}</Text>
                        <Text style={styles.plantSpecies}>{item.species}</Text>
                      </View>
                      <View style={styles.healthPill}>
                        <Ionicons name="heart" size={14} color={PALETTE.primary} />
                        <Text style={styles.healthPillText}>{item.health}</Text>
                      </View>
                    </View>
                    <View style={styles.plantVisual}>
                      <PlantAvatar chibi={chibi} label={item.name} large />
                      <View style={styles.chibiBadge}>
                        <Ionicons name="sparkles" size={12} color={PALETTE.primaryDark} />
                        <Text style={styles.chibiBadgeText}>CHIBI</Text>
                      </View>
                    </View>
                    <View style={styles.stageRow}>
                      <View><Text style={styles.stageLabel}>Giai đoạn hiện tại</Text><Text style={styles.stageValue}>{item.stage}</Text></View>
                      <Text style={styles.progressValue}>{item.progress}%</Text>
                    </View>
                    <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.min(item.progress, 100)}%` }]} /></View>
                  </LinearGradient>
                </View>
              );
            }}
          />

          <View style={styles.paginationRow}>
            <View style={styles.dots}>
              {plants.map((plant, index) => (
                <Pressable
                  accessibilityLabel={`Chuyển tới cây ${plant.name}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: index === activePlantIndex }}
                  hitSlop={7}
                  key={plant.id}
                  onPress={() => selectPlant(index)}
                  style={[styles.dot, index === activePlantIndex && styles.dotActive]}
                />
              ))}
            </View>
            <Text style={styles.counterText}>{activePlantIndex + 1}/{plants.length}</Text>
          </View>

          <View style={styles.streakCard}>
            <View style={styles.streakIcon}><Ionicons name="flame" size={26} color="#E88735" /></View>
            <View style={styles.streakCopy}>
              <Text style={styles.streakTitle}>{activePlant.streak} ngày liên tiếp</Text>
              <Text style={styles.streakCaption}>Kỷ lục {activePlant.bestStreak} ngày · {checkedInToday ? 'Đã check-in hôm nay' : 'Đang chờ bạn'}</Text>
            </View>
            <Ionicons color={checkedInToday ? PALETTE.primary : PALETTE.warning} name={checkedInToday ? 'checkmark-circle' : 'time-outline'} size={25} />
          </View>

          <View style={styles.dailyCard}>
            <View style={styles.dailyHeader}>
              <View>
                <Text style={styles.dailyEyebrow}>CHECK-IN CÂY THẬT</Text>
                <Text style={styles.dailyTitle}>{checkedInToday ? 'Ảnh hôm nay đã được lưu' : `Chụp ${activePlant.name} hôm nay`}</Text>
              </View>
              <View style={[styles.statusBadge, checkedInToday && styles.statusBadgeDone]}>
                <Text style={[styles.statusBadgeText, checkedInToday && styles.statusBadgeTextDone]}>{checkedInToday ? 'Hoàn thành' : '+1 streak'}</Text>
              </View>
            </View>
            <Text style={styles.dailyCaption}>Camera có màn hình riêng để lưu ảnh thật, tạo phân tích mẫu và cập nhật đại diện chibi.</Text>
            <Pressable onPress={openCamera} style={({ pressed }) => [styles.cameraCta, pressed && styles.pressed]}>
              <View style={styles.cameraCtaIcon}><Ionicons name="camera" size={24} color={PALETTE.white} /></View>
              <View style={styles.cameraCtaCopy}>
                <Text style={styles.cameraCtaTitle}>Mở Camera check-in</Text>
                <Text style={styles.cameraCtaCaption}>Chụp mới hoặc chọn ảnh có sẵn</Text>
              </View>
              <Ionicons name="chevron-forward" size={21} color={PALETTE.white} />
            </Pressable>
          </View>

          <View style={styles.quickActions}>
            {[
              { key: 'care' as const, icon: 'water-outline' as const, label: 'Chăm sóc' },
              { key: 'history' as const, icon: 'calendar-outline' as const, label: 'Lịch sử' },
              { key: 'timelapse' as const, icon: 'play-circle-outline' as const, label: 'Time-lapse' },
            ].map((action) => (
              <Pressable key={action.key} onPress={() => setSheet(action.key)} style={styles.quickAction}>
                <View style={styles.quickIcon}><Ionicons name={action.icon} size={22} color={PALETTE.primaryDark} /></View>
                <Text style={styles.quickLabel}>{action.label}</Text>
              </Pressable>
            ))}
          </View>

          <LinearGradient colors={arUsedToday ? ['#EEEFEA', '#E4E6DF'] : ['#334D42', '#1C342A']} style={styles.arCard}>
            <View style={styles.arIconWrap}><Ionicons name={arUsedToday ? 'lock-closed' : 'scan'} size={28} color={arUsedToday ? PALETTE.textMuted : '#CDEFBF'} /></View>
            <View style={styles.arCopy}>
              <Text style={[styles.arEyebrow, arUsedToday && styles.arMuted]}>SĂN THÚ QUANH {activePlant.name.toLocaleUpperCase('vi')}</Text>
              <Text style={[styles.arTitle, arUsedToday && styles.arTitleMuted]}>{arUsedToday ? 'Hẹn gặp lại ngày mai' : 'Mở camera và tìm dấu vết'}</Text>
              <Text style={[styles.arCaption, arUsedToday && styles.arMuted]}>{arUsedToday ? 'Bạn đã dùng lượt săn chung hôm nay.' : 'Lượt săn gắn với cây này, nhưng giới hạn là 1 lượt chung mỗi ngày.'}</Text>
            </View>
            <Pressable onPress={openArHunt} style={[styles.arButton, arUsedToday && styles.arButtonDisabled]}>
              <Text style={[styles.arButtonText, arUsedToday && styles.arButtonTextDisabled]}>{arUsedToday ? 'Xem trạng thái' : 'Săn ngay'}</Text>
            </Pressable>
          </LinearGradient>
        </ScrollView>
      )}

      <Modal animationType="slide" onRequestClose={() => setAddVisible(false)} visible={addVisible}>
        <SafeAreaView style={styles.fullModal}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
            <View style={styles.fullModalHeader}>
              <IconButton icon="close" label="Đóng thêm cây" onPress={() => { setAddVisible(false); resetAddForm(); }} />
              <Text style={styles.fullModalTitle}>Thêm cây thật</Text>
              <View style={styles.headerSpacer} />
            </View>
            <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
              <View style={styles.formHero}><Text style={styles.formEmoji}>{plantEmoji}</Text></View>
              <Text style={styles.inputLabel}>Chibi tạm thời</Text>
              <View style={styles.emojiPicker}>
                {PLANT_EMOJIS.map((emoji) => (
                  <Pressable accessibilityRole="radio" accessibilityState={{ selected: emoji === plantEmoji }} key={emoji} onPress={() => setPlantEmoji(emoji)} style={[styles.emojiOption, emoji === plantEmoji && styles.emojiOptionSelected]}>
                    <Text style={styles.emojiOptionText}>{emoji}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.inputLabel}>Tên gọi</Text>
              <TextInput maxLength={30} onChangeText={(value) => { setPlantName(value); setFormError(''); }} placeholder="Ví dụ: Mầm Nhỏ" placeholderTextColor={PALETTE.textMuted} style={styles.input} value={plantName} />
              <Text style={styles.inputLabel}>Loại cây</Text>
              <TextInput maxLength={40} onChangeText={(value) => { setPlantSpecies(value); setFormError(''); }} onSubmitEditing={submitPlant} placeholder="Ví dụ: Monstera" placeholderTextColor={PALETTE.textMuted} style={styles.input} value={plantSpecies} />
              {formError ? <Text style={styles.formError}>{formError}</Text> : null}
              <Text style={styles.formHint}>Ảnh thật, phân tích và chibi được lưu riêng sau lần check-in đầu tiên.</Text>
            </ScrollView>
            <View style={styles.formFooter}>
              <Pressable onPress={submitPlant} style={styles.primaryButton}><Ionicons name="leaf" size={20} color={PALETTE.white} /><Text style={styles.primaryButtonText}>Tạo hồ sơ cây</Text></Pressable>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      <Sheet visible={sheet === 'care'} title={`Chăm sóc ${activePlant?.name ?? ''}`} onClose={() => setSheet(null)}>
        <ScrollView contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
          <View style={styles.careHero}>
            <PlantAvatar chibi={activeChibi} label={activePlant?.name ?? 'cây'} />
            <View style={styles.careHeroCopy}><Text style={styles.careHeroTitle}>{activePlant?.mood ?? 'Cây đang chờ ảnh'}</Text><Text style={styles.careHeroCaption}>Sức khỏe: {activePlant?.health ?? 'Chưa đánh giá'}</Text></View>
          </View>
          {(latestAnalysis?.actions ?? ['Chạm đất để kiểm tra độ ẩm trước khi tưới.', 'Lau nhẹ hai mặt lá mỗi tuần.', 'Xoay chậu một phần tư vòng để cây nhận sáng đều.']).map((tip, index) => (
            <View key={`${tip}-${index}`} style={styles.careTip}><View style={styles.careTipIcon}><Text style={styles.careTipNumber}>{index + 1}</Text></View><Text style={styles.careTipText}>{tip}</Text></View>
          ))}
        </ScrollView>
      </Sheet>

      <Sheet visible={sheet === 'history'} title="Lịch sử check-in" onClose={() => setSheet(null)}>
        <ScrollView contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
          {history.length === 0 ? (
            <View style={styles.sheetEmpty}><Ionicons name="calendar-outline" size={34} color={PALETTE.textMuted} /><Text style={styles.sheetEmptyTitle}>Chưa có lần check-in nào</Text></View>
          ) : history.map((entry, index) => {
            const photo = state.plantPhotos.find((item) => item.id === entry.photoId);
            const analysis = state.plantAnalyses.find((item) => item.id === entry.analysisId);
            return (
              <View key={entry.id} style={styles.historyRow}>
                {photo?.imageUri ? <Image source={{ uri: photo.imageUri }} style={styles.historyThumb} /> : <View style={[styles.historyThumb, styles.historyFallback]}><PlantAvatar chibi={activeChibi} label={activePlant?.name ?? 'cây'} /></View>}
                <View style={styles.historyCopy}><Text style={styles.historyTitle}>Check-in #{history.length - index}</Text><Text style={styles.historyAnalysis}>{analysis?.result.title ?? 'Chưa phân tích'}</Text><Text style={styles.historyDate}>{formatDate(entry.date)} · {entry.time}</Text></View>
                <Ionicons name="checkmark-circle" size={22} color={PALETTE.primary} />
              </View>
            );
          })}
        </ScrollView>
      </Sheet>

      <Sheet visible={sheet === 'timelapse'} title="Time-lapse của cây" onClose={() => setSheet(null)}>
        <ScrollView contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
          <Text style={styles.timelapseIntro}>Dải ảnh thật được lấy riêng từ từng lần check-in của cây.</Text>
          {history.length === 0 ? <View style={styles.sheetEmpty}><Text style={styles.sheetEmptyTitle}>Chưa đủ ảnh để dựng time-lapse</Text></View> : (
            <ScrollView contentContainerStyle={styles.timelineStrip} horizontal showsHorizontalScrollIndicator={false}>
              {history.map((entry) => {
                const photo = state.plantPhotos.find((item) => item.id === entry.photoId);
                return <View key={entry.id} style={styles.timelineFrame}>{photo?.imageUri ? <Image source={{ uri: photo.imageUri }} style={styles.timelineImage} /> : <View style={[styles.timelineImage, styles.historyFallback]} />}<Text style={styles.timelineDate}>{formatDate(entry.date)}</Text></View>;
              })}
            </ScrollView>
          )}
        </ScrollView>
      </Sheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: PALETTE.background },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md, paddingTop: SPACING.sm },
  eyebrow: { color: PALETTE.primaryDark, fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  headerTitle: { color: PALETTE.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.6, marginTop: 3 },
  iconButton: { alignItems: 'center', backgroundColor: PALETTE.surface, borderColor: PALETTE.border, borderRadius: 15, borderWidth: 1, height: 42, justifyContent: 'center', width: 42 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.985 }] },
  content: { paddingBottom: 128 },
  sectionHeadingRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: SPACING.lg, paddingTop: 4 },
  sectionTitle: { color: PALETTE.text, fontSize: 19, fontWeight: '800' },
  sectionCaption: { color: PALETTE.textMuted, fontSize: 12, marginTop: 3 },
  addPlantButton: { alignItems: 'center', backgroundColor: PALETTE.primarySoft, borderRadius: 15, flexDirection: 'row', gap: 5, minHeight: 38, paddingHorizontal: 12 },
  addPlantText: { color: PALETTE.primaryDark, fontSize: 12, fontWeight: '800' },
  plantPage: { paddingHorizontal: SPACING.lg, paddingTop: 14 },
  plantCard: { borderRadius: 28, minHeight: 365, overflow: 'hidden', padding: 20, ...SHADOWS.card },
  plantCardTop: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' },
  plantName: { color: PALETTE.text, fontSize: 24, fontWeight: '900' },
  plantSpecies: { color: PALETTE.textMuted, fontSize: 13, marginTop: 2 },
  healthPill: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.72)', borderRadius: 14, flexDirection: 'row', gap: 5, paddingHorizontal: 10, paddingVertical: 7 },
  healthPillText: { color: PALETTE.primaryDark, fontSize: 11, fontWeight: '800' },
  plantVisual: { alignItems: 'center', flex: 1, justifyContent: 'center', minHeight: 210 },
  plantEmojiWrap: { alignItems: 'center', height: 160, justifyContent: 'center', width: 190 },
  plantGlow: { backgroundColor: 'rgba(255,255,255,0.65)', borderRadius: 70, height: 140, position: 'absolute', width: 140 },
  plantEmoji: { fontSize: 106 },
  plantChibiImage: { borderRadius: 42, height: 170, width: 170 },
  chibiBadge: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.78)', borderRadius: 12, bottom: 7, flexDirection: 'row', gap: 4, paddingHorizontal: 8, paddingVertical: 5, position: 'absolute' },
  chibiBadgeText: { color: PALETTE.primaryDark, fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  stageRow: { alignItems: 'flex-end', flexDirection: 'row', justifyContent: 'space-between' },
  stageLabel: { color: PALETTE.textMuted, fontSize: 10, fontWeight: '700' },
  stageValue: { color: PALETTE.text, fontSize: 15, fontWeight: '800', marginTop: 2 },
  progressValue: { color: PALETTE.primaryDark, fontSize: 15, fontWeight: '900' },
  progressTrack: { backgroundColor: 'rgba(255,255,255,0.72)', borderRadius: 7, height: 8, marginTop: 10, overflow: 'hidden' },
  progressFill: { backgroundColor: PALETTE.primary, borderRadius: 7, height: '100%' },
  paginationRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: SPACING.lg, paddingTop: 10 },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { backgroundColor: PALETTE.border, borderRadius: 5, height: 7, width: 7 },
  dotActive: { backgroundColor: PALETTE.primary, width: 22 },
  counterText: { color: PALETTE.textMuted, fontSize: 11, fontWeight: '700' },
  streakCard: { alignItems: 'center', backgroundColor: PALETTE.surface, borderColor: PALETTE.border, borderRadius: 20, borderWidth: 1, flexDirection: 'row', marginHorizontal: SPACING.lg, marginTop: 15, padding: 14 },
  streakIcon: { alignItems: 'center', backgroundColor: '#FFF0DE', borderRadius: 15, height: 46, justifyContent: 'center', width: 46 },
  streakCopy: { flex: 1, marginLeft: 12 },
  streakTitle: { color: PALETTE.text, fontSize: 15, fontWeight: '800' },
  streakCaption: { color: PALETTE.textMuted, fontSize: 11, marginTop: 3 },
  dailyCard: { backgroundColor: PALETTE.surface, borderColor: PALETTE.border, borderRadius: 24, borderWidth: 1, marginHorizontal: SPACING.lg, marginTop: 14, padding: 17 },
  dailyHeader: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' },
  dailyEyebrow: { color: PALETTE.primaryDark, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  dailyTitle: { color: PALETTE.text, fontSize: 19, fontWeight: '800', marginTop: 4 },
  dailyCaption: { color: PALETTE.textMuted, fontSize: 12, lineHeight: 18, marginTop: 9 },
  statusBadge: { backgroundColor: '#FFF1D8', borderRadius: 12, paddingHorizontal: 9, paddingVertical: 6 },
  statusBadgeDone: { backgroundColor: PALETTE.primarySoft },
  statusBadgeText: { color: '#9A631C', fontSize: 9, fontWeight: '900' },
  statusBadgeTextDone: { color: PALETTE.primaryDark },
  cameraCta: { alignItems: 'center', backgroundColor: PALETTE.primaryDark, borderRadius: 18, flexDirection: 'row', marginTop: 14, minHeight: 66, padding: 11 },
  cameraCtaIcon: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.13)', borderRadius: 15, height: 44, justifyContent: 'center', width: 44 },
  cameraCtaCopy: { flex: 1, marginLeft: 11 },
  cameraCtaTitle: { color: PALETTE.white, fontSize: 14, fontWeight: '800' },
  cameraCtaCaption: { color: 'rgba(255,255,255,0.68)', fontSize: 10, marginTop: 3 },
  quickActions: { flexDirection: 'row', gap: 10, marginHorizontal: SPACING.lg, marginTop: 14 },
  quickAction: { alignItems: 'center', backgroundColor: PALETTE.surface, borderColor: PALETTE.border, borderRadius: 18, borderWidth: 1, flex: 1, padding: 12 },
  quickIcon: { alignItems: 'center', backgroundColor: PALETTE.primarySoft, borderRadius: 13, height: 40, justifyContent: 'center', width: 40 },
  quickLabel: { color: PALETTE.text, fontSize: 11, fontWeight: '800', marginTop: 7 },
  arCard: { alignItems: 'center', borderRadius: 24, flexDirection: 'row', marginHorizontal: SPACING.lg, marginTop: 14, minHeight: 142, overflow: 'hidden', padding: 16 },
  arIconWrap: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: 18, height: 54, justifyContent: 'center', width: 54 },
  arCopy: { flex: 1, marginHorizontal: 12 },
  arEyebrow: { color: '#CDEFBF', fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  arTitle: { color: PALETTE.white, fontSize: 16, fontWeight: '800', marginTop: 4 },
  arCaption: { color: 'rgba(255,255,255,0.65)', fontSize: 10, lineHeight: 15, marginTop: 4 },
  arMuted: { color: PALETTE.textMuted },
  arTitleMuted: { color: PALETTE.text },
  arButton: { backgroundColor: '#CDEFBF', borderRadius: 14, paddingHorizontal: 13, paddingVertical: 10 },
  arButtonDisabled: { backgroundColor: '#D6D9D2' },
  arButtonText: { color: '#203A2F', fontSize: 11, fontWeight: '900' },
  arButtonTextDisabled: { color: PALETTE.textMuted },
  centerState: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 28 },
  emptyIcon: { alignItems: 'center', backgroundColor: PALETTE.primarySoft, borderRadius: 30, height: 84, justifyContent: 'center', width: 84 },
  emptyEmoji: { fontSize: 44 },
  stateTitle: { color: PALETTE.text, fontSize: 20, fontWeight: '800', marginTop: 15 },
  stateCaption: { color: PALETTE.textMuted, fontSize: 13, lineHeight: 19, marginBottom: 18, marginTop: 6, textAlign: 'center' },
  primaryButton: { alignItems: 'center', alignSelf: 'stretch', backgroundColor: PALETTE.primaryDark, borderRadius: 17, flexDirection: 'row', gap: 8, justifyContent: 'center', minHeight: 52, paddingHorizontal: 20 },
  primaryButtonText: { color: PALETTE.white, fontSize: 14, fontWeight: '800' },
  fullModal: { backgroundColor: PALETTE.background, flex: 1 },
  fullModalHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', padding: SPACING.lg },
  fullModalTitle: { color: PALETTE.text, fontSize: 18, fontWeight: '800' },
  headerSpacer: { height: 42, width: 42 },
  formContent: { padding: SPACING.lg },
  formHero: { alignItems: 'center', backgroundColor: PALETTE.primarySoft, borderRadius: 38, height: 150, justifyContent: 'center', marginBottom: 18 },
  formEmoji: { fontSize: 82 },
  inputLabel: { color: PALETTE.text, fontSize: 12, fontWeight: '800', marginBottom: 8, marginTop: 16 },
  emojiPicker: { flexDirection: 'row', justifyContent: 'space-between' },
  emojiOption: { alignItems: 'center', backgroundColor: PALETTE.surface, borderColor: PALETTE.border, borderRadius: 14, borderWidth: 1, height: 48, justifyContent: 'center', width: 48 },
  emojiOptionSelected: { backgroundColor: PALETTE.primarySoft, borderColor: PALETTE.primary, borderWidth: 2 },
  emojiOptionText: { fontSize: 25 },
  input: { backgroundColor: PALETTE.surface, borderColor: PALETTE.border, borderRadius: RADIUS.md, borderWidth: 1, color: PALETTE.text, fontSize: 15, minHeight: 52, paddingHorizontal: 15 },
  formError: { color: '#B94D4D', fontSize: 12, marginTop: 10 },
  formHint: { color: PALETTE.textMuted, fontSize: 11, lineHeight: 17, marginTop: 16 },
  formFooter: { borderTopColor: PALETTE.border, borderTopWidth: 1, padding: SPACING.lg },
  modalBackdrop: { backgroundColor: 'rgba(20,28,23,0.48)', flex: 1, justifyContent: 'flex-end' },
  sheet: { backgroundColor: PALETTE.background, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '78%', minHeight: 300 },
  sheetHandle: { alignSelf: 'center', backgroundColor: '#C8CEC5', borderRadius: 3, height: 4, marginTop: 9, width: 38 },
  sheetHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', padding: SPACING.lg },
  sheetTitle: { color: PALETTE.text, flex: 1, fontSize: 19, fontWeight: '800' },
  sheetContent: { paddingBottom: 36, paddingHorizontal: SPACING.lg },
  careHero: { alignItems: 'center', backgroundColor: PALETTE.primarySoft, borderRadius: 20, flexDirection: 'row', marginBottom: 14, padding: 15 },
  smallChibiWrap: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.5)', borderRadius: 16, height: 48, justifyContent: 'center', width: 48 },
  smallChibiImage: { borderRadius: 16, height: 48, width: 48 },
  smallChibiEmoji: { fontSize: 29 },
  careHeroCopy: { flex: 1, marginLeft: 13 },
  careHeroTitle: { color: PALETTE.text, fontSize: 15, fontWeight: '800' },
  careHeroCaption: { color: PALETTE.textMuted, fontSize: 11, marginTop: 3 },
  careTip: { alignItems: 'center', backgroundColor: PALETTE.surface, borderColor: PALETTE.border, borderRadius: 17, borderWidth: 1, flexDirection: 'row', marginBottom: 9, padding: 13 },
  careTipIcon: { alignItems: 'center', backgroundColor: PALETTE.primarySoft, borderRadius: 12, height: 34, justifyContent: 'center', width: 34 },
  careTipNumber: { color: PALETTE.primaryDark, fontSize: 12, fontWeight: '900' },
  careTipText: { color: PALETTE.text, flex: 1, fontSize: 12, lineHeight: 18, marginLeft: 11 },
  sheetEmpty: { alignItems: 'center', paddingHorizontal: 20, paddingVertical: 42 },
  sheetEmptyTitle: { color: PALETTE.text, fontSize: 16, fontWeight: '800', marginTop: 10, textAlign: 'center' },
  historyRow: { alignItems: 'center', backgroundColor: PALETTE.surface, borderColor: PALETTE.border, borderRadius: 18, borderWidth: 1, flexDirection: 'row', marginBottom: 10, padding: 10 },
  historyThumb: { borderRadius: 14, height: 62, width: 62 },
  historyFallback: { alignItems: 'center', backgroundColor: PALETTE.primarySoft, justifyContent: 'center' },
  historyCopy: { flex: 1, marginHorizontal: 11 },
  historyTitle: { color: PALETTE.text, fontSize: 13, fontWeight: '800' },
  historyAnalysis: { color: PALETTE.primaryDark, fontSize: 11, fontWeight: '700', marginTop: 2 },
  historyDate: { color: PALETTE.textMuted, fontSize: 10, marginTop: 3 },
  timelapseIntro: { color: PALETTE.textMuted, fontSize: 12, lineHeight: 18, marginBottom: 14 },
  timelineStrip: { gap: 10, paddingRight: 8 },
  timelineFrame: { backgroundColor: PALETTE.surface, borderRadius: 16, padding: 8, width: 138 },
  timelineImage: { backgroundColor: PALETTE.primarySoft, borderRadius: 12, height: 142, width: 122 },
  timelineDate: { color: PALETTE.textMuted, fontSize: 10, marginTop: 7, textAlign: 'center' },
});
