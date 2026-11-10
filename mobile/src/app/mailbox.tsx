/** Điều phối hòm thư: mở, đọc, xóa thư và nhận quà với kiểm soát thao tác lưu dữ liệu. */

import { useI18n } from "@/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { Alert, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { JourneyHeader } from "@/components/journeyUI";
import { canDeleteMail, MailboxContent, type MailFilter } from "@/screens/mailbox/MailboxContent";
import { useApp } from "@/store/AppStore";
import { COLORS, LAYOUT, SPACING } from "@/theme";

export default function MailboxScreen() {
  const { t } = useI18n();
  const { state, markMailRead, markAllMailRead, claimMail, claimAllMail, deleteMail, deleteAllMail, pendingRewardAction, retryRewardAction, retrySync } = useApp();
  useFocusEffect(useCallback(() => { void retrySync(); }, [retrySync]));
  const [filter, setFilter] = useState<MailFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  const confirmingDelete = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const visibleSelectedId = state.mailbox.some((mail) => mail.id === selectedId) ? selectedId : null;
  const action = async (run: () => Promise<{ ok: boolean; message: string }>, closeOnSuccess = false) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError("");
    try {
      const result = await run();
      if (!mounted.current) return;
      if (!result.ok) setError(result.message);
      else if (closeOnSuccess) setSelectedId(null);
    } catch { if (mounted.current) setError("Chưa lưu được thay đổi. Thử lại nhé."); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  };
  const confirmDeleteAll = () => {
    if (locked.current || pendingRewardAction || confirmingDelete.current) return;
    const count = state.mailbox.filter(canDeleteMail).length;
    if (!count) return;
    confirmingDelete.current = true;
    Alert.alert(t("Xoá tất cả thư?"), t("Xoá {count} thư trong hòm thư. Thư có quà chưa nhận sẽ được giữ lại.", { count }), [
      { text: t("Huỷ"), style: "cancel", onPress: () => { confirmingDelete.current = false; } },
      { text: t("Xoá"), style: "destructive", onPress: () => {
        confirmingDelete.current = false;
        if (mounted.current) void action(deleteAllMail);
      } },
    ], { cancelable: true, onDismiss: () => { confirmingDelete.current = false; } });
  };
  return <SafeAreaView style={styles.screen}><View style={styles.content}>
    <JourneyHeader title={t("Hòm thư")} />
    <MailboxContent
      messages={state.mailbox} items={state.inventory.items} filter={filter} selectedId={visibleSelectedId}
      busy={busy} pendingRecovery={pendingRewardAction} error={error || (pendingRewardAction ? t("Có thay đổi đang chờ lưu.") : "")}
      onFilter={setFilter}
      onOpen={(id) => { setSelectedId(id); if (!pendingRewardAction) void action(() => markMailRead(id)); }}
      onClose={() => setSelectedId(null)}
      onClaim={(id) => { void action(() => claimMail(id)); }}
      onClaimAll={() => { void action(claimAllMail); }}
      onReadAll={() => { void action(markAllMailRead); }}
      onDeleteAll={confirmDeleteAll}
      onDelete={(id) => { void action(() => deleteMail(id), true); }}
      onRetry={() => { void action(retryRewardAction); }}
    />
  </View></SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  content: { flex: 1, width: "100%", maxWidth: LAYOUT.contentMaxWidth, alignSelf: "center", paddingHorizontal: SPACING.page, paddingBottom: SPACING.md },
});
