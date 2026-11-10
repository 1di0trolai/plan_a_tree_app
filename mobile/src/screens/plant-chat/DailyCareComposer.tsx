/** Cung cấp ô ghi chú và các thao tác chăm sóc nhanh để lưu việc đã làm cho từng cây. */

import { t, useI18n } from "@/i18n";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { JourneyButton, ui } from "@/components/journeyUI";
import { localDateKey } from "@/data/seed";
import { useControlFocus } from "@/hooks/useControlFocus";
import { useApp } from "@/store/AppStore";
import { COLORS, GRADIENTS, INPUT, INTERACTION, LAYOUT, RADIUS, SPACING, TYPE } from "@/theme";
import type { CareEvent } from "@/types/app";

const quickActions = [
  ["water", "Đã tưới"], ["fertilize", "Đã bón phân"], ["repot", "Đã thay chậu"],
  ["prune", "Đã tỉa"], ["observe", "Đã quan sát"],
] as const;

/** A factual care log beside the conversation, not another daily reward check-in. */
export function DailyCareComposer({ plantId, disabled = false }: { plantId: string; disabled?: boolean }) {
  useI18n();
  const focus = useControlFocus();
  const { state, recordCareEvent, persistNow } = useApp();
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const pendingCare = useRef<{ kind: CareEvent["kind"]; note: string } | null>(null);
  const writing = useRef(false);
  const today = localDateKey();
  const todayCount = state.careEvents.filter((event) => event.plantId === plantId
    && Number.isFinite(Date.parse(event.createdAt)) && localDateKey(new Date(event.createdAt)) === today).length;

  const saveCare = async (kind: CareEvent["kind"], value: string) => {
    if (writing.current || disabled) return;
    const trimmed = value.trim();
    if (!pendingCare.current && !trimmed) return;
    writing.current = true;
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      if (!pendingCare.current) {
        recordCareEvent({ plantId, kind, note: trimmed });
        pendingCare.current = { kind, note: trimmed };
        setPending(true);
      }
      // A retry only flushes the same event; it must never log it twice.
      await persistNow();
      pendingCare.current = null;
      setPending(false);
      setNote("");
      setSaved(true);
    } catch {
      if (pendingCare.current) setNote(pendingCare.current.note);
      setError(t("Chưa lưu xuống máy. Thử lưu lại ghi chép này."));
    } finally {
      writing.current = false;
      setSaving(false);
    }
  };
  const confirmAction = (kind: CareEvent["kind"], label: string) => Alert.alert(
    t("Ghi lại: {action}", { action: t(label) }), t("Chỉ ghi việc bạn đã làm. Không cần tưới hoặc bón phân mỗi ngày."), [
      { text: t("Hủy"), style: "cancel" },
      { text: t("Đã thực hiện"), onPress: () => void saveCare(kind, note.trim() || label) },
    ],
  );

  return <View style={styles.container} testID="daily-care-composer">
    <Pressable {...focus.props("daily-care-toggle")} accessibilityRole="button"
      accessibilityState={{ expanded }} accessibilityLabel={t("Hôm nay đã làm gì?")}
      onPress={() => setExpanded((value) => !value)} testID="daily-care-toggle"
      style={({ pressed }) => [styles.header, pressed && styles.pressed, focus.style("daily-care-toggle")]}>
      <Ionicons accessible={false} name="create-outline" size={LAYOUT.badgeIcon} color={COLORS.primary} />
      <Text style={styles.title}>{t("Hôm nay đã làm gì?")}</Text>
      {todayCount ? <Text style={styles.count} accessibilityLabel={t("{count} ghi chép hôm nay", { count: todayCount })}>{todayCount}</Text> : null}
      <Ionicons accessible={false} name={expanded ? "chevron-up" : "chevron-down"}
        size={LAYOUT.badgeIcon} color={COLORS.primary} />
    </Pressable>
    {expanded ? <View style={styles.body}>
      <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.quickActions}>
        {quickActions.map(([kind, label]) => <JourneyButton key={kind} title={t(label)} secondary size="sm"
          disabled={disabled || saving || pending} style={styles.quickButton}
          onPress={() => confirmAction(kind, label)} />)}
      </ScrollView>
      <View style={[styles.careComposer, focus.style("care-note")]} testID="care-note-composer">
        <TextInput accessibilityLabel={t("Ghi chú chăm sóc")} {...focus.props("care-note")}
          value={note} onChangeText={(value) => { setNote(value); setError(""); setSaved(false); }}
          placeholder={t("Đã lau lá, đổi vị trí chậu…")} placeholderTextColor={COLORS.textMuted}
          multiline maxLength={1200} editable={!disabled && !saving && !pending}
          underlineColorAndroid={COLORS.transparent}
          style={[styles.careInput, (disabled || saving || pending) && ui.disabled]} />
        {note.trim() ? <Pressable {...focus.props("care-save")} accessibilityRole="button"
          accessibilityLabel={pending ? t("Thử lưu ghi chú") : t("Lưu ghi chú")}
          accessibilityState={{ disabled: disabled || saving, busy: saving }} disabled={disabled || saving}
          onPress={() => void saveCare("other", note)} testID="care-note-save"
          style={({ pressed }) => [styles.careSaveButton, pressed && styles.savePressed, focus.style("care-save"), disabled && ui.disabled]}>
          {saving ? <ActivityIndicator color={COLORS.onAction} />
            : <Ionicons accessible={false} name={pending ? "refresh-outline" : "checkmark-outline"}
              size={LAYOUT.smallIcon} color={COLORS.onAction} />}
        </Pressable> : null}
      </View>
      {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={ui.error}>{error}</Text> : null}
      {saved ? <Text accessibilityLiveRegion="polite" style={styles.saved}>{t("Đã lưu vào nhật ký.")}</Text> : null}
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  container: { backgroundColor: COLORS.surfaceSoft, borderRadius: RADIUS.md, borderCurve: "continuous", marginBottom: SPACING.sm },
  header: { minHeight: LAYOUT.touch, flexDirection: "row", alignItems: "center", gap: SPACING.sm,
    paddingHorizontal: SPACING.compact, paddingVertical: SPACING.sm, borderRadius: RADIUS.md, borderCurve: "continuous" },
  title: { ...TYPE.label, flex: 1, flexShrink: 1, color: COLORS.primaryDark },
  count: { ...TYPE.caption, color: COLORS.primaryDark, paddingHorizontal: SPACING.sm },
  pressed: { backgroundColor: COLORS.pressed },
  body: { paddingHorizontal: SPACING.sm, paddingBottom: SPACING.sm, gap: SPACING.sm },
  quickActions: { flexDirection: "row", gap: SPACING.sm, paddingVertical: SPACING.xs },
  quickButton: { marginTop: 0, paddingHorizontal: SPACING.compact },
  careComposer: { flexDirection: "row", alignItems: "center", gap: SPACING.xs, minHeight: LAYOUT.touch + SPACING.sm,
    borderWidth: 1, borderColor: COLORS.controlBorder, borderRadius: RADIUS.md, borderCurve: "continuous",
    backgroundColor: COLORS.background, padding: SPACING.xs },
  careInput: { ...INPUT.multiline, flex: 1, minWidth: 0, minHeight: LAYOUT.touch, maxHeight: LAYOUT.touch * 2,
    paddingHorizontal: SPACING.sm, textAlignVertical: "center" },
  careSaveButton: { width: LAYOUT.touch, height: LAYOUT.touch, justifyContent: "center", alignItems: "center",
    borderRadius: RADIUS.pill, backgroundColor: COLORS.actionSurface, ...GRADIENTS.action },
  savePressed: { opacity: INTERACTION.primaryPressedOpacity },
  saved: { ...TYPE.caption, color: COLORS.success },
});
