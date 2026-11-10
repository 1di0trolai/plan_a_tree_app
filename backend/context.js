/** Rút gọn ngữ cảnh gửi AI bằng trích đoạn cố định, giữ nguyên câu hỏi hiện tại và bằng chứng chăm sóc gần đây. Không gọi AI phụ hay sửa nhật ký gốc trên thiết bị. */
const excerpt = (value, maximum) => value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;

export function compactCareRequest(kind, request) {
  if (!['chat', 'analyze'].includes(kind)) return request;
  const chat = kind === 'chat';
  const history = (request.history ?? []).slice(0, chat ? 6 : 8).map(entry => ({
    ...entry, summary: excerpt(entry.summary, chat ? 400 : 600),
  }));
  const careEvents = (request.careEvents ?? []).slice(0, chat ? 10 : 12).map(entry => ({
    ...entry, note: excerpt(entry.note ?? '', chat ? 240 : 400),
  }));
  const result = {
    ...request, referenceImages: request.referenceImages ?? [], history, careEvents,
    contextWindow: {
      history: { included: history.length, received: request.history?.length ?? 0 },
      careEvents: { included: careEvents.length, received: request.careEvents?.length ?? 0 },
    },
  };
  if (!chat) return result;
  // Most older assistant responses repeat the same inspection already in
  // history. Keep a short conversational window instead of re-sending up to
  // 60,000 characters on every new question.
  result.messages = request.messages.slice(-8).map((message, index, messages) => ({
    ...message,
    text: index === messages.length - 1 ? message.text : excerpt(message.text, 600),
  }));
  result.contextWindow.messages = { included: result.messages.length, received: request.messages.length };
  return result;
}
