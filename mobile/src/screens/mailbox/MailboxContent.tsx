/** Hiển thị danh sách và nội dung thư, bộ lọc cùng các nút đọc, xóa và nhận quà đính kèm. */

import { useI18n } from "@/i18n";
import { getLocaleTag, t as translate } from "@/i18n/core";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CurrencyArtwork } from "@/components/CurrencyArtwork";
import { FoodArtwork } from "@/components/FoodArtwork";
import { JourneyButton } from "@/components/journeyUI";
import { useControlFocus } from "@/hooks/useControlFocus";
import { COLORS, INTERACTION, LAYOUT, RADIUS, SPACING, TYPE } from "@/theme";
import type { InventoryItem, MailMessage } from "@/types/app";

export type MailFilter = "all" | "unread";
export const hasMailReward = (mail: MailMessage) => mail.attachments.length > 0 && !mail.claimedAt;
export const canDeleteMail = (mail: MailMessage) => !hasMailReward(mail);

/** Only an exact, known system template is localized; publisher/player text stays original. */
function systemMailDisplay(mail: MailMessage): MailMessage {
  const cycle = mail.source === "system" ? /^login-cycle-([1-9]\d*)$/.exec(mail.sourceRef)?.[1] : undefined;
  return cycle && mail.title === "Quà ghé vườn" && mail.body === `Quà chưa nhận của chu kỳ ${cycle}.`
    ? { ...mail, title: translate("Quà ghé vườn"), body: translate("Quà chưa nhận của chu kỳ {cycle}.", { cycle }) }
    : mail;
}

