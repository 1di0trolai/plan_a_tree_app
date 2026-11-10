/** Điều khiển trang quản trị: phiên đăng nhập, chọn người nhận, soạn/xác nhận gửi quà, lịch sử và đổi mật khẩu qua API cùng nguồn. */
'use strict';

const $ = id => document.getElementById(id);
const foods = [
  ['berry-bites', 'Quả mọng', 'berry-bites'], ['rice-bowl', 'Cơm trắng', 'rice-bowl'], ['honey-cookie', 'Bánh ngọt', 'honey-cake'],
  ['forest-milk', 'Sữa tươi', 'forest-milk'], ['ramen-bowl', 'Mì ramen', 'ramen-bowl'], ['star-snack', 'Bánh sao', 'star-snack'],
];
let csrf = '', cursor, draftRequestId, draft, submitting = false, usersLoading = false;
const selectedUsers = new Map();
const number = value => new Intl.NumberFormat('vi-VN').format(value);
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function message(text, error = false) {
  const element = $('app-message');
  element.textContent = text; element.hidden = !text; element.classList.toggle('is-error', error);
}
function loggedOut(text = '') {
  csrf = ''; draft = undefined; draftRequestId = undefined; selectedUsers.clear(); cursor = undefined;
  $('app-view').hidden = true; $('login-view').hidden = false;
  $('login-password').value = ''; $('login-error').textContent = text;
  $('password-form').reset(); $('compose-form').reset(); $('users-list').replaceChildren(); $('history-list').replaceChildren();
  $('confirm-dialog').close();
}
async function api(path, options = {}) {
  const { initial = false, ...requestOptions } = options;
  const headers = { ...options.headers };
  if (options.body) headers['content-type'] = 'application/json';
  if (options.method && options.method !== 'GET' && csrf) headers['x-csrf-token'] = csrf;
  let response;
  try { response = await fetch(`/api/admin/${path}`, { ...requestOptions, headers, credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(30000) }); }
  catch { throw new Error('Chưa kết nối được máy chủ. Kiểm tra mạng riêng rồi thử lại.'); }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path !== 'login' && !initial) loggedOut('Phiên quản trị đã hết hạn. Hãy đăng nhập lại.');
    throw new Error(result.error?.message || 'Chưa xử lý được yêu cầu. Hãy thử lại.');
  }
  return result;
}
async function busy(button, action, label = 'Đang xử lý…') {
  if (button.disabled) return;
  const old = button.textContent; button.disabled = true; button.textContent = label;
  try { return await action(); }
  finally { button.disabled = false; button.textContent = old; }
}
function showApp(result) {
  csrf = result.csrfToken; $('admin-name').textContent = result.admin.username;
  $('login-view').hidden = true; $('app-view').hidden = false; $('login-password').value = '';
  message(''); changeView('compose', false); void loadUsers();
}
function changeView(view, focus = true) {
  for (const name of ['compose', 'history', 'security']) $(`${name}-view`).hidden = name !== view;
  for (const button of document.querySelectorAll('[data-view]')) {
    if (button.dataset.view === view) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  }
  $('page-title').textContent = { compose: 'Gửi một điều tốt lành', history: 'Lịch sử gửi thư', security: 'Bảo mật tài khoản' }[view];
  message(''); if (focus) $('main').focus();
  if (view === 'history') void loadHistory();
}
function audience() { return document.querySelector('input[name="audience"]:checked').value; }
function selectedCount() {
  $('selected-count').textContent = audience() === 'all' ? 'Tất cả tài khoản đang hoạt động' : selectedUsers.size ? `Đã chọn ${number(selectedUsers.size)} người nhận` : 'Chưa chọn người nhận';
}
async function loadUsers(append = false) {
  if (usersLoading) return;
  usersLoading = true; $('user-status').textContent = 'Đang tải người dùng…'; $('search-button').disabled = true;
  try {
    const params = new URLSearchParams({ search: $('user-search').value.trim() });
    if (append && cursor) params.set('cursor', cursor);
    const result = await api(`users?${params}`);
    if (!append) $('users-list').replaceChildren();
    for (const user of result.users) {
      const label = node('label', undefined, 'user-choice');
      const check = node('input'); check.type = 'checkbox'; check.checked = selectedUsers.has(user.id);
      check.addEventListener('change', () => {
        if (check.checked) selectedUsers.set(user.id, user); else selectedUsers.delete(user.id);
        draftRequestId = undefined; selectedCount();
      });
      const text = node('span', user.username || 'Người dùng PAT'); text.append(node('small', user.email));
      label.append(check, text); $('users-list').append(label);
    }
    cursor = result.nextCursor; $('more-users').hidden = !cursor;
    $('user-status').textContent = result.users.length ? 'Chọn từng tài khoản để nhận thư.' : 'Không tìm thấy tài khoản phù hợp.';
  } catch (cause) { $('user-status').textContent = cause.message; }
  finally { usersLoading = false; $('search-button').disabled = false; }
}
function integerValue(element, max) {
  const value = Number(element.value || 0);
  if (!Number.isSafeInteger(value) || value < 0 || value > max) { element.focus(); throw new Error('Số lượng quà cần là số nguyên trong giới hạn hiển thị.'); }
  return value;
}
function giftDescription(gift) {
  return gift.kind === 'gold' ? `${number(gift.quantity)} vàng` : `${foods.find(([id]) => id === gift.itemId)?.[1] || 'Thức ăn'} ×${number(gift.quantity)}`;
}
function prepareMail() {
  const title = $('mail-title').value.trim(), body = $('mail-body').value.trim();
  if (!title || !body) throw new Error('Hãy nhập tiêu đề và lời nhắn.');
  const target = audience();
  if (target === 'users' && !selectedUsers.size) throw new Error('Hãy chọn ít nhất một người nhận.');
  const attachments = [];
  const gold = integerValue($('gift-gold'), 100000);
  if (gold) attachments.push({ kind: 'gold', quantity: gold });
  for (const [itemId] of foods) {
    const quantity = integerValue($(`food-${itemId}`), 9999);
    if (quantity) attachments.push({ kind: 'food', itemId, quantity });
  }
  draftRequestId ??= crypto.randomUUID();
  draft = { requestId: draftRequestId, title, body, target, ...(target === 'users' ? { userIds: [...selectedUsers.keys()] } : {}), attachments };
  $('confirm-audience').textContent = target === 'all' ? 'Gửi tới tất cả người dùng đang hoạt động' : `Gửi tới ${number(selectedUsers.size)} người dùng đã chọn`;
  $('confirm-mail-title').textContent = title; $('confirm-mail-body').textContent = body;
  $('confirm-gifts').replaceChildren(...attachments.map(gift => node('li', giftDescription(gift))));
  $('confirm-gifts').hidden = !attachments.length;
  $('confirm-dialog').showModal();
}
async function loadHistory() {
  $('history-list').replaceChildren(node('p', 'Đang tải lịch sử…', 'muted'));
  try {
    const result = await api('publications');
    const entries = result.publications ?? result;
    $('history-list').replaceChildren();
    if (!entries.length) $('history-list').append(node('p', 'Chưa có thư nào được gửi.', 'muted'));
    for (const entry of entries) {
      const article = node('article', undefined, 'history-entry');
      const time = node('time', new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.createdAt)));
      time.dateTime = new Date(entry.createdAt).toISOString();
      article.append(node('h3', entry.title), time, node('p', 'Đã gửi vào hòm thư'), node('span', `${number(entry.recipientCount)} người nhận`));
      $('history-list').append(article);
    }
  } catch (cause) { $('history-list').replaceChildren(node('p', cause.message, 'error')); }
}

