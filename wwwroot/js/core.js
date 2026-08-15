const state = {
  master: null,
  auth: null,
  route: 'dashboard',
  deliverablePage: 1,
  deliverablePageSize: 20,
  lastDeliverableFilters: {},
  changeStatusFilter: '',
};

const content = document.getElementById('app-content');
const pageTitle = document.getElementById('page-title');
const pageSubtitle = document.getElementById('page-subtitle');
const modalRoot = document.getElementById('modal-root');
const appShell = document.getElementById('app-shell');
const authRoot = document.getElementById('auth-root');

const esc = value => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const byId = id => document.getElementById(id);
const operatorName = () => state.auth?.user?.displayName || '系统用户';
const fmtDate = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
const fmtDateOnly = value => value ? String(value).slice(0, 10) : '—';

const statusNames = {
  DRAFT: '草稿', IN_REVIEW: '审批中', RELEASED: '已发布', SUPERSEDED: '已替代', DEPRECATED: '已废止',
  ACTIVE: '有效', ARCHIVED: '已归档', PENDING_ASSESSMENT: '待评估', APPROVED: '已批准',
  REJECTED: '已驳回', IMPLEMENTING: '实施中', PENDING_VERIFICATION: '待验证', CLOSED: '已关闭'
};
const confidentialityNames = { PUBLIC: '公开', INTERNAL: '内部', CONFIDENTIAL: '秘密', STRICTLY_CONFIDENTIAL: '机密' };
const shareNames = { ALLOWED: '允许分享', APPROVAL_REQUIRED: '审批后允许', PROHIBITED: '禁止分享' };
const relationNames = { DERIVES: '派生', VERIFIES: '验证', DEPENDS_ON: '依赖', REFERENCES: '引用', REPLACES: '替代' };
const roleNames = { ADMIN: '管理员', EDITOR: '编辑者', APPROVER: '审批者', VIEWER: '查看者' };
const statusBadge = status => `<span class="badge ${esc(String(status || '').toLowerCase())}">${esc(statusNames[status] || status || '未发布')}</span>`;

async function api(url, options = {}) {
  const request = { credentials: 'same-origin', ...options };
  request.headers = { ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
  const response = await fetch(url, request);
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); }
    catch { data = { message: text }; }
  }
  if (response.status === 401 && !url.startsWith('/internal/auth/')) {
    state.auth = null;
    showLoginScreen('登录已失效，请重新登录。');
    throw new Error(data?.message || '登录已失效。');
  }
  if (!response.ok) throw new Error(data?.message || `请求失败：${response.status}`);
  return data;
}

function toast(message, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  byId('toast-root').appendChild(el);
  setTimeout(() => el.remove(), 3600);
}

function setPage(title, subtitle) {
  pageTitle.textContent = title;
  pageSubtitle.textContent = subtitle;
  document.querySelectorAll('.sidebar nav a').forEach(a => a.classList.toggle('active', a.dataset.route === state.route));
}

