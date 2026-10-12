import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApp } from '@/store/AppStore';
import { theme } from '@/theme';

const roadmap = [
  { icon: 'map-outline' as const, title: 'Hành trình theo chương', body: 'Khám phá những khu vườn mới và đối đầu sinh vật hoang dã theo từng chặng.', status: 'Đang lên ý tưởng' },
  { icon: 'flash-outline' as const, title: 'Đội hình PVE', body: 'Kết hợp hệ và năng lực của các thú bạn đã bắt để tạo đội hình riêng.', status: 'Bản sau' },
  { icon: 'gift-outline' as const, title: 'Phần thưởng chăm cây', body: 'Duy trì streak ngoài đời để mở khóa thử thách và vật phẩm trong game.', status: 'Bản sau' },
];

export default function BattleScreen() {
  const { ready, state, toggleBattleNotify } = useApp();
  const companion = state.inventory.beasts.find((beast) => beast.id === state.inventory.companionId && beast.owned);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View><Text style={styles.eyebrow}>CHẾ ĐỘ PVE</Text><Text style={styles.title}>Battle</Text></View>
          <View style={styles.statusPill}><View style={styles.statusDot} /><Text style={styles.statusText}>COMING SOON</Text></View>
        </View>

        <View style={styles.heroCard}>
          <View style={styles.heroOrbOne} /><View style={styles.heroOrbTwo} />
          <View style={styles.heroArt} accessibilityElementsHidden>
            <View style={styles.heroArtHalo} />
            <Text style={styles.heroEmoji}>{companion?.icon ?? '🐞'}</Text>
            <View style={styles.heroShield}><Ionicons name="shield-checkmark" size={26} color="#FFF8D7" /></View>
          </View>
          <View style={styles.heroCopy}>
            <View style={styles.soonLabel}><Ionicons name="sparkles" size={13} color="#6C5212" /><Text style={styles.soonLabelText}>Đang ươm mầm</Text></View>
            <Text style={styles.heroTitle}>Một cuộc phiêu lưu đang được chuẩn bị</Text>
            <Text style={styles.heroBody}>Thú đồng hành của bạn sẽ bước vào các trận đấu PVE lấy cảm hứng từ chính khu vườn ngoài đời.</Text>
          </View>
        </View>

        <View style={styles.companionCard}>
          <View style={styles.companionIcon}><Text style={styles.companionEmoji}>{companion?.icon ?? '🌱'}</Text></View>
          <View style={styles.companionCopy}>
            <Text style={styles.companionLabel}>Sẵn sàng cùng bạn</Text>
            <Text style={styles.companionName}>{companion?.name ?? 'Chưa chọn thú đồng hành'}</Text>
            <Text style={styles.companionMeta}>{companion ? `Lv.${companion.level} · Hệ ${companion.element} · ${companion.buff}` : 'Bạn có thể chọn một người bạn trong Kho đồ.'}</Text>
          </View>
          <Ionicons name="lock-closed" size={18} color={theme.colors.textMuted} />
        </View>

        <View style={styles.sectionHeader}>
          <View><Text style={styles.sectionEyebrow}>LỘ TRÌNH DỰ KIẾN</Text><Text style={styles.sectionTitle}>Battle sẽ có gì?</Text></View>
          <Ionicons name="trail-sign-outline" size={24} color={theme.colors.primaryDark} />
        </View>
        <View style={styles.roadmapList}>
          {roadmap.map((item, index) => (
            <View key={item.title} style={styles.roadmapItem}>
              <View style={styles.roadmapRail}>
                <View style={[styles.roadmapIcon, index === 0 && styles.roadmapIconActive]}><Ionicons name={item.icon} size={21} color={index === 0 ? '#FFFFFF' : theme.colors.primaryDark} /></View>
                {index < roadmap.length - 1 && <View style={styles.roadmapLine} />}
              </View>
              <View style={styles.roadmapCopy}>
                <View style={styles.roadmapTitleRow}><Text style={styles.roadmapTitle}>{item.title}</Text><Text style={styles.roadmapStatus}>{item.status}</Text></View>
                <Text style={styles.roadmapBody}>{item.body}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.notifyCard}>
          <View style={styles.notifyIcon}><Ionicons name={state.battleNotify ? 'notifications' : 'notifications-outline'} size={25} color={theme.colors.primaryDark} /></View>
          <Text style={styles.notifyTitle}>{state.battleNotify ? 'Đã lưu lời nhắc' : 'Muốn biết khi Battle ra mắt?'}</Text>
          <Text style={styles.notifyBody}>{state.battleNotify ? 'Tùy chọn của bạn đã được lưu trên thiết bị này.' : 'Bật lời nhắc để app ghi nhớ rằng bạn quan tâm đến chế độ PVE.'}</Text>
          <Pressable
            accessibilityLabel={state.battleNotify ? 'Tắt lời nhắc Battle' : 'Bật lời nhắc Battle'}
            accessibilityRole="button"
            accessibilityState={{ checked: state.battleNotify, disabled: !ready }}
            disabled={!ready}
            onPress={toggleBattleNotify}
            style={({ pressed }) => [styles.notifyButton, state.battleNotify && styles.notifyButtonActive, pressed && styles.buttonPressed]}>
            <Ionicons name={state.battleNotify ? 'checkmark-circle' : 'notifications-outline'} size={20} color={state.battleNotify ? theme.colors.primaryDark : '#FFFFFF'} />
            <Text style={[styles.notifyButtonText, state.battleNotify && styles.notifyButtonTextActive]}>{state.battleNotify ? 'Đã lưu lời nhắc' : 'Nhắc tôi khi ra mắt'}</Text>
          </Pressable>
          <View style={styles.demoNotice}><Ionicons name="information-circle-outline" size={17} color={theme.colors.textMuted} /><Text style={styles.demoNoticeText}>Đây là tùy chọn demo lưu cục bộ, chưa đăng ký hay gửi thông báo thật.</Text></View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.colors.background },
  content: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 124 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  eyebrow: { color: theme.colors.primaryDark, fontSize: 12, fontWeight: '800', letterSpacing: 1.3 },
  title: { color: theme.colors.text, fontSize: 30, fontWeight: '800', letterSpacing: -0.7, marginTop: 3 },
  statusPill: { height: 31, paddingHorizontal: 11, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#FFF2C6', borderWidth: 1, borderColor: '#F3D97A' },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.colors.secondary },
  statusText: { color: '#6C5212', fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  heroCard: { overflow: 'hidden', borderRadius: 28, padding: 21, paddingTop: 18, backgroundColor: theme.colors.primaryDark, minHeight: 355 },
  heroOrbOne: { position: 'absolute', width: 180, height: 180, borderRadius: 90, right: -45, top: -52, backgroundColor: 'rgba(255,255,255,0.08)' },
  heroOrbTwo: { position: 'absolute', width: 120, height: 120, borderRadius: 60, left: -62, bottom: -36, backgroundColor: 'rgba(240,196,99,0.10)' },
  heroArt: { height: 148, alignItems: 'center', justifyContent: 'center' },
  heroArtHalo: { position: 'absolute', width: 132, height: 132, borderRadius: 66, backgroundColor: 'rgba(255,255,255,0.09)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  heroEmoji: { fontSize: 78 },
  heroShield: { position: 'absolute', right: '27%', bottom: 11, width: 46, height: 46, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: '#B78020', borderWidth: 3, borderColor: theme.colors.primaryDark },
  heroCopy: { alignItems: 'center' },
  soonLabel: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, height: 26, borderRadius: 13, backgroundColor: '#FFE79B' },
  soonLabelText: { color: '#6C5212', fontSize: 10, fontWeight: '800' },
  heroTitle: { color: '#FFFFFF', fontSize: 25, fontWeight: '800', lineHeight: 31, textAlign: 'center', letterSpacing: -0.5, marginTop: 12 },
  heroBody: { color: 'rgba(255,255,255,0.73)', fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 9, paddingHorizontal: 5 },
  companionCard: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12, padding: 14, borderRadius: 20, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  companionIcon: { width: 50, height: 50, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceAlt },
  companionEmoji: { fontSize: 28 },
  companionCopy: { flex: 1 },
  companionLabel: { color: theme.colors.textMuted, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  companionName: { color: theme.colors.text, fontSize: 15, fontWeight: '800', marginTop: 2 },
  companionMeta: { color: theme.colors.textMuted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 28, marginBottom: 16 },
  sectionEyebrow: { color: theme.colors.primaryDark, fontSize: 10, fontWeight: '800', letterSpacing: 1.1 },
  sectionTitle: { color: theme.colors.text, fontSize: 20, fontWeight: '800', marginTop: 3 },
  roadmapList: { backgroundColor: theme.colors.surface, borderRadius: 23, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: 15, paddingVertical: 17 },
  roadmapItem: { flexDirection: 'row', minHeight: 103 },
  roadmapRail: { width: 48, alignItems: 'center' },
  roadmapIcon: { zIndex: 2, width: 42, height: 42, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceAlt },
  roadmapIconActive: { backgroundColor: theme.colors.primaryDark },
  roadmapLine: { position: 'absolute', top: 42, bottom: 0, width: 2, backgroundColor: theme.colors.border },
  roadmapCopy: { flex: 1, paddingLeft: 8, paddingBottom: 20 },
  roadmapTitleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 7, minHeight: 28 },
  roadmapTitle: { flex: 1, color: theme.colors.text, fontSize: 15, fontWeight: '800', lineHeight: 20 },
  roadmapStatus: { color: theme.colors.primaryDark, fontSize: 9, fontWeight: '800', backgroundColor: theme.colors.surfaceAlt, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 4 },
  roadmapBody: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 4 },
  notifyCard: { alignItems: 'center', marginTop: 15, padding: 20, borderRadius: 24, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  notifyIcon: { width: 52, height: 52, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceAlt },
  notifyTitle: { color: theme.colors.text, fontSize: 18, fontWeight: '800', textAlign: 'center', marginTop: 12 },
  notifyBody: { color: theme.colors.textMuted, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 5, paddingHorizontal: 4 },
  notifyButton: { alignSelf: 'stretch', height: 51, borderRadius: 17, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: theme.colors.primaryDark, marginTop: 17 },
  notifyButtonActive: { backgroundColor: theme.colors.surfaceAlt, borderWidth: 1, borderColor: theme.colors.primary },
  notifyButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  notifyButtonTextActive: { color: theme.colors.primaryDark },
  buttonPressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
  demoNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginTop: 12, paddingHorizontal: 4 },
  demoNoticeText: { flex: 1, color: theme.colors.textMuted, fontSize: 10, lineHeight: 15, textAlign: 'left' },
});
