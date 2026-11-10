/** Hiển thị bộ chọn tiếng Việt, tiếng Anh và tiếng Nhật, đồng thời lưu lựa chọn ngôn ngữ. */

import Ionicons from "@expo/vector-icons/Ionicons";
import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { useControlFocus } from "@/hooks/useControlFocus";
import { LANGUAGES, useI18n } from "@/i18n";
import { COLORS, INTERACTION, LAYOUT, RADIUS, SPACING, TYPE } from "@/theme";

/** Self-names remain readable even before a user signs in. */
export function LanguageSelector({ disabled = false }: { disabled?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  const focus = useControlFocus();
  const operation = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const change = async (next: typeof locale) => {
    if (disabled || operation.current || next === locale) return;
    operation.current = true;
    setBusy(true);
    setError("");
    try { await setLocale(next); }
    catch { setError("Chưa lưu được ngôn ngữ. Hãy thử lại."); }
    finally { operation.current = false; setBusy(false); }
  };
  return (
    <View style={styles.section}>
      <Text style={styles.label}>{t("Ngôn ngữ")}</Text>
      <View style={styles.options} accessibilityRole="radiogroup" accessibilityLabel={t("Ngôn ngữ")}>
        {LANGUAGES.map(language => (
          <Pressable key={language.code} {...focus.props(language.code)}
            accessibilityRole="radio" accessibilityLabel={language.name}
            accessibilityState={{ checked: locale === language.code, disabled: disabled || busy }}
            disabled={disabled || busy} onPress={() => void change(language.code)}
            style={({ pressed }) => [styles.option, locale === language.code && styles.selected,
              (disabled || busy) && styles.disabled, pressed && styles.pressed, focus.style(language.code)]}>
            {locale === language.code && <Ionicons name="checkmark" size={LAYOUT.badgeIcon} color={COLORS.primaryDark} accessible={false} />}
            <Text style={[styles.name, locale === language.code && styles.selectedName]}>{language.name}</Text>
          </Pressable>
        ))}
        {busy && <ActivityIndicator color={COLORS.primaryDark} accessibilityLabel={t("Đang lưu ngôn ngữ")} />}
      </View>
      {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{t(error)}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: SPACING.sm },
  label: { ...TYPE.label, color: COLORS.textMuted },
  options: { flexDirection: "row", flexWrap: "wrap", gap: SPACING.sm, alignItems: "center" },
  option: { minHeight: LAYOUT.touch, flexDirection: "row", flexGrow: 1, alignItems: "center", justifyContent: "center",
    paddingHorizontal: SPACING.compact, paddingVertical: SPACING.sm, gap: SPACING.xs,
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, backgroundColor: COLORS.surface },
  selected: { borderColor: COLORS.primary, backgroundColor: COLORS.surfaceSoft },
  name: { ...TYPE.subhead, color: COLORS.text, flexShrink: 1 },
  selectedName: { color: COLORS.primaryDark, fontWeight: "600" },
  pressed: { opacity: INTERACTION.pressedOpacity },
  disabled: { opacity: INTERACTION.disabledOpacity },
  error: { ...TYPE.caption, color: COLORS.danger },
});
