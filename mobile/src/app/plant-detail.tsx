/** Hiển thị hồ sơ cây, chỉnh giai đoạn và điều kiện trồng, xem nhật ký, ảnh cùng thao tác lưu trữ. */

import { t, useI18n } from "@/i18n";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useLocalSearchParams } from "expo-router";
import { useState, type ReactNode } from "react";
import { Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  JourneyButton, JourneyChoices, JourneyField, JourneyHeader,
  phaseLabels, ui,
} from "@/components/journeyUI";
import { useApp } from "@/store/AppStore";
import { useControlFocus } from "@/hooks/useControlFocus";
import {
  buildPlantJournal, careLabels, groupJournalDays, historyDate, historyPage,
  JOURNAL_PAGE_SIZE, PHOTO_PAGE_SIZE, sortedPlantPhotos,
} from "@/screens/plant-detail/history";
import { COLORS, LAYOUT, RADIUS, SPACING, TYPE } from "@/theme";
import type { Plant, PlantPhoto } from "@/types/app";
import { getCurrentPlantStreak } from "@/utils/plantStreak";

export default function PlantDetailScreen() {
  useI18n();
  const { plantId } = useLocalSearchParams<{ plantId: string }>();
  const { state } = useApp();
  const plant = state.plants.find((entry) => entry.id === plantId);
  if (!plant) return <SafeAreaView style={ui.safe}>
    <JourneyHeader title={t("Không tìm thấy cây")} />
    <Text style={[ui.caption, { margin: SPACING.page }]}>{t("Hãy chọn lại cây từ khu vườn.")}</Text>
  </SafeAreaView>;
  return <PlantDetail key={plant.id} plant={plant} />;
}

