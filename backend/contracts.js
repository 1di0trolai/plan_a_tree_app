/** Định nghĩa hợp đồng dữ liệu API AI, giới hạn ảnh/nội dung và lỗi chuẩn; kiểm tra yêu cầu lẫn kết quả nhận diện, phân tích và trò chuyện. */
import { isValidImageBytes } from './imageValidation.js';

const CROPS = ['mango', 'tomato', 'chili', 'other'];
const PHASES = ['planning', 'germinating', 'seedling', 'growing', 'flowering', 'fruiting'];
export const MAX_BODY_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 8 * 1024 * 1024;

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function invalid(message) { throw new ApiError(400, 'INVALID_REQUEST', message); }
function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${name} phải là object.`);
  return value;
}
function text(value, name, max = 500, optional = false) {
  if (optional && value == null) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > max) invalid(`${name} không hợp lệ (tối đa ${max} ký tự).`);
  return value.trim();
}
function oneOf(value, allowed, name) {
  if (!allowed.includes(value)) invalid(`${name} không hợp lệ.`);
  return value;
}
function list(value, name, max, min = 0) {
  if (!Array.isArray(value) || value.length < min || value.length > max) invalid(`${name} phải có ${min}–${max} phần tử.`);
  return value;
}
function image(value, name, budget) {
  object(value, name);
  const mimeType = oneOf(value.mimeType, ['image/jpeg', 'image/png'], `${name}.mimeType`);
  if (typeof value.base64 !== 'string' || value.base64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.base64)) invalid(`${name}: ảnh base64 không hợp lệ hoặc lớn hơn 2 MB.`);
  const bytes = Buffer.from(value.base64, 'base64');
  budget.bytes += bytes.length;
  if (!bytes.length || budget.bytes > MAX_TOTAL_IMAGE_BYTES) invalid('Tổng ảnh tối đa 8 MB. Hãy giảm kích thước ảnh.');
  if (!isValidImageBytes(bytes, mimeType)) invalid(`${name}: nội dung không phải ảnh JPEG/PNG hợp lệ hoặc kích thước quá lớn.`);
  return { mimeType, base64: value.base64 };
}
function plant(value) {
  object(value, 'plant');
  return {
    id: text(value.id, 'plant.id', 100),
    name: text(value.name, 'plant.name', 100),
    crop: oneOf(value.crop, CROPS, 'plant.crop'),
    phase: oneOf(value.phase, PHASES, 'plant.phase'),
    ...Object.fromEntries(['notes', 'plantedAt', 'location', 'species', 'light', 'method', 'startedAt'].flatMap(key => {
      const limits = { notes: 1500, plantedAt: 80, location: 500, species: 150, light: 300, method: 100, startedAt: 80 };
      const result = text(value[key], `plant.${key}`, limits[key], true);
      return result === undefined ? [] : [[key, result]];
    })),
  };
}
function context(value, budget) {
  let photoContext;
  if (value.photoContext !== undefined) {
    const counts = object(value.photoContext, 'photoContext');
    if (!Number.isInteger(counts.selected) || counts.selected < 0 || counts.selected > 2
      || !Number.isInteger(counts.unavailable) || counts.unavailable < 0 || counts.unavailable > counts.selected)
      invalid('photoContext phải là số lượng ảnh từ 0–2.');
    photoContext = { selected: counts.selected, unavailable: counts.unavailable };
  }
  const referenceImages = list(value.referenceImages ?? [], 'referenceImages', 2)
    .map((x, i) => image(x, `referenceImages[${i}]`, budget));
  const referencePhotoDates = value.referencePhotoDates === undefined ? undefined
    : list(value.referencePhotoDates, 'referencePhotoDates', 2).map(date => text(date, 'referencePhotoDates item', 80));
  if (referencePhotoDates && referencePhotoDates.length !== referenceImages.length)
    invalid('Mốc thời gian ảnh phải khớp số ảnh được đính kèm.');
  return {
    plant: plant(value.plant),
    ...(photoContext ? { photoContext } : {}),
    referenceImages,
    ...(referencePhotoDates === undefined ? {} : { referencePhotoDates }),
    history: list(value.history ?? [], 'history', 12).map(x => {
      object(x, 'history item');
      return { date: text(x.date, 'history.date', 80), summary: text(x.summary, 'history.summary', 1500) };
    }),
    careEvents: list(value.careEvents ?? [], 'careEvents', 20).map(x => {
      object(x, 'careEvents item');
      return { date: text(x.date, 'careEvents.date', 80), type: text(x.type, 'careEvents.type', 80), note: text(x.note, 'careEvents.note', 700, true) ?? '' };
    }),
  };
}

export function validateRequest(kind, value) {
  object(value, 'request');
  const budget = { bytes: 0 };
  if (kind === 'identify') return { image: image(value.image, 'image', budget) };
  if (kind === 'recognize') {
    const currentImage = image(value.image, 'image', budget);
    const candidates = list(value.candidates, 'candidates', 6, 1).map(x => {
      object(x, 'candidate');
      return { plant: plant(x.plant), images: list(x.images, 'candidate.images', 2, 1).map((im, i) => image(im, `candidate.images[${i}]`, budget)) };
    });
    if (new Set(candidates.map(x => x.plant.id)).size !== candidates.length) invalid('candidate IDs phải duy nhất.');
    return { image: currentImage, candidates };
  }
  if (kind === 'analyze') return { ...context(value, budget), image: image(value.image, 'image', budget) };
  if (kind === 'chat') {
    const messages = list(value.messages, 'messages', 20, 1).map(x => {
      object(x, 'message');
      return { role: oneOf(x.role, ['user', 'assistant'], 'message.role'), text: text(x.text, 'message.text', 3000) };
    });
    if (messages.at(-1).role !== 'user') invalid('Tin nhắn cuối phải của người dùng.');
    return { ...context(value, budget), messages };
  }
  throw new ApiError(404, 'NOT_FOUND', 'Không có chức năng này.');
}

const str = { type: 'string' };
const strings = { type: 'array', items: str, maxItems: 8 };
const schema = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export function responseSchema(kind) {
  if (kind === 'identify') return schema({
    crop: { type: 'string', enum: CROPS, description: 'Nhóm tương thích; other vẫn có thể là loài đã nhận diện được như khế.' },
    label: { type: 'string', maxLength: 150, description: 'Tên phổ thông nhận được từ ảnh, không phải tên nhóm crop.' },
    species: { type: 'string', maxLength: 150 }, phase: { type: 'string', enum: PHASES },
    summary: { type: 'string', maxLength: 600 },
    guide: { type: 'array', items: { type: 'string', maxLength: 300 }, maxItems: 3 },
    warnings: { type: 'array', items: { type: 'string', maxLength: 300 }, maxItems: 2 },
  });
  if (kind === 'recognize') return schema({ decision: { type: 'string', enum: ['candidate', 'ambiguous', 'unknown', 'retake'] }, candidateIds: { type: 'array', items: str, maxItems: 3 }, explanation: str });
  if (kind === 'analyze') return schema({ analysis: schema({ level: { type: 'string', enum: ['Tốt', 'Chú ý', 'Cảnh báo'] }, title: str, summary: str, actions: strings }), questions: strings, limitations: strings });
  return schema({
    // Gemini strips maxLength from constrained decoding. The task prompt is
    // deliberately concise too, and validateResult still applies the hard
    // application bound rather than trusting the schema alone.
    content: { type: 'string', maxLength: 1200, description: 'Câu trả lời theo ngôn ngữ được yêu cầu, ngắn, trực tiếp cho câu hỏi cuối; tối đa khoảng 1200 ký tự, không lặp toàn bộ nhật ký.' },
    questions: { type: 'array', items: { type: 'string', maxLength: 250 }, maxItems: 1 },
    limitations: { type: 'array', items: { type: 'string', maxLength: 250 }, maxItems: 1 },
  });
}

export function validateResult(kind, result, request) {
  try {
    object(result, 'result');
    const words = (x, name) => list(x, name, 8).map(s => text(s, name, 1500));
    if (kind === 'identify') return {
      crop: oneOf(result.crop, CROPS, 'crop'), label: text(result.label, 'label', 150), species: text(result.species, 'species', 150),
      phase: oneOf(result.phase, PHASES, 'phase'), summary: text(result.summary, 'summary', 600),
      guide: list(result.guide, 'guide', 3).map(step => text(step, 'guide', 300)),
      warnings: list(result.warnings, 'warnings', 2).map(warning => text(warning, 'warnings', 300)),
    };
    if (kind === 'recognize') {
      const decision = oneOf(result.decision, ['candidate', 'ambiguous', 'unknown', 'retake'], 'decision');
      const candidateIds = list(result.candidateIds, 'candidateIds', 3).map(x => text(x, 'candidateId', 100));
      const allowed = new Set(request.candidates.map(x => x.plant.id));
      if (candidateIds.some(id => !allowed.has(id)) || new Set(candidateIds).size !== candidateIds.length
          || (decision === 'candidate' && candidateIds.length !== 1)
          || (decision === 'ambiguous' && candidateIds.length < 2)
          || (['unknown', 'retake'].includes(decision) && candidateIds.length !== 0)) invalid('Kết quả nhận diện không khớp vườn.');
      return { decision, candidateIds, explanation: text(result.explanation, 'explanation', 3000) };
    }
    if (kind === 'analyze') {
      object(result.analysis, 'analysis');
      return {
        analysis: {
          level: oneOf(result.analysis.level, ['Tốt', 'Chú ý', 'Cảnh báo'], 'analysis.level'),
          title: text(result.analysis.title, 'analysis.title', 200), summary: text(result.analysis.summary, 'analysis.summary', 4000), actions: words(result.analysis.actions, 'actions'),
        }, questions: words(result.questions ?? [], 'questions'), limitations: words(result.limitations ?? [], 'limitations'),
      };
    }
    return { content: text(result.content, 'content', 6000), questions: words(result.questions ?? [], 'questions'), limitations: words(result.limitations ?? [], 'limitations') };
  } catch {
    throw new ApiError(502, 'INVALID_AI_RESULT', 'AI trả kết quả không hợp lệ. Vui lòng chụp rõ hơn hoặc thử lại.');
  }
}