for (const [itemId, name, imageName] of foods) {
  const group = node('div', undefined, 'gift-field food-field');
  const image = node('img', undefined, 'gift-image');
  Object.assign(image, { src: `/admin/assets/${imageName}.png`, alt: '', width: 52, height: 52 });
  const label = node('label', name); label.htmlFor = `food-${itemId}`;
  const input = node('input'); Object.assign(input, { id: label.htmlFor, type: 'number', min: '0', max: '9999', step: '1', value: '0', inputMode: 'numeric' });
  group.append(image, label, input); $('food-fields').append(group);
}
$('login-form').addEventListener('submit', event => {
  event.preventDefault(); $('login-error').textContent = '';
  void busy(event.submitter, async () => {
    try { showApp(await api('login', { method: 'POST', body: JSON.stringify({ username: $('login-name').value.trim(), password: $('login-password').value }) })); }
    catch (cause) { $('login-error').textContent = cause.message; $('login-password').focus(); }
  }, 'Đang đăng nhập…');
});
for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => changeView(button.dataset.view));
$('logout-button').addEventListener('click', event => { void busy(event.currentTarget, async () => {
  try { await api('logout', { method: 'POST' }); loggedOut(); $('login-name').focus(); }
  catch (cause) { message(cause.message, true); }
}); });
$('compose-form').addEventListener('input', () => { draftRequestId = undefined; });
for (const radio of document.querySelectorAll('input[name="audience"]')) radio.addEventListener('change', () => { const all = audience() === 'all'; $('user-picker').hidden = all; $('all-users-note').hidden = !all; selectedCount(); });
$('search-button').addEventListener('click', () => { void loadUsers(); });
$('user-search').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); void loadUsers(); } });
$('more-users').addEventListener('click', () => { void loadUsers(true); });
$('compose-form').addEventListener('submit', event => { event.preventDefault(); try { message(''); prepareMail(); } catch (cause) { message(cause.message, true); } });
for (const id of ['close-confirm', 'cancel-confirm']) $(id).addEventListener('click', () => { if (!submitting) $('confirm-dialog').close(); });
$('confirm-dialog').addEventListener('cancel', event => { if (submitting) event.preventDefault(); });
$('send-button').addEventListener('click', event => { void busy(event.currentTarget, async () => {
  if (!draft || submitting) return;
  submitting = true; $('close-confirm').disabled = true; $('cancel-confirm').disabled = true;
  try {
    const result = await api('publications', { method: 'POST', body: JSON.stringify(draft) });
    $('confirm-dialog').close(); draftRequestId = undefined; draft = undefined;
    $('compose-form').reset(); selectedUsers.clear(); selectedCount(); $('user-picker').hidden = false; $('all-users-note').hidden = true; void loadUsers();
    message(`Đã gửi thư đến ${number(result.recipientCount)} người dùng.`);
  } catch (cause) { $('confirm-dialog').close(); message(`${cause.message} Bạn có thể bấm gửi lại; hệ thống sẽ không phát trùng thư.`, true); }
  finally { submitting = false; $('close-confirm').disabled = false; $('cancel-confirm').disabled = false; }
}, 'Đang gửi…'); });
$('refresh-history').addEventListener('click', event => { void busy(event.currentTarget, loadHistory, 'Đang tải…'); });
$('password-form').addEventListener('submit', event => {
  event.preventDefault(); message('');
  if ($('new-password').value !== $('repeat-password').value) { message('Hai mật khẩu mới chưa khớp.', true); $('repeat-password').focus(); return; }
  void busy(event.submitter, async () => {
    try {
      await api('password', { method: 'POST', body: JSON.stringify({ currentPassword: $('current-password').value, newPassword: $('new-password').value }) });
      $('password-form').reset(); loggedOut('Đã đổi mật khẩu. Hãy đăng nhập bằng mật khẩu mới.'); $('login-password').focus();
    } catch (cause) { message(cause.message, true); }
  });
});
void api('me', { initial: true }).then(showApp).catch(cause => { $('login-error').textContent = cause.message === 'Hãy đăng nhập tài khoản quản trị.' ? '' : cause.message; });
