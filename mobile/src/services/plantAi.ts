/** Chuẩn bị ảnh và ngữ cảnh chăm cây để gọi API nhận diện, phân tích hoặc trò chuyện. Kiểm tra phản hồi, quản lý tệp ảnh tạm và cung cấp hướng dẫn mẫu khi được chọn. */

import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { File, Paths } from "expo-file-system";
import { Image } from "react-native";
import type {
  Analysis,
  CareEvent,
  CropKind,
  Plant,
  PlantAnalysisRecord,
  PlantChatMessage,
  PlantPhase,
  PlantPhoto,
} from "../types/app";
import { PHASE_LABELS } from "../store/journeyActions";
import { getLocale, t } from "../i18n/core";
import { mergeRecognitionBatches, type RecognitionResult } from "../utils/scanRecognition";
import {
  CHAT_CONTEXT_LIMITS,
  imagePayloadWithinBudget,
  imageResize,
  pickCurrentPhotos,
  validateAiResponse,
  type AiResponseKind,
} from "./plantAiContracts";
import {
  AiServiceError,
  aiFailureMessage,
  runAiOperation,
  type AiOperation,
  type AiRequestOptions,
} from "./aiRequestLifecycle";

export { AiServiceError } from "./aiRequestLifecycle";
export type { AiProgress, AiRequestOptions } from "./aiRequestLifecycle";

/** Provider credentials NEVER belong here; these are a local-development proxy URL/token. */
const apiUrl =
  process.env.EXPO_PUBLIC_PAT_API_URL?.trim().replace(/\/+$/, "") ?? "";
const apiToken = process.env.EXPO_PUBLIC_PAT_API_TOKEN?.trim() ?? "";
type InlineImage = { mimeType: "image/jpeg"; base64: string };
type IdentifyResult = {
  crop: CropKind;
  label: string;
  species: string;
  phase: PlantPhase;
  summary: string;
  guide: string[];
  warnings: string[];
};
export function isAiConfigured() {
  return Boolean(apiUrl && apiToken);
}

function assertConfigured() {
  if (!isAiConfigured())
    throw new AiServiceError(
      "NOT_CONFIGURED",
      "Kết nối trợ lý hiện chưa sẵn sàng. Vui lòng thử lại sau hoặc liên hệ người quản lý ứng dụng.",
    );
  let parsed: URL;
  try {
    parsed = new URL(apiUrl);
  } catch {
    throw new AiServiceError("INVALID_URL", "Kết nối trợ lý hiện chưa sẵn sàng. Vui lòng thử lại sau hoặc liên hệ người quản lý ứng dụng.");
  }
  if (
    !["https:", "http:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new AiServiceError(
      "INVALID_URL",
      "Kết nối trợ lý hiện chưa sẵn sàng. Vui lòng thử lại sau hoặc liên hệ người quản lý ứng dụng.",
    );
  }
  if (!__DEV__ && parsed.protocol !== "https:") {
    throw new AiServiceError(
      "HTTPS_REQUIRED",
      "Kết nối trợ lý chưa bảo mật. Vui lòng liên hệ người quản lý ứng dụng.",
    );
  }
}

