/** Hiển thị hội thoại với trợ lý chăm cây, gửi câu hỏi và ghi nhận việc chăm sóc hằng ngày. */

import { t, useI18n } from "@/i18n";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useRef, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AiProgress } from "@/components/AiProgress";
import {
  JourneyButton,
  JourneyDisclosure,
  JourneyHeader,
  phaseLabels,
  ui,
} from "@/components/journeyUI";
import {
  AiServiceError,
  chatWithPlant,
  createDemoChatReply,
  isAiConfigured,
} from "@/services/plantAi";
import { CHAT_CONTEXT_LIMITS } from "@/services/plantAiContracts";
import { useApp } from "@/store/AppStore";
import { useControlFocus } from "@/hooks/useControlFocus";
import { DailyCareComposer } from "@/screens/plant-chat/DailyCareComposer";
import { COLORS, GRADIENTS, INPUT, LAYOUT, RADIUS, SPACING, TYPE } from "@/theme";
import type { PlantChatMessage } from "@/types/app";

export default function PlantChatScreen() {
  const { plantId } = useLocalSearchParams<{ plantId: string }>();
  return <PlantChatSession key={plantId} plantId={plantId} />;
}

function PlantChatSession({ plantId }: { plantId?: string }) {
  useI18n();
  const focus = useControlFocus();
  const { state, appendChatMessage } = useApp();
  const plant = state.plants.find((entry) => entry.id === plantId);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<"preparing" | "requesting">("preparing");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<{
    text: string;
    history: PlantChatMessage[];
  } | null>(null);
  const generation = useRef(0);
  const sending = useRef(false);
  const scroll = useRef<ScrollViewInstance>(null);
  const aiRequest = useRef<AbortController | null>(null);
  useFocusEffect(
    useCallback(() => {
      setBusy(false);
      sending.current = false;
      return () => {
        generation.current += 1;
        aiRequest.current?.abort();
      };
    }, [setBusy]),
  );
  if (!plant)
    return (
      <SafeAreaView style={ui.safe}>
        <JourneyHeader title={t("Không tìm thấy cây")} />
      </SafeAreaView>
    );
  const messages = state.chatMessages.filter(
    (message) => message.plantId === plant.id,
  );
  const send = async (demo = false, retry = false) => {
    if (sending.current || plant.archived) return;
    const question = retry && pending ? pending.text : text.trim();
    if (!question) return;
    const history = retry && pending ? pending.history : messages;
    setBusy(true);
    setProgress("preparing");
    setError("");
    sending.current = true;
    const token = ++generation.current;
    const controller = new AbortController();
    aiRequest.current = controller;
    try {
      if (!retry) {
        setPending(null);
        appendChatMessage({
          plantId: plant.id,
          role: "user",
          content: question,
          mode: demo ? "demo" : "gemini",
        });
        setText("");
      }
      setPending({ text: question, history });
      const content = demo
        ? createDemoChatReply(plant)
        : (
            await chatWithPlant(
              plant,
              state.plantPhotos.filter((photo) => photo.plantId === plant.id),
              state.plantAnalyses.filter(
                (analysis) => analysis.plantId === plant.id,
              ),
              state.careEvents.filter((event) => event.plantId === plant.id),
              history,
              question,
              {
                signal: controller.signal,
                onProgress: (stage) => {
                  if (token === generation.current) setProgress(stage);
                },
              },
            )
          ).content;
      if (token !== generation.current) return;
      appendChatMessage({
        plantId: plant.id,
        role: "assistant",
        content,
        mode: demo ? "demo" : "gemini",
      });
      setPending(null);
    } catch (cause) {
      if (token === generation.current)
        setError(
          cause instanceof AiServiceError
            ? `${t(cause.message)}\n${t("Mã lỗi: {code}", { code: cause.code })}`
            : cause instanceof Error ? t(cause.message) : t("Chưa thể kết nối trợ lý."),
        );
    } finally {
      if (token === generation.current) {
        setBusy(false);
        sending.current = false;
        aiRequest.current = null;
      }
    }
  };

  return (
    <SafeAreaView style={ui.safe}>
      <JourneyHeader
        title={t("Trợ lý của {name}", { name: plant.name })}
        subtitle={`${plant.species} · ${t(phaseLabels[plant.journey.phase])}`}
      />
      <KeyboardAvoidingView
        style={ui.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          ref={scroll}
          style={ui.flex}
          contentContainerStyle={styles.messages}
          onLayout={() => scroll.current?.scrollToEnd({ animated: false })}
          onContentSizeChange={() =>
            scroll.current?.scrollToEnd({ animated: true })
          }
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        >
          <JourneyDisclosure title={t("Trợ lý biết gì về cây này?")}>
            <Text style={ui.caption}>
              {t("Khi gửi câu hỏi, PAT chuyển hồ sơ của {name}, tối đa {photos} ảnh gần nhất đúng giai đoạn, {analyses} bản phân tích, {events} việc chăm sóc và {messages} tin nhắn gần nhất đến Gemini. Trợ lý không tự đọc toàn bộ thư viện ảnh. Ảnh không đọc được sẽ được bỏ qua và ghi rõ trong câu trả lời. Gợi ý chỉ để tham khảo; bạn vẫn cần quan sát cây thực tế.", {
                name: plant.name,
                photos: CHAT_CONTEXT_LIMITS.photos,
                analyses: CHAT_CONTEXT_LIMITS.analyses,
                events: CHAT_CONTEXT_LIMITS.careEvents,
                messages: CHAT_CONTEXT_LIMITS.messages,
              })}
            </Text>
          </JourneyDisclosure>
          {!messages.length ? (
            <Text style={ui.caption}>
              {t("Bạn có thể hỏi: “Tôi cần chuẩn bị gì để bắt đầu trồng?” hoặc “Với ánh sáng hiện tại, tôi nên kiểm tra gì?”")}</Text>
          ) : null}
          {messages.map((message) => {
            const photo = message.photoId
              ? state.plantPhotos.find(
                  (entry) =>
                    entry.id === message.photoId && entry.plantId === plant.id,
                )
              : undefined;
            return (
              <View
                key={message.id}
                style={[
                  styles.bubble,
                  photo && styles.photoBubble,
                  message.role === "user" ? styles.user : styles.assistant,
                ]}
              >
                <Text
                  style={[
                    styles.author,
                    message.role === "user" && { color: COLORS.onActionMuted },
                  ]}
                >
                  {message.role === "user"
                    ? t("Bạn")
                    : message.mode === "gemini"
                      ? t("Trợ lý · tham khảo")
                      : t("Hướng dẫn mẫu")}
                </Text>
                {photo ? (
                  <View style={styles.attachment}>
                    <Image
                      source={{ uri: photo.imageUri }}
                      accessible
                      accessibilityLabel={t("Ảnh của {name} được lưu lúc {time}, ngày {date}", { name: plant.name, time: photo.time, date: photo.date })}
                      style={styles.photo}
                      resizeMode="contain"
                      resizeMethod="resize"
                    />
                    <Text style={ui.caption}>
                      {t("Ảnh quan sát · {date} · {time}", { date: photo.date, time: photo.time })}
                    </Text>
                  </View>
                ) : null}
                <Text
                  selectable
                  style={[
                    ui.text,
                    message.role === "user" && { color: COLORS.onAction },
                  ]}
                >
                  {message.content}
                </Text>
              </View>
            );
          })}
          {busy ? (
            <AiProgress
              message={progress === "preparing"
                ? t("Đang chuẩn bị nhật ký và ảnh của cây…")
                : t("Đã gửi yêu cầu · Đang chờ Gemini trả lời…")}
              onCancel={() => {
                generation.current += 1;
                aiRequest.current?.abort();
                aiRequest.current = null;
                setBusy(false);
                sending.current = false;
                setError(t("Đã hủy yêu cầu. Bạn có thể gửi lại."));
              }}
            />
          ) : null}
          {!busy && (error || pending) ? (
            <View style={styles.context}>
              <Text accessibilityRole="alert" style={ui.error}>
                {error ||
                  t("Yêu cầu trước chưa có câu trả lời. Bạn có thể thử gửi lại.")}
              </Text>
              <JourneyButton
                title={t("Thử gửi lại cho Gemini")}
                secondary
                onPress={() => void send(false, true)}
              />
              <JourneyButton
                title={t("Xem hướng dẫn mẫu")}
                secondary
                onPress={() => void send(true, true)}
              />
            </View>
          ) : null}
        </ScrollView>
        {!plant.archived ? (
          <View style={styles.composer}>
            <DailyCareComposer plantId={plant.id} disabled={busy} />
            <TextInput
              {...focus.props("composer")}
              accessibilityLabel={t("Câu hỏi cho trợ lý của cây")}
              value={text}
              onChangeText={setText}
              multiline
              maxLength={2000}
              placeholder={t("Hỏi về cây này…")}
              underlineColorAndroid={COLORS.transparent}
              placeholderTextColor={COLORS.textMuted}
              style={[styles.input, focus.style("composer")]}
              editable={!busy}
            />
            <JourneyButton
              title={isAiConfigured() ? t("Gửi") : t("Xem hướng dẫn mẫu")}
              icon="send-outline"
              disabled={!text.trim()}
              loading={busy}
              onPress={() => void send(!isAiConfigured())}
              testID="send-plant-chat"
            />
          </View>
        ) : (
          <Text style={[ui.caption, styles.archivedNote]}>
            {t("Hồ sơ đã lưu trữ. Cuộc trò chuyện cũ vẫn được giữ lại.")}</Text>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  messages: {
    paddingHorizontal: SPACING.page,
    paddingBottom: SPACING.page,
    width: "100%",
    maxWidth: LAYOUT.contentMaxWidth,
    alignSelf: "center",
  },
  context: {
    backgroundColor: COLORS.surfaceSoft,
    borderRadius: RADIUS.md,
    borderCurve: "continuous",
    padding: SPACING.md,
    marginBottom: SPACING.page,
  },
  bubble: {
    maxWidth: "94%",
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    borderCurve: "continuous",
    marginBottom: SPACING.compact,
  },
  photoBubble: { width: "94%" },
  attachment: { gap: SPACING.sm, marginBottom: SPACING.md },
  photo: {
    width: "100%",
    aspectRatio: 4 / 3,
    backgroundColor: COLORS.surfaceSoft,
    borderRadius: RADIUS.md,
  },
  user: {
    alignSelf: "flex-end",
    backgroundColor: COLORS.actionSurface,
    ...GRADIENTS.action,
    borderBottomRightRadius: RADIUS.xs,
  },
  assistant: {
    alignSelf: "flex-start",
    backgroundColor: COLORS.surface,
    borderBottomLeftRadius: RADIUS.xs,
  },
  author: {
    ...TYPE.overline,
    color: COLORS.primaryDark,
    marginBottom: SPACING.sm,
  },
  composer: {
    flexShrink: 0,
    padding: SPACING.md,
    width: "100%",
    maxWidth: LAYOUT.contentMaxWidth,
    alignSelf: "center",
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderColor: COLORS.border,
  },
  input: {
    ...INPUT.multiline,
    minHeight: LAYOUT.control,
    maxHeight: LAYOUT.control * 3,
    backgroundColor: COLORS.surfaceSoft,
    borderWidth: 1,
    borderColor: COLORS.controlBorder,
    borderRadius: RADIUS.md,
    borderCurve: "continuous",
  },
  archivedNote: {
    padding: SPACING.page,
    width: "100%",
    maxWidth: LAYOUT.contentMaxWidth,
    alignSelf: "center",
  },
});
