/** Điều khiển luồng quét, nhận diện cây và lưu kết quả kiểm tra chăm sóc từ máy ảnh. */

import { t, useI18n } from "@/i18n";
import Ionicons from "@expo/vector-icons/Ionicons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { File } from "expo-file-system";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ScrollViewInstance,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AiProgress } from "@/components/AiProgress";
import { JourneyButton } from "@/components/journeyUI";
import { useControlFocus } from "@/hooks/useControlFocus";
import { analyzePhoto, recognizePhoto } from "@/services/plantAi";
import { useApp } from "@/store/AppStore";
import type { InspectionResult } from "@/store/journeyActions";
import { COLORS, INTERACTION, LAYOUT, RADIUS, SPACING, TYPE } from "@/theme";
import type { Analysis, Plant, PlantPhase } from "@/types/app";
import { deleteCheckInPhoto, persistCheckInPhoto } from "@/utils/checkInPhotos";
import {
  confirmScanCandidate,
  resolveScanRecognition,
  type RecognitionResult,
} from "@/utils/scanRecognition";

type Stage =
  | "scan"
  | "recognize"
  | "match"
  | "choose"
  | "analyze"
  | "saving"
  | "error";
type Target = { plantId: string; phase: PlantPhase };
type Failure = { message: string; retry: "scan" | "analyze" | "save" };
type Observation = Target & { frame: string; analysis: Analysis };

