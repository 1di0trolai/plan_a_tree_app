import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApp } from '@/store/AppStore';
import { theme } from '@/theme';
import type { AiTone } from '@/types/app';

type InfoTopic = 'help' | 'privacy' | 'about' | null;

const avatars = ['👨‍🌾', '👩‍🌾', '🧑‍🌾', '🌱', '🐞'];
const reminderTimes = ['07:00', '08:00', '12:00', '20:00'];
const tones: { key: AiTone; label: string; icon: string; description: string }[] = [
  { key: 'funny', label: 'Vui vẻ', icon: '😄', description: 'Gần gũi, dí dỏm' },
  { key: 'gentle', label: 'Dịu dàng', icon: '🌷', description: 'Nhẹ nhàng, động viên' },
  { key: 'expert', label: 'Chuyên gia', icon: '🔬', description: 'Rõ ràng, có kỹ thuật' },
  { key: 'minimal', label: 'Ngắn gọn', icon: '⚡', description: 'Chỉ nói điều cần làm' },
];

const infoCopy = {
  help: {
    icon: 'help-buoy-outline' as const,
    eyebrow: 'TRỢ GIÚP',
    title: 'Chăm cây cùng PAT',
    paragraphs: [
      'Để giữ streak, hãy chụp hoặc chọn ảnh đúng cây mỗi ngày. Mỗi cây có streak riêng và ảnh bổ sung trong cùng ngày sẽ không tăng streak lần nữa.',
      'Bạn có một lượt săn AR chung mỗi ngày. Kho đồ cho phép chọn thú đồng hành và dùng thức ăn để tăng EXP cho pet.',
      'Đây là bản prototype dùng dữ liệu giả. Kết quả phân tích ảnh không phải chẩn đoán thực vật chuyên nghiệp.',
    ],
  },
  privacy: {
    icon: 'shield-checkmark-outline' as const,
    eyebrow: 'QUYỀN RIÊNG TƯ',
    title: 'Dữ liệu ở trên thiết bị',
    paragraphs: [
      'Prototype hiện lưu hồ sơ, cây, ảnh đã chọn và tiến trình demo ngay trên thiết bị của bạn. Chưa có tài khoản máy chủ hay đồng bộ đám mây.',
      'Ảnh chỉ được dùng để hiển thị trong luồng kiểm thử hiện tại. Khi phát triển backend, PAT sẽ cần chính sách lưu trữ, xóa dữ liệu và quyền truy cập ảnh rõ ràng.',
    ],
  },
  about: {
    icon: 'leaf-outline' as const,
    eyebrow: 'VỀ PAT',
    title: 'Biến chăm cây thành thói quen',
    paragraphs: [
      'PAT là ý tưởng ứng dụng kết nối việc chăm cây ngoài đời với hành trình sưu tầm sinh vật. Check-in mỗi ngày giúp bạn nhìn lại sự thay đổi của cây và giữ nhịp chăm sóc.',
      'Phiên bản hiện tại là prototype native cho Android và iOS. Camera đã hoạt động thật; nhận diện AI, kết quả bắt thú AR và PVE vẫn dùng mô phỏng hoặc đang lên ý tưởng.',
    ],
  },
};