function showModal(title, bodyHtml, { small = false, submitText = '保存', submitClass = 'btn-primary', dismissible = true, onSubmit = null } = {}) {
  modalRoot.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal ${small ? 'modal-sm' : ''}">
        <div class="modal-head"><h3>${esc(title)}</h3>${dismissible ? '<button type="button" class="modal-close" aria-label="关闭">×</button>' : ''}</div>
        <div class="modal-body">${bodyHtml}</div>
        <div class="modal-foot">${dismissible ? '<button type="button" class="btn btn-light modal-cancel">取消</button>' : ''}${onSubmit ? `<button type="button" class="btn ${submitClass} modal-submit">${esc(submitText)}</button>` : ''}</div>
      </div>
    </div>`;
  const close = () => modalRoot.replaceChildren();
  const closeButton = modalRoot.querySelector('.modal-close');
  const cancelButton = modalRoot.querySelector('.modal-cancel');
  if (closeButton) closeButton.onclick = close;
  if (cancelButton) cancelButton.onclick = close;
  if (dismissible) modalRoot.querySelector('.modal-backdrop').addEventListener('click', e => { if (e.target.classList.contains('modal-backdrop')) close(); });
  if (onSubmit) {
    modalRoot.querySelector('.modal-submit').onclick = async () => {
      const button = modalRoot.querySelector('.modal-submit');
      button.disabled = true;
      button.dataset.originalText ||= button.textContent;
      button.textContent = '处理中…';
      try { await onSubmit(close, button); }
      catch (error) { toast(error.message, 'error'); button.disabled = false; button.textContent = button.dataset.originalText; }
    };
  }
  return { close, root: modalRoot.querySelector('.modal'), backdrop: modalRoot.querySelector('.modal-backdrop') };
}

function confirmAction(title, message, { inputLabel = '', inputRequired = false, submitText = '确认', danger = false } = {}) {
  return new Promise(resolve => {
    let settled = false;
    const finish = (confirmed, value = '') => {
      if (settled) return;
      settled = true;
      modalRoot.replaceChildren();
      resolve({ confirmed, value });
    };
    const inputHtml = inputLabel ? `<div class="field"><label>${esc(inputLabel)}${inputRequired ? ' *' : ''}</label><textarea id="confirm-input"></textarea></div>` : '';
    const modal = showModal(title, `<p class="confirm-message">${esc(message)}</p>${inputHtml}`, {
      small: true, submitText, submitClass: danger ? 'btn-danger' : 'btn-primary',
      onSubmit: async () => {
        const value = inputLabel ? (byId('confirm-input').value || '').trim() : '';
        if (inputRequired && !value) throw new Error(`请填写${inputLabel}。`);
        finish(true, value);
      }
    });
    modal.root.querySelector('.modal-close').onclick = () => finish(false);
    modal.root.querySelector('.modal-cancel').onclick = () => finish(false);
    modal.backdrop.addEventListener('click', e => { if (e.target === modal.backdrop) finish(false); });
  });
}

function optionList(items, selected = '', emptyLabel = '全部') {
  return `<option value="">${esc(emptyLabel)}</option>` + items.map(x => `<option value="${x.id}" ${String(x.id) === String(selected) ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
}

async function loadMaster() { state.master = await api('/internal/master-data'); }

async function downloadCsv(url, payload, filePrefix) {
  const response = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try { message = JSON.parse(text).message || text; } catch { /* use text */ }
    throw new Error(message || '导出失败。');
  }
  const blob = await response.blob();
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${filePrefix}_${new Date().toISOString().replaceAll(':','').slice(0,15)}.csv`;
  document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(link.href);
}

async function initializeApplication() {
  byId('global-refresh').addEventListener('click', route);
  byId('logout-button').addEventListener('click', logout);
  byId('change-password').addEventListener('click', openChangePassword);
  window.addEventListener('hashchange', route);
  await initializeAuth();
}

document.addEventListener('DOMContentLoaded', initializeApplication);

async function openCsvExport(kind, filters = {}) {
  const fieldSets = await api('/internal/exports/fields');
  const fields = kind === 'deliverables' ? fieldSets.deliverables : fieldSets.changes;
  const body = `<form id="csv-export-form">
    <div class="export-toolbar"><label class="check-line"><input id="export-select-all" type="checkbox" checked>全选字段</label><span class="muted">可取消不需要导出的字段</span></div>
    <div class="field-check-grid">${fields.map(x => `<label class="field-check"><input type="checkbox" name="fields" value="${esc(x.code)}" checked><span>${esc(x.name)}</span></label>`).join('')}</div>
  </form>`;
  showModal(kind === 'deliverables' ? '导出交付物台账' : '导出变更记录', body, {
    submitText: '导出CSV', onSubmit: async close => {
      const selected = [...document.querySelectorAll('#csv-export-form input[name="fields"]:checked')].map(x => x.value);
      if (!selected.length) throw new Error('请至少选择一个导出字段。');
      const payload = { fields: selected, ...filters };
      await downloadCsv(`/internal/exports/${kind}`, payload, kind);
      close(); toast('CSV已导出。');
    }
  });
  byId('export-select-all').onchange = event => {
    document.querySelectorAll('#csv-export-form input[name="fields"]').forEach(x => { x.checked = event.target.checked; });
  };
}
