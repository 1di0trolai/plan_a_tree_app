/** Kiểm tra danh mục quà đính kèm, ghép thư nhà phát hành vào bản lưu và cộng phần thưởng từ dữ liệu thư đáng tin cậy của máy chủ. */
import { ApiError } from './contracts.js';

export const MAIL_FOOD_IDS = Object.freeze(['berry-bites', 'rice-bowl', 'honey-cookie', 'forest-milk', 'ramen-bowl', 'star-snack']);
const invalid = message => { throw new ApiError(400, 'INVALID_REQUEST', message); };

export function validateMailAttachments(value = []) {
  if (!Array.isArray(value) || value.length > 7) invalid('Quà đính kèm không hợp lệ.');
  const seen = new Set();
  return value.map(entry => {
    if (!entry || !Number.isSafeInteger(entry.quantity) || entry.quantity < 1) invalid('Số lượng quà không hợp lệ.');
    const key = entry.kind === 'gold' ? 'gold' : entry.itemId;
    if (seen.has(key)) invalid('Mỗi loại quà chỉ được xuất hiện một lần.');
    seen.add(key);
    if (entry.kind === 'gold' && entry.quantity <= 100000) return { kind: 'gold', quantity: entry.quantity };
    if (entry.kind === 'food' && MAIL_FOOD_IDS.includes(entry.itemId) && entry.quantity <= 9999)
      return { kind: 'food', itemId: entry.itemId, quantity: entry.quantity };
    invalid('Loại hoặc số lượng quà chưa được hỗ trợ.');
  });
}

/** Publisher letters and their flags are never taken from an editable phone snapshot. */
export function overlayPublisherMail(state, letters) {
  if (!state) return null;
  return { ...state, mailbox: [...(state.mailbox ?? []).filter(mail => mail?.source === 'system'),
    ...letters.filter(mail => !mail.deletedAt).map(({ deletedAt: _deleted, ...mail }) => mail)] };
}

export function creditPublisherAttachments(state, letters) {
  if (!state?.economy || !state.inventory || !Array.isArray(state.inventory.items))
    throw new ApiError(409, 'SYNC_REQUIRED', 'Hãy đồng bộ dữ liệu trước khi nhận quà.');
  const updated = structuredClone(state);
  let gold = updated.economy.gold;
  if (!Number.isSafeInteger(gold) || gold < 0) invalid('Số dư vàng không hợp lệ.');
  for (const letter of letters) {
    for (const attachment of validateMailAttachments(letter.attachments)) {
      if (attachment.kind === 'gold') {
        gold += attachment.quantity;
        if (!Number.isSafeInteger(gold)) invalid('Số dư vàng vượt giới hạn.');
      } else {
        const item = updated.inventory.items.find(entry => entry.id === attachment.itemId);
        if (!item || !Number.isSafeInteger(item.quantity) || item.quantity < 0
          || !Number.isSafeInteger(item.quantity + attachment.quantity)) invalid('Kho thức ăn không hợp lệ.');
        item.quantity += attachment.quantity;
      }
    }
  }
  updated.economy.gold = gold;
  return updated;
}