export default function ProfileScreen() {
  const {
    state,
    activePlant,
    setActivePlantIndex,
    updateProfile,
    updateSetting,
    removePlant,
    resetDemo,
    logout,
  } = useApp();
  const [editVisible, setEditVisible] = useState(false);
  const [infoTopic, setInfoTopic] = useState<InfoTopic>(null);
  const [draftName, setDraftName] = useState(state.profile.name);
  const [draftTitle, setDraftTitle] = useState(state.profile.title);
  const [draftAvatar, setDraftAvatar] = useState(state.profile.avatar);

  const stats = useMemo(() => {
    const currentStreak = Math.max(0, ...state.plants.map((plant) => plant.streak));
    const bestStreak = Math.max(0, ...state.plants.map((plant) => plant.bestStreak));
    const checkIns = state.checkIns.length;
    const creatures = state.inventory.beasts.filter((beast) => beast.owned).length;
    return { currentStreak, bestStreak, checkIns, creatures };
  }, [state.checkIns.length, state.inventory.beasts, state.plants]);

  const openEditor = () => {
    setDraftName(state.profile.name);
    setDraftTitle(state.profile.title);
    setDraftAvatar(state.profile.avatar);
    setEditVisible(true);
  };

  const saveProfile = () => {
    const name = draftName.trim();
    const title = draftTitle.trim();
    if (name.length < 2) {
      Alert.alert('Tên quá ngắn', 'Hãy nhập tên hiển thị có ít nhất 2 ký tự.');
      return;
    }
    updateProfile({ name, title: title || 'Người yêu cây', avatar: draftAvatar });
    setEditVisible(false);
  };

  const openPlant = (index: number) => {
    setActivePlantIndex(index);
    router.push('/garden');
  };

  const confirmRemovePlant = (id: string, name: string) => {
    if (state.plants.length <= 1) {
      Alert.alert('Giữ lại một cây', 'Vườn cần ít nhất một cây để tiếp tục check-in.');
      return;
    }
    Alert.alert(
      `Xóa ${name}?`,
      'Lịch sử check-in và dữ liệu demo của cây này sẽ bị xóa khỏi thiết bị.',
      [
        { text: 'Hủy', style: 'cancel' },
        { text: 'Xóa cây', style: 'destructive', onPress: () => removePlant(id) },
      ],
    );
  };

  const confirmReset = () => {
    Alert.alert(
      'Khôi phục dữ liệu mẫu?',
      'Mọi thay đổi trong prototype, ảnh đã chọn, streak và kho đồ sẽ trở về ban đầu.',
      [
        { text: 'Hủy', style: 'cancel' },
        { text: 'Khôi phục', style: 'destructive', onPress: () => { resetDemo(); router.replace('/'); } },
      ],
    );
  };

  const confirmLogout = () => {
    Alert.alert('Đăng xuất?', 'Dữ liệu demo vẫn được giữ trên thiết bị này.', [
      { text: 'Ở lại', style: 'cancel' },
      { text: 'Đăng xuất', style: 'destructive', onPress: () => { logout(); router.replace('/'); } },
    ]);
  };

  const topic = infoTopic ? infoCopy[infoTopic] : null;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View><Text style={styles.eyebrow}>KHÔNG GIAN CỦA BẠN</Text><Text style={styles.title}>Hồ sơ</Text></View>
          <Pressable accessibilityLabel="Chỉnh sửa hồ sơ" accessibilityRole="button" onPress={openEditor} style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}>
            <Ionicons name="pencil" size={19} color={theme.colors.primaryDark} />
          </Pressable>
        </View>

        <View style={styles.profileCard}>
          <View style={styles.profileDecoration} />
          <View style={styles.avatarRing}>
            {state.profile.avatarImageUri ? <Image accessibilityLabel={`Ảnh đại diện của ${state.profile.name}`} source={{ uri: state.profile.avatarImageUri }} style={styles.avatarImage} /> : <Text style={styles.avatarEmoji}>{state.profile.avatar}</Text>}
          </View>
          <View style={styles.profileCopy}>
            <Text style={styles.profileName}>{state.profile.name}</Text>
            <Text style={styles.profileTitle}>{state.profile.title}</Text>
            <View style={styles.profileMeta}><Ionicons name="leaf" size={13} color={theme.colors.primaryDark} /><Text style={styles.profileMetaText}>{state.plants.length} cây đang theo dõi</Text></View>
          </View>
          <Pressable accessibilityLabel="Sửa tên và ảnh đại diện" accessibilityRole="button" onPress={openEditor} style={styles.editMiniButton}>
            <Text style={styles.editMiniText}>Chỉnh sửa</Text>
          </Pressable>
        </View>

        <View style={styles.statsGrid}>
          <View style={styles.statCard}><Text style={styles.statEmoji}>🔥</Text><Text style={styles.statValue}>{stats.currentStreak}</Text><Text style={styles.statLabel}>Streak hiện tại</Text></View>
          <View style={styles.statCard}><Text style={styles.statEmoji}>🏆</Text><Text style={styles.statValue}>{stats.bestStreak}</Text><Text style={styles.statLabel}>Kỷ lục</Text></View>
          <View style={styles.statCard}><Text style={styles.statEmoji}>📸</Text><Text style={styles.statValue}>{stats.checkIns}</Text><Text style={styles.statLabel}>Lượt check-in</Text></View>
          <View style={styles.statCard}><Text style={styles.statEmoji}>🐾</Text><Text style={styles.statValue}>{stats.creatures}</Text><Text style={styles.statLabel}>Thú đã bắt</Text></View>
        </View>

        <View style={styles.sectionHeading}>
          <View><Text style={styles.sectionEyebrow}>KHU VƯỜN</Text><Text style={styles.sectionTitle}>Cây của tôi</Text></View>
          <Text style={styles.sectionCount}>{state.plants.length} cây</Text>
        </View>
        <View style={styles.cardGroup}>
          {state.plants.map((plant, index) => {
            const selected = plant.id === activePlant.id;
            const chibi = state.plantChibis.find((entry) => entry.plantId === plant.id);
            return (
              <View key={plant.id} style={[styles.plantRow, index < state.plants.length - 1 && styles.rowDivider]}>
                <Pressable accessibilityLabel={`Mở ${plant.name}, ${plant.species}`} accessibilityRole="button" onPress={() => openPlant(index)} style={({ pressed }) => [styles.plantMain, pressed && styles.pressed]}>
                  <View style={[styles.plantThumb, selected && styles.plantThumbActive]}>
                    {chibi?.imageUri ? <Image source={{ uri: chibi.imageUri }} style={styles.plantImage} /> : <Text style={styles.plantEmoji}>{chibi?.fallbackEmoji ?? '🪴'}</Text>}
                  </View>
                  <View style={styles.plantCopy}>
                    <View style={styles.plantNameLine}><Text numberOfLines={1} style={styles.plantName}>{plant.name}</Text>{selected && <View style={styles.activePill}><Text style={styles.activePillText}>Đang xem</Text></View>}</View>
                    <Text numberOfLines={1} style={styles.plantMeta}>{plant.species} · 🔥 {plant.streak} ngày</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
                </Pressable>
                <Pressable accessibilityLabel={`Xóa ${plant.name}`} accessibilityRole="button" accessibilityState={{ disabled: state.plants.length <= 1 }} disabled={state.plants.length <= 1} hitSlop={7} onPress={() => confirmRemovePlant(plant.id, plant.name)} style={styles.deletePlant}>
                  <Ionicons name="trash-outline" size={18} color={state.plants.length <= 1 ? theme.colors.border : theme.colors.danger} />
                </Pressable>
              </View>
            );
          })}
        </View>

        <View style={styles.sectionHeading}><View><Text style={styles.sectionEyebrow}>NHẮC CHĂM CÂY</Text><Text style={styles.sectionTitle}>Lịch hằng ngày</Text></View><Ionicons name="alarm-outline" size={23} color={theme.colors.primaryDark} /></View>
        <View style={styles.settingsCard}>
          <View style={styles.settingRow}>
            <View style={styles.settingIcon}><Ionicons name="notifications-outline" size={20} color={theme.colors.primaryDark} /></View>
            <View style={styles.settingCopy}><Text style={styles.settingTitle}>Nhắc check-in</Text><Text style={styles.settingBody}>Ghi nhớ tùy chọn nhắc trên thiết bị</Text></View>
            <Switch accessibilityLabel="Bật nhắc check-in" accessibilityHint="Đây mới là tùy chọn demo, chưa tạo thông báo hệ thống" value={state.settings.notifications} onValueChange={(value) => updateSetting('notifications', value)} trackColor={{ false: theme.colors.border, true: '#8DC79D' }} thumbColor={state.settings.notifications ? theme.colors.primaryDark : '#FFFFFF'} />
          </View>
          <View style={styles.inlineNotice}><Ionicons name="information-circle-outline" size={16} color={theme.colors.textMuted} /><Text style={styles.inlineNoticeText}>Prototype chưa gửi thông báo thật; giờ nhắc hiện chỉ được lưu cục bộ.</Text></View>
          <Text style={styles.optionLabel}>Giờ bạn muốn được nhắc</Text>
          <View style={styles.timeRow}>
            {reminderTimes.map((time) => {
              const selected = state.settings.reminderTime === time;
              return <Pressable key={time} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => updateSetting('reminderTime', time)} style={[styles.timeChip, selected && styles.timeChipActive]}><Text style={[styles.timeText, selected && styles.timeTextActive]}>{time}</Text></Pressable>;
            })}
          </View>
        </View>

        <View style={styles.sectionHeading}><View><Text style={styles.sectionEyebrow}>TRÒ CHUYỆN VỚI CÂY</Text><Text style={styles.sectionTitle}>Giọng của trợ lý</Text></View><Text style={styles.sectionCount}>Demo</Text></View>
        <View style={styles.toneGrid}>
          {tones.map((tone) => {
            const selected = state.settings.aiTone === tone.key;
            return (
              <Pressable key={tone.key} accessibilityLabel={`${tone.label}, ${tone.description}`} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => updateSetting('aiTone', tone.key)} style={({ pressed }) => [styles.toneCard, selected && styles.toneCardActive, pressed && styles.pressed]}>
                <View style={styles.toneTop}><Text style={styles.toneEmoji}>{tone.icon}</Text>{selected && <Ionicons name="checkmark-circle" size={20} color={theme.colors.primaryDark} />}</View>
                <Text style={styles.toneName}>{tone.label}</Text><Text style={styles.toneDescription}>{tone.description}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.sectionHeading}><View><Text style={styles.sectionEyebrow}>TRẢI NGHIỆM</Text><Text style={styles.sectionTitle}>Tùy chỉnh ứng dụng</Text></View></View>
        <View style={styles.cardGroup}>
          <View style={[styles.settingRow, styles.rowDivider]}><View style={styles.settingIcon}><Ionicons name="scan-outline" size={20} color={theme.colors.primaryDark} /></View><View style={styles.settingCopy}><Text style={styles.settingTitle}>AR nhẹ</Text><Text style={styles.settingBody}>Giảm hiệu ứng trong luồng mô phỏng</Text></View><Switch accessibilityLabel="Bật AR nhẹ" value={state.settings.lightAR} onValueChange={(value) => updateSetting('lightAR', value)} trackColor={{ false: theme.colors.border, true: '#8DC79D' }} thumbColor={state.settings.lightAR ? theme.colors.primaryDark : '#FFFFFF'} /></View>
          <View style={styles.settingRow}><View style={styles.settingIcon}><Ionicons name="musical-notes-outline" size={20} color={theme.colors.primaryDark} /></View><View style={styles.settingCopy}><Text style={styles.settingTitle}>Âm thanh</Text><Text style={styles.settingBody}>Lưu lựa chọn âm thanh cho bản sau</Text></View><Switch accessibilityLabel="Bật âm thanh" value={state.settings.music} onValueChange={(value) => updateSetting('music', value)} trackColor={{ false: theme.colors.border, true: '#8DC79D' }} thumbColor={state.settings.music ? theme.colors.primaryDark : '#FFFFFF'} /></View>
        </View>

        <View style={styles.sectionHeading}><View><Text style={styles.sectionEyebrow}>THÔNG TIN</Text><Text style={styles.sectionTitle}>Hỗ trợ & ứng dụng</Text></View></View>
        <View style={styles.cardGroup}>
          {([
            ['help', 'help-buoy-outline', 'Trợ giúp', 'Cách giữ streak và dùng tính năng'],
            ['privacy', 'shield-checkmark-outline', 'Quyền riêng tư', 'Cách prototype lưu dữ liệu'],
            ['about', 'information-circle-outline', 'Về PAT', 'Ý tưởng và trạng thái phát triển'],
          ] as const).map(([key, icon, label, body], index) => (
            <Pressable key={key} accessibilityRole="button" onPress={() => setInfoTopic(key)} style={({ pressed }) => [styles.menuRow, index < 2 && styles.rowDivider, pressed && styles.pressed]}>
              <View style={styles.settingIcon}><Ionicons name={icon} size={20} color={theme.colors.primaryDark} /></View><View style={styles.settingCopy}><Text style={styles.settingTitle}>{label}</Text><Text style={styles.settingBody}>{body}</Text></View><Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
            </Pressable>
          ))}
        </View>

        <Pressable accessibilityRole="button" onPress={confirmReset} style={({ pressed }) => [styles.outlineButton, pressed && styles.pressed]}><Ionicons name="refresh-outline" size={19} color={theme.colors.text} /><Text style={styles.outlineButtonText}>Khôi phục dữ liệu mẫu</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={confirmLogout} style={({ pressed }) => [styles.logoutButton, pressed && styles.pressed]}><Ionicons name="log-out-outline" size={19} color={theme.colors.danger} /><Text style={styles.logoutText}>Đăng xuất</Text></Pressable>
        <Text style={styles.versionText}>PAT Mobile · Prototype 0.1</Text>
      </ScrollView>

      <Modal animationType="slide" onRequestClose={() => setEditVisible(false)} transparent visible={editVisible}>
        <Pressable accessibilityLabel="Đóng chỉnh sửa hồ sơ" accessibilityRole="button" onPress={() => setEditVisible(false)} style={styles.modalBackdrop} />
        <SafeAreaView style={styles.sheetSafe} edges={['bottom']}><View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}><View><Text style={styles.sheetEyebrow}>HỒ SƠ</Text><Text style={styles.sheetTitle}>Chỉnh sửa thông tin</Text></View><Pressable accessibilityLabel="Đóng" accessibilityRole="button" onPress={() => setEditVisible(false)} style={styles.closeButton}><Ionicons name="close" size={22} color={theme.colors.text} /></Pressable></View>
          <Text style={styles.formLabel}>Chọn biểu tượng</Text>
          <View style={styles.avatarOptions}>{avatars.map((avatar) => <Pressable key={avatar} accessibilityLabel={`Chọn biểu tượng ${avatar}`} accessibilityRole="button" accessibilityState={{ selected: draftAvatar === avatar }} onPress={() => setDraftAvatar(avatar)} style={[styles.avatarOption, draftAvatar === avatar && styles.avatarOptionActive]}><Text style={styles.avatarOptionEmoji}>{avatar}</Text></Pressable>)}</View>
          <Text style={styles.formLabel}>Tên hiển thị</Text><TextInput accessibilityLabel="Tên hiển thị" maxLength={30} onChangeText={setDraftName} placeholder="Tên của bạn" placeholderTextColor={theme.colors.textMuted} style={styles.textField} value={draftName} />
          <Text style={styles.formLabel}>Danh hiệu</Text><TextInput accessibilityLabel="Danh hiệu" maxLength={50} onChangeText={setDraftTitle} placeholder="Người yêu cây" placeholderTextColor={theme.colors.textMuted} style={styles.textField} value={draftTitle} />
          <Pressable accessibilityRole="button" onPress={saveProfile} style={styles.primaryButton}><Ionicons name="checkmark" size={20} color="#FFFFFF" /><Text style={styles.primaryButtonText}>Lưu thay đổi</Text></Pressable>
        </View></SafeAreaView>
      </Modal>

      <Modal animationType="slide" onRequestClose={() => setInfoTopic(null)} transparent visible={Boolean(topic)}>
        <Pressable accessibilityLabel="Đóng nội dung" accessibilityRole="button" onPress={() => setInfoTopic(null)} style={styles.modalBackdrop} />
        <SafeAreaView style={styles.sheetSafe} edges={['bottom']}><View style={styles.infoSheet}>
          <View style={styles.sheetHandle} /><Pressable accessibilityLabel="Đóng" accessibilityRole="button" onPress={() => setInfoTopic(null)} style={styles.infoClose}><Ionicons name="close" size={22} color={theme.colors.text} /></Pressable>
          {topic && <><View style={styles.infoIcon}><Ionicons name={topic.icon} size={28} color={theme.colors.primaryDark} /></View><Text style={styles.infoEyebrow}>{topic.eyebrow}</Text><Text style={styles.infoTitle}>{topic.title}</Text>{topic.paragraphs.map((paragraph) => <Text key={paragraph} style={styles.infoParagraph}>{paragraph}</Text>)}<Pressable accessibilityRole="button" onPress={() => setInfoTopic(null)} style={styles.infoDone}><Text style={styles.infoDoneText}>Đã hiểu</Text></Pressable></>}
        </View></SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.colors.background },
  content: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 126 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  eyebrow: { color: theme.colors.primaryDark, fontSize: 12, fontWeight: '800', letterSpacing: 1.3 },
  title: { color: theme.colors.text, fontSize: 29, fontWeight: '800', letterSpacing: -0.7, marginTop: 3 },
  headerButton: { width: 45, height: 45, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceAlt },
  pressed: { opacity: 0.7 },
  profileCard: { overflow: 'hidden', flexDirection: 'row', alignItems: 'center', padding: 17, borderRadius: 25, backgroundColor: theme.colors.primaryDark },
  profileDecoration: { position: 'absolute', width: 130, height: 130, borderRadius: 65, right: -35, top: -67, backgroundColor: 'rgba(255,255,255,0.08)' },
  avatarRing: { width: 70, height: 70, borderRadius: 27, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1F6E7', borderWidth: 3, borderColor: 'rgba(255,255,255,0.35)', overflow: 'hidden' },
  avatarImage: { width: '100%', height: '100%' }, avatarEmoji: { fontSize: 39 },
  profileCopy: { flex: 1, marginLeft: 13 }, profileName: { color: '#FFFFFF', fontSize: 20, fontWeight: '800' }, profileTitle: { color: 'rgba(255,255,255,0.7)', fontSize: 11, marginTop: 3 },
  profileMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: 8, paddingHorizontal: 8, height: 24, borderRadius: 12, backgroundColor: '#DFF1DF' }, profileMetaText: { color: theme.colors.primaryDark, fontSize: 10, fontWeight: '700' },
  editMiniButton: { alignSelf: 'flex-start', paddingHorizontal: 9, height: 30, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.13)' }, editMiniText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700' },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 }, statCard: { width: '48.5%', minHeight: 104, padding: 13, borderRadius: 19, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }, statEmoji: { fontSize: 21 }, statValue: { color: theme.colors.text, fontSize: 23, fontWeight: '800', marginTop: 4 }, statLabel: { color: theme.colors.textMuted, fontSize: 11, fontWeight: '600', marginTop: 1 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 27, marginBottom: 11 }, sectionEyebrow: { color: theme.colors.primaryDark, fontSize: 10, fontWeight: '800', letterSpacing: 1.1 }, sectionTitle: { color: theme.colors.text, fontSize: 19, fontWeight: '800', marginTop: 3 }, sectionCount: { color: theme.colors.textMuted, fontSize: 11, fontWeight: '700', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 10, backgroundColor: theme.colors.surfaceAlt },
  cardGroup: { overflow: 'hidden', borderRadius: 21, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }, rowDivider: { borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  plantRow: { flexDirection: 'row', alignItems: 'center', paddingRight: 11 }, plantMain: { flex: 1, minHeight: 79, flexDirection: 'row', alignItems: 'center', paddingLeft: 12, paddingVertical: 10 }, plantThumb: { width: 51, height: 51, borderRadius: 18, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: theme.colors.surfaceSoft }, plantThumbActive: { borderWidth: 2, borderColor: theme.colors.primary }, plantImage: { width: '100%', height: '100%' }, plantEmoji: { fontSize: 28 }, plantCopy: { flex: 1, marginLeft: 11 }, plantNameLine: { flexDirection: 'row', alignItems: 'center', gap: 6 }, plantName: { color: theme.colors.text, fontSize: 14, fontWeight: '800', maxWidth: '62%' }, plantMeta: { color: theme.colors.textMuted, fontSize: 11, marginTop: 4 }, activePill: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 7, backgroundColor: theme.colors.surfaceAlt }, activePillText: { color: theme.colors.primaryDark, fontSize: 8, fontWeight: '800' }, deletePlant: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceSoft },
  settingsCard: { padding: 14, borderRadius: 21, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }, settingRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 3 }, settingIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceAlt }, settingCopy: { flex: 1, marginHorizontal: 11 }, settingTitle: { color: theme.colors.text, fontSize: 14, fontWeight: '800' }, settingBody: { color: theme.colors.textMuted, fontSize: 10, lineHeight: 14, marginTop: 2 }, inlineNotice: { flexDirection: 'row', gap: 6, borderRadius: 12, padding: 10, backgroundColor: theme.colors.surfaceSoft }, inlineNoticeText: { flex: 1, color: theme.colors.textMuted, fontSize: 10, lineHeight: 15 }, optionLabel: { color: theme.colors.textMuted, fontSize: 11, fontWeight: '700', marginTop: 15, marginBottom: 8 }, timeRow: { flexDirection: 'row', gap: 7 }, timeChip: { flex: 1, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: theme.colors.surfaceSoft }, timeChipActive: { backgroundColor: theme.colors.primaryDark }, timeText: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '700' }, timeTextActive: { color: '#FFFFFF' },
  toneGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, toneCard: { width: '48.5%', minHeight: 118, padding: 13, borderRadius: 19, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }, toneCardActive: { borderWidth: 2, borderColor: theme.colors.primary, backgroundColor: '#F4FAF3' }, toneTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, toneEmoji: { fontSize: 24 }, toneName: { color: theme.colors.text, fontSize: 14, fontWeight: '800', marginTop: 9 }, toneDescription: { color: theme.colors.textMuted, fontSize: 10, lineHeight: 14, marginTop: 3 },
  menuRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, paddingVertical: 8 }, outlineButton: { height: 51, borderRadius: 17, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 20, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }, outlineButtonText: { color: theme.colors.text, fontSize: 14, fontWeight: '800' }, logoutButton: { height: 51, borderRadius: 17, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 10, backgroundColor: '#FFF0EE' }, logoutText: { color: theme.colors.danger, fontSize: 14, fontWeight: '800' }, versionText: { color: theme.colors.textMuted, fontSize: 10, textAlign: 'center', marginTop: 17 },
  modalBackdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: theme.colors.overlay }, sheetSafe: { marginTop: 'auto' }, sheet: { backgroundColor: theme.colors.surface, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16 }, sheetHandle: { width: 42, height: 5, borderRadius: 3, backgroundColor: theme.colors.border, alignSelf: 'center' }, sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, marginBottom: 19 }, sheetEyebrow: { color: theme.colors.primaryDark, fontSize: 10, fontWeight: '800', letterSpacing: 1 }, sheetTitle: { color: theme.colors.text, fontSize: 22, fontWeight: '800', marginTop: 2 }, closeButton: { width: 39, height: 39, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceSoft }, formLabel: { color: theme.colors.text, fontSize: 12, fontWeight: '700', marginBottom: 7, marginTop: 4 }, avatarOptions: { flexDirection: 'row', gap: 8, marginBottom: 16 }, avatarOption: { flex: 1, height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceSoft, borderWidth: 1, borderColor: 'transparent' }, avatarOptionActive: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.primary }, avatarOptionEmoji: { fontSize: 25 }, textField: { height: 50, borderRadius: 15, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.background, color: theme.colors.text, fontSize: 14, paddingHorizontal: 14, marginBottom: 13 }, primaryButton: { height: 52, borderRadius: 17, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.primaryDark, marginTop: 8 }, primaryButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  infoSheet: { minHeight: 420, backgroundColor: theme.colors.surface, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 22, paddingTop: 12, paddingBottom: 16 }, infoClose: { position: 'absolute', top: 18, right: 18, width: 39, height: 39, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceSoft }, infoIcon: { width: 62, height: 62, borderRadius: 22, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', backgroundColor: theme.colors.surfaceAlt, marginTop: 27 }, infoEyebrow: { color: theme.colors.primaryDark, fontSize: 10, fontWeight: '800', letterSpacing: 1, textAlign: 'center', marginTop: 13 }, infoTitle: { color: theme.colors.text, fontSize: 22, fontWeight: '800', textAlign: 'center', marginTop: 3, marginBottom: 9 }, infoParagraph: { color: theme.colors.textMuted, fontSize: 13, lineHeight: 20, marginTop: 9 }, infoDone: { height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceAlt, marginTop: 20 }, infoDoneText: { color: theme.colors.primaryDark, fontSize: 14, fontWeight: '800' },
});