async function request<T>(
  path: AiResponseKind,
  payload: unknown,
  operation: AiOperation,
  allowedIds?: string[],
): Promise<T> {
  operation.check();
  assertConfigured();
  if (!imagePayloadWithinBudget(payload))
    throw new AiServiceError(
      "PAYLOAD_TOO_LARGE",
      "Tổng ảnh vượt giới hạn. Hãy chọn một hồ sơ để so sánh ít ảnh hơn hoặc dùng ảnh nhỏ hơn.",
    );
  operation.progress("requesting");
  const started = Date.now();
  try {
    const response = await fetch(`${apiUrl}/api/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept-Language": getLocale(),
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify(payload),
      signal: operation.signal,
    });
    operation.check();
    const body = await response.json().catch(() => null);
    operation.check();
    if (!response.ok) {
      const code = typeof body?.error?.code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(body.error.code)
        ? body.error.code : `HTTP_${response.status}`;
      throw new AiServiceError(
        code,
        aiFailureMessage(code, response.status),
      );
    }
    if (
      body?.mode !== "gemini" ||
      !validateAiResponse(path, body.result, allowedIds)
    ) {
      throw new AiServiceError(
        "INVALID_RESPONSE",
        "Máy chủ trả dữ liệu không hợp lệ. Chưa ghi nhận kiểm tra.",
      );
    }
    return body.result as T;
  } catch (error) {
    operation.check();
    if (error instanceof AiServiceError) throw error;
    throw new AiServiceError(
      "NETWORK",
      "Không kết nối được máy chủ. Kiểm tra Internet và kết nối Tailscale rồi thử lại.",
    );
  } finally {
    // Durations only: never log images, plant names, messages, URLs or credentials.
    if (__DEV__) console.info(`[PAT AI] ${path}: request ${Date.now() - started}ms`);
  }
}

/** Upload resized JPEG pixels, not source file URLs or full-resolution library files. */
async function encodePhoto(uri: string, operation: AiOperation, maximumEdge = 960): Promise<InlineImage> {
  operation.check();
  if (!/^(file|content|ph):/i.test(uri)) {
    throw new AiServiceError(
      "LOCAL_PHOTO_REQUIRED",
      "Hãy chụp hoặc chọn ảnh thật đã lưu trên thiết bị.",
    );
  }
  let context: ReturnType<typeof ImageManipulator.manipulate> | undefined;
  let temporaryUri: string | undefined;
  try {
    const dimensions = await Image.getSize(uri);
    operation.check();
    context = ImageManipulator.manipulate(uri, { maxWidth: maximumEdge, maxHeight: maximumEdge });
    context.resize(imageResize(dimensions.width, dimensions.height, maximumEdge));
    const rendered = await context.renderAsync();
    try {
      operation.check();
      const encoded = await rendered.saveAsync({
        format: SaveFormat.JPEG,
        compress: maximumEdge < 960 ? 0.55 : 0.6,
        base64: true,
      });
      temporaryUri = encoded.uri;
      operation.check();
      if (!encoded.base64 || encoded.base64.length > 1_500_000) {
        throw new AiServiceError(
          "IMAGE_TOO_LARGE",
          "Ảnh vẫn quá lớn sau khi nén. Hãy cắt bớt nền hoặc chọn ảnh nhỏ hơn.",
        );
      }
      return { mimeType: "image/jpeg", base64: encoded.base64 };
    } finally {
      rendered.release();
    }
  } catch (error) {
    operation.check();
    if (error instanceof AiServiceError) throw error;
    throw new AiServiceError(
      "PHOTO_UNREADABLE",
      "Không đọc được ảnh trên máy. Hãy chọn hoặc chụp lại ảnh.",
    );
  } finally {
    context?.release();
    // Delete only the newly generated upload cache, never the source/private journal photo.
    const cachePrefix = `${Paths.cache.uri.replace(/\/$/, "")}/`;
    if (
      temporaryUri &&
      temporaryUri !== uri &&
      temporaryUri.startsWith(cachePrefix)
    ) {
      try {
        const file = new File(temporaryUri);
        if (file.exists) file.delete();
      } catch {
        /* The OS may have already reclaimed this disposable cache entry. */
      }
    }
  }
}

/** A missing older journal image must not prevent a text question or a new scan.
 * The current scan image still uses encodePhoto directly and remains mandatory.
 * Tell both Gemini and the person exactly when optional evidence was unavailable.
 */
async function prepareReferencePhotos(
  plant: Plant,
  photos: PlantPhoto[],
  operation: AiOperation,
  maximumEdge = 960,
) {
  const selected = pickCurrentPhotos(plant, photos);
  const referenceImages: InlineImage[] = [];
  const referencePhotoDates: string[] = [];
  let unavailable = 0;
  for (const photo of selected) {
    try {
      referenceImages.push(await encodePhoto(photo.imageUri, operation, maximumEdge));
      referencePhotoDates.push(`${photo.date} ${photo.time}`);
    } catch (error) {
      operation.check();
      if (!(error instanceof AiServiceError) ||
        !["PHOTO_UNREADABLE", "LOCAL_PHOTO_REQUIRED", "IMAGE_TOO_LARGE"].includes(error.code)) throw error;
      unavailable += 1;
    }
  }
  return {
    referenceImages,
    referencePhotoDates,
    photoContext: { selected: selected.length, unavailable },
    limitations: unavailable
      ? [t('Có {count} ảnh nhật ký gần đây không đọc được trên thiết bị nên chưa gửi cho trợ lý thông minh; câu trả lời không dựa trên các ảnh đó. Bạn có thể quét lại cây để lưu ảnh quan sát mới.', { count: unavailable })]
      : [],
  };
}

function plantContext(plant: Plant) {
  const fields = {
    species: plant.species,
    notes: plant.journey.notes,
    location: plant.journey.location,
    light: plant.journey.light,
    method: plant.journey.method,
    plantedAt: plant.plantedAt,
    startedAt: plant.journey.startedAt,
  };
  const limits = {
    species: 150,
    notes: 1500,
    location: 500,
    light: 300,
    method: 100,
    plantedAt: 80,
    startedAt: 80,
  };
  return {
    id: plant.id,
    name: plant.name.slice(0, 100),
    crop: plant.journey.crop,
    phase: plant.journey.phase,
    ...Object.fromEntries(
      Object.entries(fields)
        .filter(([, value]) => value.trim())
        .map(([key, value]) => [
          key,
          value.slice(0, limits[key as keyof typeof limits]),
        ]),
    ),
  };
}

function careContext(
  plant: Plant,
  analyses: PlantAnalysisRecord[],
  events: CareEvent[],
  compact = false,
) {
  return {
    plant: plantContext(plant),
    history: analyses
      .filter((entry) => entry.plantId === plant.id)
      .sort((a, b) =>
        `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`),
      )
      .slice(0, compact ? CHAT_CONTEXT_LIMITS.analyses : 12)
      .map((entry) => ({
        date: `${entry.date} ${entry.time}`,
        summary:
          `[${entry.mode === "gemini" ? "Gợi ý trợ lý thông minh, không phải chẩn đoán xác nhận" : "Thủ công/mẫu, không phải trợ lý thông minh"}] ${entry.result.summary}`.slice(
            0,
            compact ? CHAT_CONTEXT_LIMITS.analysisCharacters : 1500,
          ),
      })),
    careEvents: events
      .filter((entry) => entry.plantId === plant.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, compact ? CHAT_CONTEXT_LIMITS.careEvents : 20)
      .map((entry) => ({
        date: entry.createdAt,
        type: entry.kind,
        ...(entry.note.trim() ? { note: entry.note.slice(0, compact ? CHAT_CONTEXT_LIMITS.careEventCharacters : 700) } : {}),
      })),
  };
}

function caveats(questions?: string[], limitations?: string[]) {
  return [
    ...(questions?.length
      ? [`${t('Cần bạn xác nhận thêm:')}\n${questions.map((s) => `• ${s}`).join("\n")}`]
      : []),
    ...(limitations?.length
      ? [`${t('Giới hạn quan sát:')}\n${limitations.map((s) => `• ${s}`).join("\n")}`]
      : []),
  ].join("\n\n");
}

export async function identifyPhoto(photoUri: string, options?: AiRequestOptions) {
  return runAiOperation(options, async (operation) => {
    assertConfigured();
    operation.progress("preparing");
    const started = Date.now();
    const image = await encodePhoto(photoUri, operation);
    if (__DEV__) console.info(`[PAT AI] identify: prepare ${Date.now() - started}ms`);
    const result = await request<IdentifyResult>("identify", { image }, operation);
    return { ...result, mode: "gemini" as const };
  });
}

export async function recognizePhoto(
  photoUri: string,
  plants: Plant[],
  referencePhotos: PlantPhoto[],
  options?: AiRequestOptions,
) {
  return runAiOperation(options, async (operation) => {
    assertConfigured();
    operation.progress("preparing");
    const garden = plants.filter((plant) => !plant.archived);
    const references = garden.map((plant) => ({ plant, photos: pickCurrentPhotos(plant, referencePhotos) }))
      .filter((entry) => entry.photos.length > 0);
    if (!references.length)
      throw new AiServiceError(
        "NO_REFERENCES",
        garden.length
          ? "Vườn chưa có ảnh tham chiếu ở giai đoạn hiện tại nên trợ lý thông minh chưa thể đối chiếu. Hãy chọn cây trong vườn rồi quét kiểm tra để lưu ảnh quan sát mới. Ảnh quả không thể chứng minh danh tính cây con."
          : "Vườn chưa có cây để đối chiếu. Hãy thêm cây từ màn hình Khu vườn trước.",
      );
    const image = await encodePhoto(photoUri, operation);
    type Candidate = { plant: ReturnType<typeof plantContext>; images: InlineImage[] };
    let candidates: Candidate[] = [];
    const results: RecognitionResult[] = [];
    const compareBatch = async () => {
      operation.check();
      results.push(await request<RecognitionResult>(
        "recognize", { image, candidates }, operation,
        candidates.map((candidate) => candidate.plant.id),
      ));
      candidates = [];
    };
    // Decode sequentially and retain at most one upload batch, not the whole garden.
    // All batches share the caller's single timeout/cancellation budget.
    for (const { plant, photos } of references) {
      operation.progress("preparing");
      const images: InlineImage[] = [];
      for (const photo of photos) images.push(await encodePhoto(photo.imageUri, operation));
      const candidate = { plant: plantContext(plant), images };
      if (candidates.length && (candidates.length >= 6
        || !imagePayloadWithinBudget({ image, candidates: [...candidates, candidate] }))) {
        await compareBatch();
      }
      candidates.push(candidate);
    }
    if (candidates.length) await compareBatch();
    operation.check();
    // Never return an early match: a later batch can be ambiguous, unavailable or cancelled.
    const result = mergeRecognitionBatches(results, garden);
    const missing = garden.length - references.length;
    return {
      ...result,
      mode: "gemini" as const,
      explanation:
        result.explanation +
        (missing
          ? ` ${t('Có {count} hồ sơ chưa có ảnh đúng giai đoạn nên chưa thể so sánh. Bạn vẫn cần xác nhận đúng cây.', { count: missing })}`
          : ""),
    };
  });
}

export async function analyzePhoto(
  photoUri: string,
  plant: Plant,
  history: PlantAnalysisRecord[],
  careEvents: CareEvent[],
  photos: PlantPhoto[] = [],
  options?: AiRequestOptions,
) {
  return runAiOperation(options, async (operation) => {
    assertConfigured();
    operation.progress("preparing");
    const references = await prepareReferencePhotos(plant, photos, operation);
    const result = await request<{
      analysis: Analysis;
      questions?: string[];
      limitations?: string[];
    }>("analyze", {
      ...careContext(plant, history, careEvents),
      referenceImages: references.referenceImages,
      referencePhotoDates: references.referencePhotoDates,
      photoContext: references.photoContext,
      image: await encodePhoto(photoUri, operation),
    }, operation);
    const notes = caveats(result.questions, [...(result.limitations ?? []), ...references.limitations]);
    return {
      mode: "gemini" as const,
      analysis: {
        ...result.analysis,
        summary: result.analysis.summary + (notes ? `\n\n${notes}` : ""),
      },
    };
  });
}

export async function chatWithPlant(
  plant: Plant,
  photos: PlantPhoto[],
  analyses: PlantAnalysisRecord[],
  events: CareEvent[],
  messages: PlantChatMessage[],
  text: string,
  options?: AiRequestOptions,
) {
  return runAiOperation(options, async (operation) => {
    assertConfigured();
    operation.progress("preparing");
    const started = Date.now();
    const references = await prepareReferencePhotos(plant, photos, operation, CHAT_CONTEXT_LIMITS.photoEdge);
    const history = messages
      .filter((message) => message.plantId === plant.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((message) => ({
        role: message.role,
        text: (message.mode === "gemini" || message.role === "user"
          ? message.content
          : `[Hướng dẫn mẫu, không phải trợ lý thông minh thật] ${message.content}`
        ).slice(0, 3000),
      }));
    if (history.at(-1)?.role !== "user" || history.at(-1)?.text !== text.trim())
      history.push({ role: "user", text: text.trim() });
    const recentMessages = history.slice(-CHAT_CONTEXT_LIMITS.messages).map((message, index, recent) => ({
      ...message,
      text: index === recent.length - 1 ? message.text : message.text.slice(0, CHAT_CONTEXT_LIMITS.previousMessageCharacters),
    }));
    if (__DEV__) console.info(`[PAT AI] chat: prepare ${Date.now() - started}ms; photos ${references.referenceImages.length}`);
    const result = await request<{
      content: string;
      questions?: string[];
      limitations?: string[];
    }>("chat", {
      ...careContext(plant, analyses, events, true),
      referenceImages: references.referenceImages,
      referencePhotoDates: references.referencePhotoDates,
      photoContext: references.photoContext,
      messages: recentMessages,
    }, operation);
    const notes = caveats(result.questions, [...(result.limitations ?? []), ...references.limitations]);
    return {
      mode: "gemini" as const,
      content: result.content + (notes ? `\n\n${notes}` : ""),
    };
  });
}

export function cropGuide(crop: CropKind): string[] {
  const shared = [
    "Xác nhận giống, điều kiện ánh sáng và chỗ trồng trước khi bắt đầu.",
    "Dùng giá thể sạch, thoát nước; quan sát độ ẩm thực tế, không tưới hoặc bón chỉ để hoàn thành lượt kiểm tra.",
    "Khi chuyển giai đoạn, tự xác nhận rồi chọn cây trong màn hình Quét cây để lưu ảnh quan sát mới vào đúng hồ sơ.",
  ];
  const specifics: Record<CropKind, string[]> = {
    mango: [
      "Trồng xoài từ hạt là hành trình dài; cây có thể không giữ đặc tính quả ban đầu. Hỏi nguồn giống địa phương nếu mục tiêu là thu hoạch ổn định.",
    ],
    tomato: [
      "Có thể bắt đầu bằng hạt giống cà chua hoặc cây con có nguồn rõ ràng; ghi lại loại giống nếu biết.",
    ],
    chili: [
      "Có thể bắt đầu bằng hạt giống ớt hoặc cây con; không suy ra chính xác giống chỉ từ một ảnh quả.",
    ],
    other: [
      "Với loài cây ngoài danh sách gợi ý, hãy xác nhận tên và nguồn giống; hướng dẫn thủ công này chỉ là nguyên tắc chung, không phải tư vấn riêng cho loài.",
    ],
  };
  return [...specifics[crop], ...shared].map(value => t(value));
}

export function createDemoChatReply(plant: Plant): string {
  return `${t('Hướng dẫn mẫu — không phải trợ lý thông minh thật, chưa phân tích ảnh hoặc câu hỏi của bạn.')}\n\n${t('Hồ sơ {name} đang ở giai đoạn {phase}.', { name: plant.name, phase: t(PHASE_LABELS[plant.journey.phase]) })}\n\n${cropGuide(plant.journey.crop).join("\n\n")}\n\n${t('Kết nối Gemini để nhận gợi ý theo ảnh và lịch sử riêng của cây. trợ lý thông minh vẫn cần bạn xác nhận điều kiện thực tế.')}`;
}
