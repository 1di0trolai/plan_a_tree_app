/** Điều phối tiến trình, hủy và thời hạn chung cho một yêu cầu AI, bao gồm chuẩn bị ảnh, gửi dữ liệu và đọc phản hồi. */

export type AiProgress = 'preparing' | 'requesting';

export type AiRequestOptions = {
  signal?: AbortSignal;
  onProgress?: (phase: AiProgress) => void;
  /** Total budget, including native image preparation, upload and response parsing. */
  timeoutMs?: number;
};

export class AiServiceError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'AiServiceError';
  }
}

/** Public copy is selected by error code; server diagnostics stay out of the UI. */
export function aiFailureMessage(code: string, status: number): string {
  if (code === 'AI_CONTENT_BLOCKED')
    return 'Trợ lý chưa thể trả lời nội dung này. Hãy thử câu hỏi khác về việc chăm cây.';
  if (code === 'AI_OUTPUT_INCOMPLETE')
    return 'Câu trả lời chưa hoàn tất. Hãy thử hỏi ngắn hơn hoặc gửi lại.';
  if (status === 413)
    return 'Ảnh quá lớn. Hãy chụp lại gần cây hơn hoặc dùng ảnh nhỏ hơn.';
  if (status === 429 || code === 'AI_RATE_LIMITED')
    return 'Trợ lý đang giới hạn lượt gọi. Chờ một chút rồi thử lại.';
  if (status === 504 || code === 'AI_TIMEOUT')
    return 'Trợ lý phản hồi quá lâu. Vui lòng thử lại sau.';
  if (['AI_PROVIDER_UNAVAILABLE', 'AI_UPSTREAM_NETWORK'].includes(code))
    return 'Dịch vụ trợ lý tạm thời gián đoạn. Vui lòng thử lại sau.';
  if (status === 401 || status === 503 || [
    'AI_NOT_CONFIGURED', 'AI_ACCESS_DENIED', 'AI_MODEL_UNAVAILABLE',
    'AI_BILLING_REQUIRED', 'AI_PROJECT_PRECONDITION', 'AI_REQUEST_REJECTED',
  ].includes(code))
    return 'Kết nối trợ lý hiện chưa sẵn sàng. Vui lòng thử lại sau hoặc liên hệ người quản lý ứng dụng.';
  return 'Chưa lấy được kết quả từ trợ lý. Vui lòng thử lại.';
}

export type AiOperation = {
  signal: AbortSignal;
  check: () => void;
  progress: (phase: AiProgress) => void;
};

/** One cancellable budget for the whole operation, not a new timer per photo. */
export async function runAiOperation<T>(
  options: AiRequestOptions | undefined,
  task: (operation: AiOperation) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timeoutReached = false;
  const cancellation = () => new AiServiceError(
    timeoutReached ? 'TIMEOUT' : 'CANCELLED',
    timeoutReached
      ? 'Trợ lý thông minh phản hồi quá lâu. Chưa lưu kết quả; bạn có thể thử lại hoặc nhập thủ công.'
      : 'Đã hủy xử lý ảnh. Chưa lưu kết quả.',
  );
  const check = () => { if (controller.signal.aborted) throw cancellation(); };
  const abort = () => controller.abort();
  options?.signal?.addEventListener('abort', abort, { once: true });
  if (options?.signal?.aborted) controller.abort();
  const requestedBudget = options?.timeoutMs ?? 45_000;
  const timeout = setTimeout(() => { timeoutReached = true; controller.abort(); },
    Number.isFinite(requestedBudget) ? Math.max(1, Math.min(requestedBudget, 120_000)) : 45_000);
  let onAbort!: () => void;
  const stopped = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(cancellation());
    controller.signal.addEventListener('abort', onAbort, { once: true });
    if (controller.signal.aborted) onAbort();
  });
  const operation: AiOperation = {
    signal: controller.signal,
    check,
    progress: (phase) => { check(); options?.onProgress?.(phase); },
  };
  try {
    // Native decoders cannot be interrupted mid-call. The race releases the UI
    // promptly; task.check() stops later upload and its finally blocks still run.
    return await Promise.race([Promise.resolve().then(() => { check(); return task(operation); }), stopped]);
  } finally {
    clearTimeout(timeout);
    options?.signal?.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', onAbort);
  }
}
