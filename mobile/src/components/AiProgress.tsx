/** Hiển thị tiến độ xử lý của trợ lý thông minh cùng thao tác hủy khi tác vụ đang chạy. */

import { t, useI18n } from "@/i18n";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useControlFocus } from "@/hooks/useControlFocus";
import { COLORS, INTERACTION, LAYOUT, RADIUS, SPACING, TYPE } from "@/theme";

/** Elapsed time, not an invented percentage of model completion. */
export function AiProgress({
  message,
  onCancel,
}: {
  message: string;
  onCancel: () => void;
}) {
  useI18n();
  const [seconds, setSeconds] = useState(0);
  const focus = useControlFocus();
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(
      () => setSeconds(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, []);
  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <ActivityIndicator color={COLORS.primary} />
        <Text accessibilityLiveRegion="polite" style={styles.message}>
          {message}
        </Text>
        <Text style={styles.elapsed}>{t("{seconds}s", { seconds })}</Text>
      </View>
      {seconds >= 12 ? (
        <Text style={styles.hint}>
          {t("Đang chờ phản hồi. Bạn có thể hủy và thử lại.")}</Text>
      ) : null}
      <Pressable
        {...focus.props("cancel")}
        accessibilityRole="button"
        onPress={onCancel}
        style={({ pressed }) => [styles.cancel, pressed && { opacity: INTERACTION.pressedOpacity }, focus.style("cancel")]}
      >
        <Text style={styles.cancelText}>{t("Hủy yêu cầu")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.surfaceSoft,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginTop: SPACING.compact,
  },
  row: { flexDirection: "row", alignItems: "center", gap: SPACING.compact },
  message: { ...TYPE.subhead, flex: 1, color: COLORS.text },
  elapsed: {
    ...TYPE.caption,
    fontVariant: ["tabular-nums"],
  },
  hint: {
    ...TYPE.caption,
    marginTop: SPACING.compact,
  },
  cancel: {
    alignSelf: "flex-start",
    minHeight: LAYOUT.touch,
    justifyContent: "center",
    marginTop: SPACING.xs,
  },
  cancelText: { ...TYPE.label, color: COLORS.primaryDark },
});
