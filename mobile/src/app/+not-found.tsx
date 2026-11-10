/** Hiển thị trang không tìm thấy và đường dẫn quay về khi người dùng mở địa chỉ không hợp lệ. */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useControlFocus } from '@/hooks/useControlFocus';
import { useI18n } from '@/i18n';
import { COLORS, GRADIENTS, INTERACTION, LAYOUT, RADIUS, SHADOWS, SPACING, TYPE } from '@/theme';

export default function NotFoundScreen() {
  const { t } = useI18n();
  const focus = useControlFocus();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.card}>
        <View style={styles.icon}>
          <Ionicons name="leaf-outline" size={SPACING.xl} color={COLORS.primary} />
        </View>
        <Text style={styles.title}>{t("Lối này chưa mọc cây")}</Text>
        <Text style={styles.copy}>{t("Màn hình bạn tìm chưa tồn tại trong phiên bản PAT hiện tại.")}</Text>
        <Link href="/" asChild>
          <Pressable {...focus.props('home')} style={({ pressed }) => [styles.button, focus.style('home'), pressed && styles.pressed]} accessibilityRole="button">
            <Text style={styles.buttonText}>{t("Về trang bắt đầu")}</Text>
          </Pressable>
        </Link>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background, ...GRADIENTS.ambient, justifyContent: 'center', padding: SPACING.lg },
  card: { width: '100%', maxWidth: LAYOUT.formMaxWidth, alignSelf: 'center', alignItems: 'center', padding: SPACING.lg, borderRadius: RADIUS.xl, borderCurve: 'continuous', backgroundColor: COLORS.surface, ...SHADOWS.card },
  icon: { width: SPACING.hero, height: SPACING.hero, borderRadius: RADIUS.lg, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surfaceSoft, ...GRADIENTS.garden },
  title: { ...TYPE.title, marginTop: SPACING.page, textAlign: 'center' },
  copy: { ...TYPE.body, marginTop: SPACING.sm, color: COLORS.textMuted, textAlign: 'center' },
  button: { marginTop: SPACING.lg, minHeight: LAYOUT.control, justifyContent: 'center', paddingHorizontal: SPACING.page, paddingVertical: SPACING.md, borderRadius: RADIUS.md, borderCurve: 'continuous', backgroundColor: COLORS.actionSurface, ...GRADIENTS.action },
  buttonText: { ...TYPE.label, color: COLORS.onAction, textAlign: 'center' },
  pressed: { opacity: INTERACTION.pressedOpacity },
});
