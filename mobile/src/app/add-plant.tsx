/** Hiển thị biểu mẫu thêm cây, chọn ảnh và nhận diện thông tin trước khi lưu cây vào vườn. */

import { t, useI18n } from "@/i18n";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AiProgress } from "@/components/AiProgress";
import {
  JourneyButton,
  JourneyCard,
  JourneyChoices,
  JourneyDisclosure,
  JourneyField,
  JourneyHeader,
  cropEmoji,
  phaseLabels,
  selectJourneyPhoto,
  ui,
} from "@/components/journeyUI";
import { cropGuide, identifyPhoto, isAiConfigured } from "@/services/plantAi";
import { useApp } from "@/store/AppStore";
import { COLORS, GRADIENTS, LAYOUT, RADIUS, SPACING, TYPE } from "@/theme";
import type { CaptureSource, CropKind, PlantPhase } from "@/types/app";
import { deleteCheckInPhoto, persistCheckInPhoto } from "@/utils/checkInPhotos";
import { identifiedPlantDraft, starterCrop } from "@/utils/plantDraft";

type Busy = "photo" | "identify" | "save" | null;

export default function AddPlantScreen() {
  useI18n();
  const { createJourney, persistNow } = useApp();
  const { width, fontScale } = useWindowDimensions();
  const stackPhotoControls = width < 360 || fontScale >= 1.3;
  const [photo, setPhoto] = useState<string | null>(null);
  const [source, setSource] = useState<CaptureSource>("library");
  const [crop, setCrop] = useState<CropKind>("other");
  const [name, setName] = useState("");
  const [species, setSpecies] = useState("");
  const [phase, setPhase] = useState<PlantPhase>("planning");
  const [method, setMethod] = useState<"seed" | "seedling">("seed");
  const [location, setLocation] = useState("");
  const [light, setLight] = useState("");
  const [notes, setNotes] = useState("");
  const [identified, setIdentified] = useState<Awaited<
    ReturnType<typeof identifyPhoto>
  > | null>(null);
  const [manual, setManual] = useState(true);
  const [busy, setBusyState] = useState<Busy>(null);
  const [progress, setProgress] = useState<"preparing" | "requesting">(
    "preparing",
  );
  const [error, setError] = useState("");
  const [createdId, setCreatedId] = useState<string | null>(null);
  const generation = useRef(0);
  const operation = useRef<Busy>(null);
  const createdPlant = useRef<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const setBusy = (value: Busy) => {
    operation.current = value;
    setBusyState(value);
  };

  useFocusEffect(
    useCallback(() => {
      setBusyState(null);
      operation.current = null;
      return () => {
        generation.current += 1;
        request.current?.abort();
      };
    }, []),
  );

  const cancelIdentify = () => {
    generation.current += 1;
    request.current?.abort();
    request.current = null;
    setBusy(null);
  };
  const choosePhoto = async (nextSource: CaptureSource) => {
    if (operation.current) return;
    const token = ++generation.current;
    setBusy("photo");
    try {
      const uri = await selectJourneyPhoto(nextSource);
      if (!uri || token !== generation.current) return;
      setPhoto(uri);
      setSource(nextSource);
      setIdentified(null);
      setManual(true);
      setError("");
    } catch {
      if (token === generation.current)
        setError(t("Không mở được ảnh. Hãy thử lại."));
    } finally {
      if (token === generation.current) setBusy(null);
    }
  };
  const identify = async () => {
    if (!photo || operation.current) return;
    const token = ++generation.current;
    const controller = new AbortController();
    request.current = controller;
    setBusy("identify");
    setProgress("preparing");
    setError("");
    try {
      const result = await identifyPhoto(photo, {
        signal: controller.signal,
        onProgress: (stage) => {
          if (token === generation.current) setProgress(stage);
        },
      });
      if (token !== generation.current) return;
      const draft = identifiedPlantDraft(result);
      setIdentified(result);
      setCrop(draft.crop);
      setSpecies(draft.species);
      setPhase(draft.phase);
      setMethod(draft.method);
      setManual(false);
      if (!name.trim()) setName(draft.name);
    } catch (cause) {
      if (token === generation.current)
        setError(
          cause instanceof Error
            ? t(cause.message)
            : t("Chưa nhận diện được ảnh. Bạn có thể nhập thủ công."),
        );
    } finally {
      if (token === generation.current) {
        request.current = null;
        setBusy(null);
      }
    }
  };
  const save = async () => {
    if (operation.current) return;
    if (
      !createdPlant.current &&
      (name.trim().length < 2 || species.trim().length < 2)
    ) {
      setError(t("Nhập tên riêng và loài cây, mỗi mục ít nhất 2 ký tự."));
      return;
    }
    if (!createdPlant.current && !identified && !manual) return;
    const token = ++generation.current;
    setBusy("save");
    setError("");
    let savedPhoto: string | undefined;
    let committed = !!createdPlant.current;
    try {
      if (!createdPlant.current) {
        if (photo) savedPhoto = await persistCheckInPhoto(photo);
        if (token !== generation.current) {
          if (savedPhoto) deleteCheckInPhoto(savedPhoto);
          return;
        }
        const mode =
          identified && !manual ? ("gemini" as const) : ("demo" as const);
        const guide = mode === "gemini" ? identified!.guide : cropGuide(crop);
        const plant = createJourney({
          name: name.trim(),
          species: species.trim(),
          emoji: cropEmoji[crop],
          journey: {
            crop,
            phase,
            method,
            startedAt: new Date().toISOString(),
            location: location.trim(),
            light: light.trim(),
            notes: notes.trim(),
          },
          photo: savedPhoto ? { imageUri: savedPhoto, source } : undefined,
          mode,
          assistantMessage: `${mode === "gemini" ? t("Gợi ý từ Gemini — hồ sơ do bạn xác nhận.") : t("Hồ sơ nhập thủ công. Hướng dẫn mẫu dưới đây chưa dựa trên phân tích ảnh.")}\n\n${guide.join("\n\n")}\n\n${t("Bổ sung ảnh khi cây chuyển giai đoạn để theo dõi đúng hồ sơ.")}`,
        });
        committed = true;
        createdPlant.current = plant.id;
        setCreatedId(plant.id);
      }
      await persistNow();
      if (token === generation.current) router.replace("/(tabs)/garden");
    } catch (cause) {
      if (savedPhoto && !committed) {
        try {
          deleteCheckInPhoto(savedPhoto);
        } catch {
          /* Keep the original save error. */
        }
      }
      if (token === generation.current)
        setError(
          committed
            ? t("Hồ sơ đã tạo nhưng chưa lưu được xuống máy. Thử lưu lại; không cần thêm cây lần nữa.")
            : cause instanceof Error
              ? t(cause.message)
              : t("Chưa lưu được hồ sơ."),
        );
    } finally {
      if (token === generation.current) setBusy(null);
    }
  };

  if (createdId)
    return (
      <SafeAreaView style={ui.safe}>
        <JourneyHeader title={t("Lưu cây mới")} />
        <View style={ui.content}>
          <Text style={ui.text}>
            {error || t("Đang lưu hồ sơ và ảnh trên thiết bị…")}
          </Text>
          <JourneyButton
            title={t("Thử lưu lại")}
            loading={busy === "save"}
            onPress={() => void save()}
          />
        </View>
      </SafeAreaView>
    );

  return (
    <SafeAreaView style={ui.safe}>
      <JourneyHeader
        title={t("Thêm cây")}
        subtitle={t("Từ quả, hạt hoặc cây bạn đang trồng")}
      />
      <KeyboardAvoidingView
        style={ui.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={ui.content}
          keyboardShouldPersistTaps="handled"
        >
          <JourneyCard style={styles.photoSection}>
            <Text style={styles.stepLabel}>{t("01 · LÀM QUEN")}</Text>
            {photo ? (
              <Image
                source={{ uri: photo }}
                accessibilityLabel={t("Ảnh cây mới")}
                style={styles.photo}
              />
            ) : (
              <View style={[styles.photoPlaceholder, stackPhotoControls && styles.stacked]}>
                <Ionicons
                  name="camera-outline"
                  size={LAYOUT.touch}
                  color={COLORS.primary}
                />
                <Text style={styles.photoTitle}>{t("Ảnh cây")}</Text>
              </View>
            )}
            <View style={[styles.row, stackPhotoControls && styles.stacked]}>
              <View style={!stackPhotoControls && ui.flex}>
                <JourneyButton
                  title={t("Chụp ảnh")}
                  icon="camera-outline"
                  secondary
                  disabled={!!busy}
                  onPress={() => void choosePhoto("camera")}
                />
              </View>
              <View style={!stackPhotoControls && ui.flex}>
                <JourneyButton
                  title={t("Thư viện")}
                  icon="images-outline"
                  secondary
                  disabled={!!busy}
                  onPress={() => void choosePhoto("library")}
                />
              </View>
            </View>
            {busy === "identify" ? (
              <AiProgress
                message={
                  progress === "preparing"
                    ? t("Đang chuẩn bị ảnh…")
                    : t("Đang chờ trợ lý nhận diện…")
                }
                onCancel={cancelIdentify}
              />
            ) : photo ? (
              <JourneyButton
                title={identified ? t("Nhận diện lại") : t("Nhờ trợ lý nhận diện")}
                disabled={!!busy || !isAiConfigured()}
                onPress={() => void identify()}
                testID="identify-new-plant"
              />
            ) : null}
            {photo && !identified ? (
              <Text style={ui.caption}>
                {isAiConfigured()
                  ? t("Ảnh được gửi đến Gemini để nhận diện. Kết quả có thể nhầm.")
                  : t("Chưa kết nối trợ lý. Bạn vẫn có thể nhập thông tin cây.")}
              </Text>
            ) : null}
          </JourneyCard>
            <JourneyCard>
              <Text style={styles.stepLabel}>{t("02 · HỒ SƠ CỦA CÂY")}</Text>
              <Text style={ui.subtitle}>
                {identified && !manual ? identified.label : t("Hồ sơ cây mới")}
              </Text>
              <Text style={ui.caption}>
                {identified && !manual
                  ? identified.summary
                  : t("Thông tin do bạn nhập hoặc chỉnh sửa; hướng dẫn bên dưới là mẫu.")}
              </Text>
              <View pointerEvents={busy ? "none" : "auto"}>
                <JourneyField
                  label={t("Tên riêng")}
                  value={name}
                  onChangeText={setName}
                  disabled={!!busy}
                  placeholder={t("Ví dụ: Cây bên cửa sổ")}
                />
                <JourneyField
                  label={t("Loài cây")}
                  value={species}
                  disabled={!!busy}
                  placeholder={t("Khế, ổi, hoa hồng…")}
                  onChangeText={(value) => {
                    setSpecies(value);
                    setCrop(starterCrop(value));
                    setManual(true);
                  }}
                />
                <JourneyChoices
                  label={t("Giai đoạn hiện tại")}
                  values={phaseLabels}
                  selected={phase}
                  onSelect={(value) => {
                    setPhase(value);
                    setMethod(
                      value === "planning" || value === "germinating"
                        ? "seed"
                        : "seedling",
                    );
                    if (identified && value !== identified.phase)
                      setManual(true);
                  }}
                />
                {phase === "planning" ? (
                  <Text style={ui.caption}>
                    {t("Vẫn xuất hiện trong Vườn, chưa tính vào lượt kiểm tra hằng ngày.")}</Text>
                ) : null}
                <JourneyDisclosure title={t("Thông tin thêm")}>
                  <JourneyChoices
                    label={t("Cách trồng")}
                    values={{ seed: t("Từ hạt"), seedling: t("Cây giống") }}
                    selected={method}
                    onSelect={setMethod}
                  />
                  <JourneyField
                    label={t("Vị trí")}
                    value={location}
                    onChangeText={setLocation}
                    disabled={!!busy}
                    placeholder={t("Ban công, sân, trong nhà…")}
                  />
                  <JourneyField
                    label={t("Ánh sáng")}
                    value={light}
                    onChangeText={setLight}
                    disabled={!!busy}
                    placeholder={t("Nắng sáng, sáng gián tiếp…")}
                  />
                  <JourneyField
                    label={t("Ghi chú")}
                    value={notes}
                    onChangeText={setNotes}
                    disabled={!!busy}
                    multiline
                  />
                </JourneyDisclosure>
                <JourneyDisclosure title={t("Gợi ý bắt đầu")}>
                  {(identified && !manual
                    ? identified.guide
                    : cropGuide(crop)
                  ).map((step, index) => (
                    <Text key={index} style={ui.caption}>
                      {index + 1}. {step}
                    </Text>
                  ))}
                  {identified && !manual
                    ? identified.warnings.map((warning, index) => (
                        <Text key={index} style={ui.caption}>
                          {warning}
                        </Text>
                      ))
                    : null}
                  <Text style={ui.caption}>
                    {t("Ảnh ban đầu là ảnh tham chiếu, không cộng chuỗi chăm sóc. Hồ sơ có trợ lý riêng để bạn hỏi thêm.")}</Text>
                </JourneyDisclosure>
              </View>
              <JourneyButton
                title={t("Thêm vào vườn")}
                icon="add-outline"
                loading={busy === "save"}
                disabled={!!busy}
                onPress={() => void save()}
                testID="create-journey"
              />
            </JourneyCard>
          {error ? (
            <Text accessibilityRole="alert" style={ui.error}>
              {error}
            </Text>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: SPACING.compact },
  stacked: { flexDirection: "column" },
  photoSection: { backgroundColor: COLORS.surfaceSoft, ...GRADIENTS.garden },
  stepLabel: {
    ...TYPE.overline,
    color: COLORS.primary,
    marginBottom: SPACING.md,
  },
  // Photo composition height is independent of text size and remains scrollable.
  photo: {
    height: 224,
    width: "100%",
    borderRadius: RADIUS.lg,
    resizeMode: "cover",
  },
  photoPlaceholder: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: SPACING.compact,
    gap: SPACING.sm,
  },
  photoTitle: {
    ...TYPE.headline,
    textAlign: "center",
    flexShrink: 1,
  },
});