function PlantDetail({ plant }: { plant: Plant }) {
  useI18n();
  const focus = useControlFocus();
  const { width, fontScale } = useWindowDimensions();
  // Give dates/phase labels room to wrap at accessibility text sizes.
  const photoColumns = width < 360 || fontScale >= 1.3 ? 1 : 2;
  const { state, updateJourney, removePlant, restorePlant, persistNow } = useApp();
  const [section, setSection] = useState<string | null>(plant.journey.phase === "planning" && !plant.archived ? "phase" : null);
  const [location, setLocation] = useState(plant.journey.location);
  const [light, setLight] = useState(plant.journey.light);
  const [notes, setNotes] = useState(plant.journey.notes);
  const [journalIndex, setJournalIndex] = useState(0);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [preview, setPreview] = useState<PlantPhoto | null>(null);
  const photos = sortedPlantPhotos(plant.id, state.plantPhotos);
  const events = state.careEvents.filter((entry) => entry.plantId === plant.id);
  const journal = buildPlantJournal(plant.id, events);
  const journalPage = historyPage(journal, journalIndex, JOURNAL_PAGE_SIZE);
  const photoPage = historyPage(photos, photoIndex, PHOTO_PAGE_SIZE);
  const confirmStored = async (): Promise<boolean> => {
    try {
      await persistNow();
      return true;
    } catch {
      Alert.alert(t("Chưa lưu xuống máy"), t("Thay đổi còn trong phiên này. Thử lưu lại trước khi đóng ứng dụng; không cần thực hiện thay đổi lần nữa."), [
        { text: t("Đóng"), style: "cancel" },
        { text: t("Thử lưu lại"), onPress: () => void confirmStored() },
      ]);
      return false;
    }
  };
  const restore = async () => {
    const result = restorePlant(plant.id);
    if (!result.ok) { Alert.alert(t("Chưa thể khôi phục"), t(result.message)); return; }
    if (await confirmStored()) router.replace({ pathname: "/(tabs)/garden", params: { gardenNotice: t("Đã đưa {name} về vườn.", { name: plant.name }) } });
  };
  const archive = () => Alert.alert(
    t("Ẩn cây khỏi khu vườn?"), t("Cây sẽ chuyển sang danh sách đã lưu trữ. Bạn có thể khôi phục; toàn bộ ảnh và trò chuyện được giữ. Cây chưa kiểm tra trong nhiệm vụ hôm nay không thể lưu trữ."), [
      { text: t("Giữ trong vườn"), style: "cancel" },
      { text: t("Ẩn cây"), onPress: async () => {
        const result = removePlant(plant.id);
        if (!result.ok) Alert.alert(t("Chưa thể lưu trữ"), t(result.message));
        else if (await confirmStored()) router.replace({ pathname: "/(tabs)/garden", params: { gardenNotice: t("Đã ẩn {name} khỏi vườn.", { name: plant.name }) } });
      } },
    ],
  );
  const fold = (id: string, title: string, summary: string | null, children: ReactNode) => (
    <View style={[styles.fold, focus.style(id)]}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: section === id }}
        {...focus.props(id)}
        onPress={() => setSection(section === id ? null : id)} style={({ pressed }) => [styles.foldHeader, pressed && styles.pressed]}>
        <View style={ui.flex}><Text style={styles.foldTitle}>{title}</Text>{summary ? <Text style={styles.foldSummary}>{summary}</Text> : null}</View>
        <Ionicons name={section === id ? "chevron-up" : "chevron-down"} size={LAYOUT.smallIcon} color={COLORS.textMuted} />
      </Pressable>
      {section === id ? <View style={styles.foldContent}>{children}</View> : null}
    </View>
  );
  const pagination = (name: string, page: ReturnType<typeof historyPage>, onPage: (index: number) => void) => page.pages > 1 ? (
    <View style={styles.pagination}>
      <Text accessibilityLiveRegion="polite" style={ui.caption}>{page.start}–{page.end} / {page.total}</Text>
      <View style={styles.paginationButtons}>
        <JourneyButton title={t("Mới hơn")} icon="chevron-back" secondary size="sm"
          disabled={page.page === 0} onPress={() => onPage(page.page - 1)} testID={`${name}-previous`} />
        <JourneyButton title={t("Cũ hơn")} icon="chevron-forward" secondary size="sm"
          disabled={page.page === page.pages - 1} onPress={() => onPage(page.page + 1)} testID={`${name}-next`} />
      </View>
    </View>
  ) : null;

  return <SafeAreaView style={ui.safe}>
    <JourneyHeader title={plant.name} subtitle={`${plant.species} · ${plant.archived ? t("Đã lưu trữ") : t(phaseLabels[plant.journey.phase])}`} />
    <ScrollView contentContainerStyle={[ui.content, styles.content]} keyboardShouldPersistTaps="handled">
      <View style={styles.overview}>
        <View style={styles.streakRow}>
          <Ionicons accessible={false} name="flame-outline" color={COLORS.secondary} size={LAYOUT.badgeIcon} />
          <Text style={styles.streak}>{t("{count} ngày liên tiếp", { count: getCurrentPlantStreak(plant) })}</Text>
        </View>
        <Text style={styles.overviewMeta}>{t("Kỷ lục {count} ngày · {photos} ảnh", { count: plant.bestStreak, photos: photos.length })}</Text>
      </View>
      <View style={styles.sections}>
        {!plant.archived ? <>
          {fold("phase", t("Giai đoạn"), t(phaseLabels[plant.journey.phase]), <>
            <JourneyChoices label={t("Giai đoạn thực tế")} size="sm" values={phaseLabels} selected={plant.journey.phase} onSelect={(phase) => {
              if (phase === plant.journey.phase) return;
              Alert.alert(t("Cập nhật giai đoạn?"), t("Chuyển sang “{phase}”. Lần quét chăm sóc tiếp theo sẽ lưu ảnh của giai đoạn mới.", { phase: t(phaseLabels[phase]) }), [
                { text: t("Hủy"), style: "cancel" },
                { text: t("Xác nhận"), onPress: () => {
                  const result = updateJourney(plant.id, { phase });
                  if (!result.ok) Alert.alert(t("Chưa cập nhật"), t(result.message));
                  else { void confirmStored(); setSection(null); }
                } },
              ]);
            }} />
          </>)}
          {fold("conditions", t("Điều kiện trồng"), plant.journey.location || t("Chưa đặt vị trí"), <>
            <JourneyField label={t("Vị trí")} size="sm" value={location} onChangeText={setLocation} />
            <JourneyField label={t("Ánh sáng")} size="sm" value={light} onChangeText={setLight} />
            <JourneyField label={t("Ghi chú")} size="sm" value={notes} onChangeText={setNotes} multiline />
            <JourneyButton title={t("Lưu thay đổi")} secondary size="sm" onPress={async () => {
              const result = updateJourney(plant.id, { location, light, notes });
              if (result.ok && await confirmStored()) setSection(null);
              else if (!result.ok) Alert.alert(t("Chưa lưu"), t(result.message));
            }} />
          </>)}
        </> : null}
        {fold("journal", t("Nhật ký chăm cây"), t("{count} ghi chép", { count: events.length }), <>
          {groupJournalDays(journalPage.records).map((day) => <View key={day.date} style={styles.journalDay}>
            <Text accessibilityRole="header" style={styles.dayLabel}>{historyDate(day.date)}</Text>
            {day.records.map((entry) => <View key={entry.id} style={styles.journalEntry}>
              <View style={styles.entryHeading}>
                <Ionicons accessible={false} name="checkmark-circle-outline"
                  color={COLORS.success} size={LAYOUT.badgeIcon} />
                <Text style={styles.entryKind}>
                  {t(careLabels[entry.event.kind])}
                </Text>
                <Text style={styles.entryTime}>{entry.time}</Text>
              </View>
              <Text style={ui.text}>{entry.event.note}</Text>
            </View>)}
          </View>)}
          {!journal.length ? <Text style={styles.empty}>{t("Chưa có ghi chép.")}</Text> : null}
          {pagination("journal", journalPage, setJournalIndex)}
        </>)}
        {fold("photos", t("Ảnh của cây"), t("{count} ảnh", { count: photos.length }), <>
          <View style={styles.photoGrid}>
            {Array.from({ length: Math.ceil(photoPage.records.length / photoColumns) }, (_, row) => <View key={row} style={styles.photoRow}>
              {photoPage.records.slice(row * photoColumns, row * photoColumns + photoColumns).map((photo) => <Pressable key={photo.id}
                accessibilityRole="button" accessibilityLabel={t("Xem ảnh {name}, {date}, {time}, {phase}", { name: plant.name, date: historyDate(photo.date), time: photo.time, phase: t(phaseLabels[photo.phase]) })}
                {...focus.props(`photo:${photo.id}`)} onPress={() => setPreview(photo)}
                style={({ pressed }) => [styles.photoCell, pressed && styles.pressed, focus.style(`photo:${photo.id}`)]}>
                <Image source={{ uri: photo.imageUri }} accessible={false} resizeMode="cover" style={styles.thumbnail} />
                <View style={styles.photoCaption}>
                  <Text style={styles.photoDate}>{historyDate(photo.date)}</Text>
                  <Text style={styles.photoMeta}>{photo.time} · {t(phaseLabels[photo.phase])}</Text>
                  <Text style={styles.photoMeta}>{photo.purpose === "reference" ? t("Ảnh tham chiếu") : t("Ảnh kiểm tra")}</Text>
                </View>
              </Pressable>)}
              {photoColumns === 2 && photoPage.records.length % 2 && row === Math.floor(photoPage.records.length / 2) ? <View style={ui.flex} /> : null}
            </View>)}
          </View>
          {!photos.length ? <Text style={styles.empty}>{t("Chưa có ảnh.")}</Text> : null}
          {pagination("photos", photoPage, setPhotoIndex)}
        </>)}
      </View>
      <View style={styles.manage}>
        <JourneyButton title={plant.archived ? t("Khôi phục về vườn") : t("Ẩn cây khỏi vườn")} secondary size="sm" style={styles.manageButton}
          icon={plant.archived ? "arrow-undo-outline" : "archive-outline"}
          onPress={plant.archived ? () => void restore() : archive}
          testID={plant.archived ? "plant-restore" : "plant-archive"} />
      </View>
    </ScrollView>
    <Modal visible={!!preview} animationType="none" presentationStyle="pageSheet" allowSwipeDismissal
      onRequestClose={() => setPreview(null)}>
      <SafeAreaView style={ui.safe}>
        <ScrollView contentContainerStyle={ui.content}>
          <JourneyButton title={t("Đóng ảnh")} secondary icon="close-outline" onPress={() => setPreview(null)} />
          {preview ? <>
            <Text accessibilityRole="header" style={styles.previewTitle}>{plant.name}</Text>
            <Text style={ui.caption}>{historyDate(preview.date)} · {preview.time} · {t(phaseLabels[preview.phase])}</Text>
            <Image source={{ uri: preview.imageUri }} accessibilityLabel={t("Ảnh {name}, {date}", { name: plant.name, date: historyDate(preview.date) })}
              resizeMode="contain" style={styles.previewImage} />
            <Text style={ui.caption}>{preview.purpose === "reference" ? t("Ảnh tham chiếu") : t("Ảnh kiểm tra")}</Text>
          </> : null}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  content: { width: "100%", maxWidth: LAYOUT.contentMaxWidth, alignSelf: "center", paddingTop: SPACING.sm, paddingBottom: SPACING.lg },
  overview: { paddingBottom: SPACING.sm },
  streakRow: { flexDirection: "row", alignItems: "center", gap: SPACING.xs },
  streak: { ...TYPE.body, color: COLORS.primaryDark, fontWeight: "600" },
  overviewMeta: { ...TYPE.caption, marginTop: SPACING.xs },
  sections: { marginTop: SPACING.sm },
  fold: { backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderCurve: "continuous", marginBottom: SPACING.sm },
  foldHeader: { paddingHorizontal: SPACING.compact, paddingVertical: SPACING.sm, flexDirection: "row", alignItems: "center", gap: SPACING.sm, minHeight: LAYOUT.touch, borderRadius: RADIUS.md, borderCurve: "continuous" },
  pressed: { backgroundColor: COLORS.pressed },
  foldTitle: TYPE.label,
  foldSummary: { ...TYPE.caption, marginTop: SPACING.xs },
  foldContent: { paddingHorizontal: SPACING.compact, paddingBottom: SPACING.compact },
  manage: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border, paddingTop: SPACING.compact, marginTop: SPACING.sm },
  manageButton: { marginTop: 0 },
  empty: { ...TYPE.body, color: COLORS.textMuted, paddingVertical: SPACING.sm },
  journalDay: { marginTop: SPACING.sm },
  dayLabel: { ...TYPE.label, color: COLORS.textMuted, marginBottom: SPACING.sm },
  journalEntry: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border, paddingVertical: SPACING.compact, gap: SPACING.xs },
  entryHeading: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: SPACING.sm },
  entryKind: { ...TYPE.label, color: COLORS.success, flexShrink: 1 },
  entryTime: { ...TYPE.caption, color: COLORS.textMuted },
  pagination: { marginTop: SPACING.sm },
  paginationButtons: { flexDirection: "row", flexWrap: "wrap", gap: SPACING.sm },
  photoGrid: { gap: SPACING.sm },
  photoRow: { flexDirection: "row", gap: SPACING.sm },
  photoCell: { flex: 1, minWidth: 0, overflow: "hidden", backgroundColor: COLORS.surfaceSoft, borderRadius: RADIUS.sm, borderCurve: "continuous" },
  thumbnail: { width: "100%", aspectRatio: 1, backgroundColor: COLORS.surfaceAlt },
  photoCaption: { padding: SPACING.sm, gap: SPACING.xs },
  photoDate: TYPE.label,
  photoMeta: TYPE.caption,
  previewTitle: { ...TYPE.title, marginTop: SPACING.page },
  previewImage: { width: "100%", aspectRatio: 1, marginTop: SPACING.md, backgroundColor: COLORS.surfaceSoft, borderRadius: RADIUS.md, borderCurve: "continuous" },
});