/** One frame per deliberate scan round; no shutter, video upload or polling Gemini. */
export default function DailyCameraScreen() {
  useI18n();
  const { state, ready, saveInspection, persistNow } = useApp();
  const focus = useControlFocus();
  const [permission, requestPermission] = useCameraPermissions();
  const [focused, setFocused] = useState(false);
  const [foreground, setForeground] = useState(
    AppState.currentState === "active",
  );
  const [cameraReady, setCameraReady] = useState(false);
  const [torch, setTorch] = useState(false);
  const [stage, setStage] = useState<Stage>("scan");
  const [target, setTarget] = useState<Target | null>(null);
  const [recognition, setRecognition] = useState<RecognitionResult | null>(
    null,
  );
  const [phases, setPhases] = useState<Record<string, PlantPhase>>({});
  const [frame, setFrame] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [pendingSave, setPendingSave] = useState(false);
  const [completedPlantId, setCompletedPlantId] = useState<string | null>(null);
  const [progress, setProgress] = useState<"preparing" | "requesting">(
    "preparing",
  );
  const [, refreshAfterJob] = useState(0);
  const latest = useRef(state);
  const camera = useRef<CameraView>(null);
  const content = useRef<ScrollViewInstance>(null);
  const active = useRef(false);
  const appActive = useRef(AppState.currentState === "active");
  const mounted = useRef(true);
  const generation = useRef(0);
  const running = useRef(false);
  const saveRunning = useRef(false);
  const request = useRef<AbortController | null>(null);
  const observation = useRef<Observation | null>(null);
  const committed = useRef<{
    plantId: string;
    result: InspectionResult;
  } | null>(null);
  const navigated = useRef(false);
  const frames = useRef(new Set<string>());
  const plants = state.plants.filter((plant) => !plant.archived);
  const candidates = recognition
    ? resolveScanRecognition(recognition, plants, phases).candidateIds.flatMap(
        (id) => plants.filter((plant) => plant.id === id),
      )
    : [];
  const selected = plants.find((plant) => plant.id === target?.plantId);

  useEffect(() => {
    latest.current = state;
  }, [state]);
  const discardFrames = useCallback(() => {
    // Only URIs returned by THIS Camera instance are registered, never private
    // persisted copies, library originals or arbitrary route parameters.
    for (const uri of frames.current) {
      try {
        const file = new File(uri);
        if (file.exists) file.delete();
      } catch {
        /* These temporary cache files can also be reclaimed by the OS. */
      }
    }
    frames.current.clear();
  }, []);
  const interrupt = useCallback(() => {
    generation.current += 1;
    request.current?.abort();
    request.current = null;
    // Let the in-flight operation settle before another capture/API call.
    if (!running.current) discardFrames();
  }, [discardFrames]);
  const restart = useCallback(
    (next: Target | null = null) => {
      if (committed.current || saveRunning.current) return;
      interrupt();
      observation.current = null;
      setFrame(null);
      setRecognition(null);
      setPhases({});
      setTarget(next);
      setFailure(null);
      setStage("scan");
      content.current?.scrollTo({ y: 0, animated: false });
    },
    [interrupt],
  );

  useFocusEffect(
    useCallback(() => {
      active.current = true;
      setFocused(true);
      setCameraReady(false);
      if (navigated.current) {
        navigated.current = false;
        setCompletedPlantId(null);
      }
      if (committed.current) {
        setPendingSave(true);
        setFailure({
          message: t("Kết quả đang chờ lưu. Thử lưu lại để tiếp tục."),
          retry: "save",
        });
        setStage("error");
      } else if (!saveRunning.current) restart();
      return () => {
        active.current = false;
        setFocused(false);
        setCameraReady(false);
        interrupt();
      };
    }, [interrupt, restart]),
  );
  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener("change", (next) => {
      appActive.current = next === "active";
      setForeground(next === "active");
      if (next !== "active") {
        setCameraReady(false);
        interrupt();
        if (!committed.current && !saveRunning.current) {
          observation.current = null;
          setFrame(null);
          setRecognition(null);
          setFailure(null);
          setStage("scan");
        }
      }
    });
    return () => {
      mounted.current = false;
      subscription.remove();
      interrupt();
    };
  }, [interrupt]);
  useEffect(() => {
    if (focused && foreground && completedPlantId && !navigated.current) {
      navigated.current = true;
      router.replace({
        pathname: "/plant-chat",
        params: { plantId: completedPlantId },
      });
    }
  }, [focused, foreground, completedPlantId]);

  const current = (token: number) =>
    token === generation.current && active.current && appActive.current;
  const fail = (cause: unknown, retry: Failure["retry"], fallback: string) => {
    setFailure({
      message: cause instanceof Error ? t(cause.message) : fallback,
      retry,
    });
    setStage("error");
  };
  const requireTarget = (value: Target) => {
    const plant = latest.current.plants.find(
      (entry) => entry.id === value.plantId && !entry.archived,
    );
    if (!plant || plant.journey.phase !== value.phase)
      throw new Error(t("Hồ sơ cây đã thay đổi. Hãy chọn cây và quét lại."));
    return plant;
  };
  const saveObservation = async (value: Observation, token: number) => {
    let copied: string | null = null;
    saveRunning.current = true;
    setStage("saving");
    try {
      if (!committed.current) {
        requireTarget(value);
        copied = await persistCheckInPhoto(value.frame);
        if (!current(token)) {
          deleteCheckInPhoto(copied);
          return;
        }
        requireTarget(value);
        const result = saveInspection({
          plantId: value.plantId,
          imageUri: copied,
          source: "camera",
          phase: value.phase,
          identityConfirmed: true,
          analysis: value.analysis,
          mode: "gemini",
        });
        committed.current = { plantId: value.plantId, result };
        setPendingSave(true);
      }
      // Retrying a failed SQLite write never re-appends the photo/chat/reward.
      await persistNow();
      const id = committed.current.plantId;
      committed.current = null;
      observation.current = null;
      discardFrames();
      if (mounted.current) {
        setPendingSave(false);
        setCompletedPlantId(id);
      }
    } catch (cause) {
      if (copied && !committed.current) {
        try {
          deleteCheckInPhoto(copied);
        } catch {
          /* Keep the original failure. */
        }
      }
      if (mounted.current)
        fail(
          cause,
          committed.current ? "save" : "analyze",
          t("Chưa lưu được kết quả. Hãy thử lại."),
        );
    } finally {
      saveRunning.current = false;
    }
  };
  const analyzeFrame = async (uri: string, value: Target, token: number) => {
    const plant = requireTarget(value);
    setTarget(value);
    setStage("analyze");
    content.current?.scrollTo({ y: 0, animated: false });
    setProgress("preparing");
    const controller = new AbortController();
    request.current = controller;
    const response = await analyzePhoto(
      uri,
      plant,
      latest.current.plantAnalyses.filter(
        (entry) => entry.plantId === plant.id,
      ),
      latest.current.careEvents.filter((entry) => entry.plantId === plant.id),
      latest.current.plantPhotos.filter((entry) => entry.plantId === plant.id),
      {
        signal: controller.signal,
        onProgress: (next) => {
          if (current(token)) setProgress(next);
        },
      },
    );
    if (!current(token)) return;
    requireTarget(value);
    observation.current = { ...value, frame: uri, analysis: response.analysis };
    await saveObservation(observation.current, token);
  };
  const settle = (token: number) => {
    running.current = false;
    request.current = null;
    if (!current(token)) discardFrames();
    // A render is needed if a new scan was armed while a cancelled job settled.
    if (mounted.current) {
      setProgress("preparing");
      refreshAfterJob((value) => value + 1);
    }
  };
  const beginScan = async () => {
    if (
      !camera.current ||
      !cameraReady ||
      running.current ||
      committed.current ||
      saveRunning.current ||
      !active.current ||
      !appActive.current
    )
      return;
    running.current = true;
    const token = ++generation.current;
    setFailure(null);
    setProgress("preparing");
    try {
      discardFrames();
      // The live preview stays visible. Capture a single oriented frame silently
      // once the user has had time to place the plant inside the scanning frame.
      const picture = await camera.current.takePictureAsync({
        quality: 0.65,
        shutterSound: false,
      });
      frames.current.add(picture.uri);
      if (!current(token)) return;
      setFrame(picture.uri);
      if (target) {
        // User selected an existing plant after a failed match: observe ONLY.
        await analyzeFrame(picture.uri, target, token);
        return;
      }
      const garden = latest.current.plants.filter((plant) => !plant.archived);
      if (!garden.length) {
        setStage("choose");
        return;
      }
      setStage("recognize");
      const snapshot = Object.fromEntries(
        garden.map((plant) => [plant.id, plant.journey.phase]),
      );
      const controller = new AbortController();
      request.current = controller;
      const response = await recognizePhoto(
        picture.uri,
        garden,
        latest.current.plantPhotos,
        {
          signal: controller.signal,
          onProgress: (next) => {
            if (current(token)) setProgress(next);
          },
        },
      );
      if (!current(token)) return;
      const result = resolveScanRecognition(
        response,
        latest.current.plants,
        snapshot,
      );
      setRecognition(result);
      setPhases(snapshot);
      if (result.decision === "candidate" || result.decision === "ambiguous")
        setStage("match");
      else if (result.decision === "unknown") setStage("choose");
      else
        fail(
          new Error(
            result.explanation ||
              t("Chưa quan sát rõ cây. Đưa cây gần hơn và quét lại."),
          ),
          "scan",
          t("Hãy quét lại."),
        );
    } catch (cause) {
      if (current(token))
        fail(
          cause,
          target ? "analyze" : "scan",
          t("Chưa quét được cây. Hãy thử lại."),
        );
    } finally {
      settle(token);
    }
  };
  // Each round runs once. A result, error or candidate waits for a user action;
  // we never keep charging the API while the camera points at the same scene.
  useEffect(() => {
    if (
      !ready ||
      !focused ||
      !foreground ||
      !permission?.granted ||
      !cameraReady ||
      stage !== "scan" ||
      !plants.length ||
      completedPlantId
    )
      return;
    const timer = setTimeout(() => void beginScan(), 1800);
    return () => clearTimeout(timer);
  });

  const confirm = async (id: string) => {
    if (
      !frame ||
      running.current ||
      committed.current ||
      !active.current ||
      !appActive.current
    )
      return;
    const plant = confirmScanCandidate(
      recognition,
      id,
      latest.current.plants,
      phases,
    );
    if (!plant) {
      fail(
        new Error(t("Hồ sơ đối chiếu đã thay đổi. Hãy quét lại.")),
        "scan",
        t("Hãy quét lại."),
      );
      return;
    }
    running.current = true;
    const token = ++generation.current;
    try {
      await analyzeFrame(
        frame,
        { plantId: plant.id, phase: plant.journey.phase },
        token,
      );
    } catch (cause) {
      if (current(token))
        fail(cause, "analyze", t("Chưa phân tích được cây. Hãy thử lại."));
    } finally {
      settle(token);
    }
  };
  const retry = async () => {
    if (
      running.current ||
      saveRunning.current ||
      !active.current ||
      !appActive.current
    )
      return;
    if (failure?.retry === "save" && committed.current && observation.current) {
      running.current = true;
      const token = ++generation.current;
      try {
        await saveObservation(observation.current, token);
      } finally {
        settle(token);
      }
    } else if (failure?.retry === "analyze" && target && frame) {
      running.current = true;
      const token = ++generation.current;
      setFailure(null);
      try {
        if (observation.current)
          await saveObservation(observation.current, token);
        else await analyzeFrame(frame, target, token);
      } catch (cause) {
        if (current(token)) fail(cause, "analyze", t("Chưa phân tích được cây."));
      } finally {
        settle(token);
      }
    } else restart(target);
  };
  const select = (plant: Plant) =>
    restart({ plantId: plant.id, phase: plant.journey.phase });
  const chooseExisting = () => {
    if (saveRunning.current || committed.current) return;
    interrupt();
    observation.current = null;
    setFailure(null);
    setStage("choose");
  };
  const cancel = () => {
    interrupt();
    setFailure({
      message: t("Đã dừng quét. Bạn có thể quét lại khi sẵn sàng."),
      retry: "scan",
    });
    setStage("error");
  };
  const close = () => {
    if (saveRunning.current) return;
    interrupt();
    router.navigate("/(tabs)/garden");
  };
  const allowCamera = async () => {
    try {
      if (permission?.canAskAgain === false) await Linking.openSettings();
      else await requestPermission();
    } catch {
      fail(
        new Error(
          t("Chưa mở được máy ảnh. Kiểm tra quyền máy ảnh trong Cài đặt thiết bị."),
        ),
        "scan",
        t("Chưa mở được máy ảnh."),
      );
    }
  };
  const processing = stage === "recognize" || stage === "analyze";
  return (
    <View style={styles.safe}>
      {focused ? <StatusBar style="light" /> : null}
      {focused && foreground && permission?.granted && plants.length ? (
        <CameraView
          ref={camera}
          style={StyleSheet.absoluteFill}
          facing="back"
          mode="picture"
          autofocus="on"
          animateShutter={false}
          enableTorch={torch}
          onCameraReady={() => setCameraReady(true)}
          onMountError={() => {
            setCameraReady(false);
            fail(
              new Error(
                t("Máy ảnh chưa khởi động được. Hãy đóng và mở lại màn quét."),
              ),
              "scan",
              t("Chưa mở được máy ảnh."),
            );
          }}
        />
      ) : null}
      <LinearGradient
        pointerEvents="none"
        colors={[
          COLORS.scannerOverlay,
          COLORS.transparent,
          COLORS.scannerBackground,
        ]}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={styles.flex}>
        <View style={styles.header}>
          <Pressable
            {...focus.props("close")}
            accessibilityRole="button"
            accessibilityLabel={t("Đóng quét cây, về vườn")}
            disabled={stage === "saving"}
            accessibilityState={{ disabled: stage === "saving" }}
            onPress={close}
            style={({ pressed }) => [
              styles.iconButton,
              pressed && styles.pressed,
              focus.style("close", true),
            ]}
          >
            <Ionicons name="close" color={COLORS.white} size={LAYOUT.icon} />
          </Pressable>
          <Text style={styles.headerTitle}>{t("Quét chăm cây")}</Text>
          <Pressable
            {...focus.props("torch")}
            accessibilityRole="button"
            accessibilityLabel={torch ? t("Tắt đèn") : t("Bật đèn")}
            accessibilityState={{ selected: torch, disabled: !cameraReady }}
            disabled={!cameraReady}
            onPress={() => setTorch(!torch)}
            style={({ pressed }) => [
              styles.iconButton,
              pressed && styles.pressed,
              focus.style("torch", true),
            ]}
          >
            <Ionicons
              name={torch ? "flash" : "flash-outline"}
              color={COLORS.white}
              size={LAYOUT.icon}
            />
          </Pressable>
        </View>
        <ScrollView
          ref={content}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.frameArea} pointerEvents="none">
            <View style={styles.frame}>
              <View style={[styles.corner, styles.topLeft]} />
              <View style={[styles.corner, styles.topRight]} />
              <View style={[styles.corner, styles.bottomLeft]} />
              <View style={[styles.corner, styles.bottomRight]} />
              {(stage === "scan" ||
                stage === "recognize" ||
                stage === "analyze") &&
              permission?.granted &&
              plants.length ? (
                <View style={styles.scanPill}>
                  <ActivityIndicator color={COLORS.scannerFrame} size="small" />
                  <Text style={styles.scanText}>
                    {processing ? t("Đang quan sát…") : t("Giữ cây trong khung")}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
          <View style={styles.panel}>
            {!ready || !permission ? (
              <ActivityIndicator color={COLORS.primary} />
            ) : !plants.length ? (
              <>
                <Text style={styles.title}>{t("Vườn chưa có cây để kiểm tra")}</Text>
                <Text style={styles.body}>
                  {t("Về Khu vườn để chuẩn bị hồ sơ cây của bạn.")}</Text>
                <JourneyButton title={t("Về khu vườn")} onPress={close} />
              </>
            ) : !permission.granted ? (
              <>
                <Text style={styles.title}>{t("Mở máy ảnh để chăm cây")}</Text>
                <Text style={styles.body}>
                  {t("Cho phép máy ảnh, đưa cây vào khung. PAT sẽ tự nhận diện và kiểm tra tình trạng.")}</Text>
                <JourneyButton
                  title={
                    permission.canAskAgain === false
                      ? t("Mở cài đặt máy ảnh")
                      : t("Cho phép máy ảnh")
                  }
                  onPress={() => void allowCamera()}
                />
                {failure ? (
                  <Text accessibilityRole="alert" style={styles.error}>
                    {failure.message}
                  </Text>
                ) : null}
              </>
            ) : stage === "scan" ? (
              <>
                <Text accessibilityLiveRegion="polite" style={styles.title}>
                  {selected
                    ? t("Kiểm tra {name}", { name: selected.name })
                    : t("Đưa cây vào khung quét")}
                </Text>
                <Text style={styles.body}>
                  {selected
                    ? t("Giữ cây bạn đã chọn trong khung. Trợ lý thông minh sẽ quan sát tình trạng và hướng chăm sóc.")
                    : t("Giữ máy khoảng 2 giây. PAT tự tìm cây trong vườn của bạn.")}
                </Text>
                <Text style={styles.caption}>
                  {t("Một khung hình sẽ được gửi đến trợ lý thông minh để kiểm tra.")}</Text>
                {selected ? (
                  <JourneyButton
                    title={t("Chọn cây khác")}
                    variant="ghost"
                    onPress={chooseExisting}
                  />
                ) : null}
              </>
            ) : processing ? (
              <>
                <Text style={styles.title}>
                  {stage === "recognize"
                    ? t("Đang nhận diện cây trong vườn")
                    : t("Đang kiểm tra {name}", { name: selected?.name ?? t("cây") })}
                </Text>
                <AiProgress
                  message={
                    progress === "preparing"
                      ? t("Đang chuẩn bị khung hình…")
                      : stage === "recognize"
                        ? t("Đang đối chiếu với khu vườn…")
                        : t("Đang xem tình trạng và hướng chăm sóc…")
                  }
                  onCancel={cancel}
                />
              </>
            ) : stage === "saving" ? (
              <>
                <ActivityIndicator color={COLORS.primary} />
                <Text style={styles.title}>{t("Đang lưu vào nhật ký của cây…")}</Text>
              </>
            ) : stage === "match" ? (
              <>
                <Text accessibilityLiveRegion="polite" style={styles.title}>
                  {candidates.length === 1
                    ? t("Có phải {name}?", { name: candidates[0].name })
                    : t("Bạn đang quan sát cây nào?")}
                </Text>
                <Text style={styles.body}>
                  {candidates.length
                    ? t("Xác nhận đúng cây để nhận tình trạng và hướng chăm sóc trong cuộc trò chuyện.")
                    : t("Hồ sơ cây đã thay đổi. Hãy quét lại.")}
                </Text>
                {candidates.map((plant) => (
                  <JourneyButton
                    key={plant.id}
                    title={t("Đúng, {name}", { name: plant.name })}
                    onPress={() => void confirm(plant.id)}
                  />
                ))}
                <JourneyButton
                  title={t("Chọn cây trong vườn")}
                  secondary
                  onPress={chooseExisting}
                />
                <JourneyButton
                  title={t("Quét lại")}
                  variant="ghost"
                  onPress={() => restart()}
                />
              </>
            ) : stage === "choose" ? (
              <>
                <Text accessibilityLiveRegion="polite" style={styles.title}>
                  {recognition?.decision === "unknown"
                    ? t("Chưa nhận ra cây trong vườn")
                    : t("Chọn cây bạn muốn kiểm tra")}
                </Text>
                <Text style={styles.body}>
                  {t("Chọn đúng cây bên dưới rồi đưa cây đó vào khung một lần nữa. Lần quét tiếp theo chỉ kiểm tra tình trạng.")}</Text>
                {plants.map((plant) => {
                  const photo = state.plantPhotos.find(
                    (entry) => entry.plantId === plant.id,
                  );
                  return (
                    <Pressable
                      key={plant.id}
                      {...focus.props(plant.id)}
                      accessibilityRole="button"
                      accessibilityLabel={t("Quét kiểm tra {name}, {species}", { name: plant.name, species: plant.species })}
                      onPress={() => select(plant)}
                      style={({ pressed }) => [
                        styles.plantRow,
                        pressed && styles.rowPressed,
                        focus.style(plant.id),
                      ]}
                    >
                      {photo ? (
                        <Image
                          source={{ uri: photo.imageUri }}
                          style={styles.thumbnail}
                        />
                      ) : (
                        <Ionicons
                          name="leaf-outline"
                          size={LAYOUT.icon}
                          color={COLORS.primary}
                        />
                      )}
                      <View style={styles.rowBody}>
                        <Text style={styles.rowTitle}>{plant.name}</Text>
                        <Text style={styles.caption}>{plant.species}</Text>
                      </View>
                      <Ionicons
                        name="scan-outline"
                        size={LAYOUT.smallIcon}
                        color={COLORS.primary}
                      />
                    </Pressable>
                  );
                })}
                <JourneyButton
                  title={t("Nhận diện lại")}
                  variant="ghost"
                  onPress={() => restart()}
                />
              </>
            ) : (
              <>
                <Text style={styles.title}>
                  {pendingSave
                    ? t("Kết quả đang chờ lưu")
                    : t("Chưa hoàn tất lần quét")}
                </Text>
                <Text accessibilityRole="alert" style={styles.error}>
                  {failure?.message ?? t("Bạn có thể quét lại khi sẵn sàng.")}
                </Text>
                <JourneyButton
                  title={
                    pendingSave
                      ? t("Thử lưu lại")
                      : failure?.retry === "analyze"
                        ? t("Thử kiểm tra lại")
                        : t("Quét lại")
                  }
                  onPress={() => void retry()}
                />
                {!pendingSave ? (
                  <JourneyButton
                    title={t("Chọn cây trong vườn")}
                    secondary
                    onPress={chooseExisting}
                  />
                ) : null}
              </>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.scannerBackground },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
  },
  iconButton: {
    minWidth: LAYOUT.touch,
    minHeight: LAYOUT.touch,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.scannerOverlay,
  },
  headerTitle: { ...TYPE.headline, color: COLORS.white, flex: 1 },
  pressed: { opacity: INTERACTION.primaryPressedOpacity },
  content: {
    flexGrow: 1,
    width: "100%",
    maxWidth: LAYOUT.formMaxWidth,
    alignSelf: "center",
    padding: SPACING.page,
    gap: SPACING.lg,
    paddingBottom: SPACING.lg,
  },
  frameArea: {
    flexGrow: 1,
    minHeight: LAYOUT.artwork + SPACING.xxl,
    alignItems: "center",
    justifyContent: "center",
  },
  frame: {
    width: "88%",
    maxWidth: LAYOUT.artwork * 3,
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "flex-end",
    padding: SPACING.md,
  },
  // Optical corner geometry belongs to this scanning view, not the spacing scale.
  corner: {
    position: "absolute",
    width: SPACING.xl,
    height: SPACING.xl,
    borderColor: COLORS.scannerFrame,
  },
  topLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderTopLeftRadius: RADIUS.md,
  },
  topRight: {
    top: 0,
    right: 0,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderTopRightRadius: RADIUS.md,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderBottomLeftRadius: RADIUS.md,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderBottomRightRadius: RADIUS.md,
  },
  scanPill: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.sm,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.scannerOverlay,
    padding: SPACING.compact,
  },
  scanText: { ...TYPE.caption, color: COLORS.scannerFrame },
  panel: {
    backgroundColor: COLORS.surface,
    padding: SPACING.page,
    borderRadius: RADIUS.lg,
    borderCurve: "continuous",
    gap: SPACING.sm,
  },
  title: { ...TYPE.headline },
  body: { ...TYPE.subhead },
  caption: { ...TYPE.caption },
  error: { ...TYPE.subhead, color: COLORS.danger },
  plantRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.compact,
    minHeight: LAYOUT.touch,
    padding: SPACING.compact,
    borderRadius: RADIUS.md,
    borderCurve: "continuous",
    backgroundColor: COLORS.surfaceSoft,
  },
  rowPressed: { backgroundColor: COLORS.pressed },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { ...TYPE.label },
  thumbnail: {
    width: LAYOUT.touch,
    height: LAYOUT.touch,
    borderRadius: RADIUS.sm,
  },
});
