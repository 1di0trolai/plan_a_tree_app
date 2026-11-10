/** Hiển thị các quy tắc mật khẩu và đánh dấu từng điều kiện đã được đáp ứng. */

import Ionicons from "@expo/vector-icons/Ionicons";
import { StyleSheet, Text, View } from "react-native";

import { COLORS, LAYOUT, SPACING, TYPE } from "@/theme";
import { getPasswordRules } from "@/utils/passwordPolicy";
import { useI18n } from "@/i18n";

export function PasswordRules({ value }: { value: string }) {
  const { t } = useI18n();
  const rules = getPasswordRules(value);
  return (
    <View style={styles.list}>
      <Rule label={t("8 ký tự trở lên")} met={rules.length} />
      <Rule label={t("Chỉ gồm A–Z, a–z, 0–9")} met={rules.characters} />
    </View>
  );
}

function Rule({ label, met }: { label: string; met: boolean }) {
  const { t } = useI18n();
  const color = met ? COLORS.success : COLORS.textMuted;
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={t("{status}: {rule}", { status: t(met ? "Đạt" : "Chưa đạt"), rule: label })}
    >
      <Ionicons name={met ? "checkmark" : "close"} size={LAYOUT.smallIcon} color={color} accessible={false} />
      <Text style={[styles.label, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: SPACING.xs },
  row: { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  label: { ...TYPE.subhead, flexShrink: 1 },
});
