/** Chỉ hiển thị cảnh báo khi dữ liệu đồng bộ xung đột và cho phép xác nhận tải bản máy chủ. */

import { useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useApp } from "@/store/AppStore";
import { useI18n } from "@/i18n";
import { COLORS, INTERACTION, LAYOUT, RADIUS, SPACING, TYPE } from "@/theme";

/** Ordinary sync stays silent. Conflicting saves still require an explicit choice. */
export function SyncStatusBanner() {
  const { t } = useI18n();
  const { syncStatus, reloadCloud } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operation = useRef(false);
  const dialog = useRef(false);
  if (syncStatus?.phase !== "conflict") return null;

  const run = async () => {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await reloadCloud();
      if (!result.ok) setError(result.message);
    } catch {
      setError("Chưa đồng bộ được. Dữ liệu trên máy vẫn được giữ lại.");
    } finally {
      operation.current = false;
      setBusy(false);
    }
  };
  const reload = () => {
    if (dialog.current || operation.current) return;
    dialog.current = true;
    Alert.alert(t("Tải dữ liệu từ máy chủ?"),
      t("App sẽ dùng bản đã đồng bộ từ thiết bị khác. Bản chưa đồng bộ trên máy này được giữ làm bản dự phòng, không tự gộp vào bản máy chủ."), [
        { text: t("Để sau"), style: "cancel", onPress: () => { dialog.current = false; } },
        { text: t("Tải bản mới"), onPress: () => { dialog.current = false; void run(); } },
      ], { cancelable: true, onDismiss: () => { dialog.current = false; } });
  };
  return (
    <SafeAreaView edges={["top"]} style={styles.surface}>
      <View style={styles.content}>
        <Text accessibilityLiveRegion="polite" style={styles.message}>{t(error || syncStatus.message)}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t("Tải dữ liệu mới từ máy chủ")}
          accessibilityState={{ disabled: busy, busy }} disabled={busy}
          onPress={reload}
          style={({ pressed }) => [styles.action, pressed && styles.pressed, busy && styles.disabled]}>
          {busy ? <ActivityIndicator color={COLORS.primaryDark} /> : <Text style={styles.label}>{t("Tải bản mới")}</Text>}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  surface: { backgroundColor: COLORS.surface },
  content: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs, flexDirection: "row", flexWrap: "wrap",
    alignItems: "center", gap: SPACING.compact, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  message: { ...TYPE.caption, color: COLORS.text, flexGrow: 1, flexShrink: 1, flexBasis: 220 },
  action: { minHeight: LAYOUT.control, minWidth: LAYOUT.control, paddingHorizontal: SPACING.md,
    justifyContent: "center", alignItems: "center", borderRadius: RADIUS.md, backgroundColor: COLORS.surfaceSoft },
  label: { ...TYPE.label, color: COLORS.primaryDark },
  pressed: { opacity: INTERACTION.pressedOpacity },
  disabled: { opacity: INTERACTION.disabledOpacity },
});