export function MailboxContent({ messages, filter, selectedId, items, busy, pendingRecovery, error, onFilter, onOpen, onClose, onClaim, onClaimAll, onReadAll, onDeleteAll, onDelete, onRetry }: {
  messages: MailMessage[]; filter: MailFilter; selectedId: string | null; items: InventoryItem[]; busy: boolean; pendingRecovery: boolean; error: string;
  onFilter: (filter: MailFilter) => void; onOpen: (id: string) => void; onClose: () => void;
  onClaim: (id: string) => void; onClaimAll: () => void; onReadAll: () => void; onDeleteAll: () => void; onDelete: (id: string) => void; onRetry: () => void;
}) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const focus = useControlFocus();
  const displayed = messages.map(systemMailDisplay);
  const selected = displayed.find((mail) => mail.id === selectedId);
  const visible = displayed.filter((mail) => filter === "unread" ? !mail.readAt : true)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const unclaimed = messages.filter(hasMailReward).length;
  const hasUnread = messages.some((mail) => !mail.readAt);
  const hasDeletable = messages.some(canDeleteMail);
  const feedback = error ? <View style={styles.feedback}><Text testID="mailbox-error" accessibilityRole="alert" style={styles.error}>{t(error)}</Text>{pendingRecovery ? <JourneyButton testID="mailbox-retry" title={t("Thử lưu lại")} size="sm" loading={busy} onPress={onRetry} /> : null}</View> : null;
  return <>
    <View style={styles.filters}>
      {([["all", "Tất cả"], ["unread", "Chưa đọc"]] as const).map(([id, label]) => <Pressable
        {...focus.props(id)} key={id} testID={`mail-filter-${id}`} accessibilityRole="button" accessibilityState={{ selected: filter === id }}
        onPress={() => onFilter(id)} style={({ pressed }) => [styles.filter, filter === id && styles.filterActive, pressed && { opacity: INTERACTION.primaryPressedOpacity }, focus.style(id)]}
      ><Text style={[TYPE.label, filter === id && { color: COLORS.onPrimary }]}>{t(label)}</Text></Pressable>)}
    </View>
    <View testID="mail-bulk-actions" style={styles.bulkActions}>
      <JourneyButton testID="mail-read-all" title={t("Đọc tất cả")} size="sm" variant="secondary" icon="checkmark-done-outline" disabled={busy || pendingRecovery || !hasUnread} onPress={onReadAll} style={styles.bulkButton} />
      <JourneyButton testID="mail-delete-all" title={t("Xoá tất cả")} size="sm" variant="destructive" icon="trash-outline" disabled={busy || pendingRecovery || !hasDeletable} onPress={onDeleteAll} style={styles.bulkButton} />
    </View>
    {feedback}
    <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
      {visible.length ? visible.map((mail) => <Pressable
        {...focus.props(mail.id)} key={mail.id} testID={`mail-row-${mail.id}`} accessibilityRole="button" accessibilityLabel={`${mail.title}, ${t(!mail.readAt ? "chưa đọc" : "đã đọc")}${hasMailReward(mail) ? `, ${t("có quà chưa nhận")}` : ""}`}
        onPress={() => onOpen(mail.id)} style={({ pressed }) => [styles.row, pressed && { backgroundColor: COLORS.pressed }, focus.style(mail.id)]}
      >
        <View style={[styles.mailIcon, !mail.readAt && { backgroundColor: COLORS.sageDeep }]}><Ionicons name={hasMailReward(mail) ? "gift-outline" : mail.readAt ? "mail-open-outline" : "mail-outline"} size={LAYOUT.icon} color={COLORS.primary} accessible={false} /></View>
        <View style={styles.flex}><Text style={[TYPE.headline, !mail.readAt && { fontWeight: "700" }]}>{mail.title}</Text><Text style={TYPE.caption}>{t(mail.source === "publisher" ? "Đội ngũ PAT" : "Khu vườn PAT")} · {mailDate(mail.createdAt)}</Text>{hasMailReward(mail) ? <Text style={styles.available}>{t("Có thể nhận quà")}</Text> : null}</View>
        <Ionicons name="chevron-forward" size={LAYOUT.smallIcon} color={COLORS.textMuted} accessible={false} />
      </Pressable>) : <View testID="mailbox-empty" style={styles.empty}><Ionicons name="mail-open-outline" size={LAYOUT.control} color={COLORS.primary} accessible={false} /><Text style={TYPE.headline}>{t(filter === "all" ? "Hòm thư đang trống" : "Bạn đã đọc hết thư")}</Text></View>}
    </ScrollView>
    {unclaimed > 0 ? <View style={styles.footer}><JourneyButton testID="mail-claim-all" title={t("Nhận tất cả · {count}", { count: unclaimed })} icon="gift-outline" disabled={busy || pendingRecovery} loading={busy} onPress={onClaimAll} /></View> : null}
    <Modal visible={Boolean(selected)} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={[styles.scrim, { paddingTop: insets.top + SPACING.md, paddingBottom: insets.bottom + SPACING.md }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("Đóng thư")} onPress={onClose} style={StyleSheet.absoluteFill} />
        <View testID="mail-detail" accessibilityViewIsModal onAccessibilityEscape={onClose} style={styles.detail}>
          <View style={styles.detailHeading}><Text accessibilityRole="header" style={[TYPE.headline, styles.flex]}>{selected?.title}</Text><Pressable {...focus.props("close-mail")} accessibilityRole="button" accessibilityLabel={t("Đóng thư")} onPress={onClose} style={({ pressed }) => [styles.close, pressed && { backgroundColor: COLORS.pressed }, focus.style("close-mail")]}><Ionicons name="close" size={LAYOUT.icon} color={COLORS.textMuted} accessible={false} /></Pressable></View>
          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            <Text style={TYPE.caption}>{t(selected?.source === "publisher" ? "Đội ngũ PAT" : "Khu vườn PAT")} · {selected ? mailDate(selected.createdAt) : ""}</Text>
            <Text style={TYPE.body}>{selected?.body}</Text>
            <View style={styles.attachments}>{selected?.attachments.map((attachment, index) => <View testID="mail-attachment" key={index} style={styles.attachment}>
              {attachment.kind === "gold" ? <CurrencyArtwork currency="gold" size={LAYOUT.touch} /> : <FoodArtwork itemId={attachment.itemId} size={LAYOUT.touch} />}
              <Text style={TYPE.label}>{t(attachment.kind === "gold" ? "Vàng" : items.find((item) => item.id === attachment.itemId)?.name ?? "Thức ăn")}</Text><Text style={TYPE.label}>×{attachment.quantity.toLocaleString(getLocaleTag())}</Text>
            </View>)}</View>
            {selected?.claimedAt && selected.attachments.length ? <Text accessibilityLiveRegion="polite" style={styles.available}>{t("Đã nhận quà")}</Text> : null}
            {error ? feedback : null}
          </ScrollView>
          <View style={styles.detailActions}>
            {selected && canDeleteMail(selected) ? <JourneyButton testID="mail-delete" title={t("Xóa thư")} icon="trash-outline" variant="ghost" size="sm" disabled={busy || pendingRecovery} onPress={() => onDelete(selected.id)} style={styles.flex} /> : null}
            {selected && hasMailReward(selected) ? <JourneyButton testID="mail-claim" title={t("Nhận quà")} icon="gift-outline" loading={busy} disabled={busy || pendingRecovery} onPress={() => onClaim(selected.id)} style={styles.flex} /> : null}
          </View>
        </View>
      </View>
    </Modal>
  </>;
}

function mailDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString(getLocaleTag(), { timeZone: "Asia/Ho_Chi_Minh" }) : "";
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: SPACING.sm, marginBottom: SPACING.md },
  filter: { minHeight: LAYOUT.touch, paddingHorizontal: SPACING.md, justifyContent: "center", borderRadius: RADIUS.pill, backgroundColor: COLORS.surfaceAlt },
  filterActive: { backgroundColor: COLORS.primaryDark },
  bulkActions: { flexDirection: "row", flexWrap: "wrap", gap: SPACING.sm, marginBottom: SPACING.sm },
  bulkButton: { flexGrow: 1, flexBasis: LAYOUT.artwork },
  list: { flexGrow: 1, paddingBottom: SPACING.md },
  row: { minHeight: LAYOUT.thumbnail, flexDirection: "row", gap: SPACING.compact, alignItems: "center", paddingVertical: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.border, borderRadius: RADIUS.sm },
  mailIcon: { minWidth: LAYOUT.touch, minHeight: LAYOUT.touch, alignItems: "center", justifyContent: "center", borderRadius: RADIUS.md, backgroundColor: COLORS.surfaceAlt },
  available: { ...TYPE.caption, color: COLORS.primaryDark, fontWeight: "600" },
  empty: { flex: 1, justifyContent: "center", alignItems: "center", gap: SPACING.md, padding: SPACING.lg },
  feedback: { gap: SPACING.sm, paddingVertical: SPACING.sm },
  error: { ...TYPE.subhead, color: COLORS.danger },
  footer: { paddingTop: SPACING.md },
  scrim: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: COLORS.overlay, paddingHorizontal: SPACING.md },
  detail: { width: "100%", maxWidth: LAYOUT.formMaxWidth, maxHeight: "100%", borderRadius: RADIUS.lg, borderCurve: "continuous", backgroundColor: COLORS.surface, overflow: "hidden" },
  detailHeading: { flexDirection: "row", gap: SPACING.sm, padding: SPACING.md, alignItems: "center", borderBottomWidth: 1, borderBottomColor: COLORS.border },
  close: { minWidth: LAYOUT.touch, minHeight: LAYOUT.touch, justifyContent: "center", alignItems: "center", borderRadius: RADIUS.pill },
  body: { flexGrow: 0, flexShrink: 1 },
  bodyContent: { gap: SPACING.md, padding: SPACING.md },
  attachments: { flexDirection: "row", flexWrap: "wrap", gap: SPACING.sm },
  attachment: { flexGrow: 1, minWidth: LAYOUT.thumbnail + SPACING.xl, alignItems: "center", padding: SPACING.compact, gap: SPACING.xs, borderRadius: RADIUS.md, backgroundColor: COLORS.surfaceSoft },
  detailActions: { flexDirection: "row", flexWrap: "wrap", gap: SPACING.sm, padding: SPACING.md, borderTopWidth: 1, borderTopColor: COLORS.border },
});
