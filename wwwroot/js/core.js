const state = {
  master: null,
  route: 'dashboard',
  deliverablePage: 1,
  deliverablePageSize: 20,
  lastDeliverableQuery: '',
};

const content = document.getElementById('app-content');
const pageTitle = document.getElementById('page-title');
const pageSubtitle = document.getElementById('page-subtitle');
const modalRoot = document.getElementById('modal-root');
const operatorInput = document.getElementById('operator-name');

operatorInput.value = localStorage.getItem('operatorName') || '系统用户';
operatorInput.addEventListener('change', () => {
  const value = operatorInput.value.trim() || '系统用户';
  operatorInput.value = value;
  localStorage.setItem('operatorName', value);
});

document.getElementById('global-refresh').addEventListener('click', route);
window.addEventListener('hashchange', route);

const esc = value => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const byId = id => document.getElementById(id);
const operatorName = () => operatorInput.value.trim() || '系统用户';
const fmtDate = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
const fmtDateOnly = value => value ? String(value).slice(0, 10) : '—';

const statusNames = {
  DRAFT: '草稿', IN_REVIEW: '评审中', RELEASED: '已发布', SUPERSEDED: '已替代', DEPRECATED: '已废止',
  ACTIVE: '有效', ARCHIVED: '已归档', PENDING_ASSESSMENT: '待评估', APPROVED: '已批准',
  REJECTED: '已驳回', IMPLEMENTING: '实施中', PENDING_VERIFICATION: '待验证', CLOSED: '已关闭'
};
const confidentialityNames = { PUBLIC: '公开', INTERNAL: '内部', CONFIDENTIAL: '秘密', STRICTLY_CONFIDENTIAL: '机密' };
const shareNames = { ALLOWED: '允许分享', APPROVAL_REQUIRED: '审批后允许', PROHIBITED: '禁止分享' };
const statusBadge = status => `<span class="badge ${esc(String(status || '').toLowerCase())}">${esc(statusNames[status] || status || '未发布')}</span>`;

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.message || `请求失败：${response.status}`);
  return data;
}

function toast(message, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  document.getElementById('toast-root').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function setPage(title, subtitle) {
  pageTitle.textContent = title;
  pageSubtitle.textContent = subtitle;
  document.querySelectorAll('.sidebar nav a').forEach(a => a.classList.toggle('active', a.dataset.route === state.route));
}

function showModal(title, bodyHtml, { small = false, submitText = '保存', onSubmit = null } = {}) {
  modalRoot.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal ${small ? 'modal-sm' : ''}">
        <div class="modal-head"><h3>${esc(title)}</h3><button class="modal-close" aria-label="关闭">×</button></div>
        <div class="modal-body">${bodyHtml}</div>
        <div class="modal-foot"><button class="btn btn-light modal-cancel">取消</button>${onSubmit ? `<button class="btn btn-primary modal-submit">${esc(submitText)}</button>` : ''}</div>
      </div>
    </div>`;
  const close = () => modalRoot.replaceChildren();
  modalRoot.querySelector('.modal-close').onclick = close;
  modalRoot.querySelector('.modal-cancel').onclick = close;
  modalRoot.querySelector('.modal-backdrop').addEventListener('click', e => { if (e.target.classList.contains('modal-backdrop')) close(); });
  if (onSubmit) {
    modalRoot.querySelector('.modal-submit').onclick = async () => {
      const button = modalRoot.querySelector('.modal-submit');
      button.disabled = true;
      try { await onSubmit(close); } catch (error) { toast(error.message, 'error'); button.disabled = false; }
    };
  }
  return { close, root: modalRoot.querySelector('.modal') };
}

function optionList(items, selected = '', emptyLabel = '全部') {
  return `<option value="">${esc(emptyLabel)}</option>` + items.map(x => `<option value="${x.id}" ${String(x.id) === String(selected) ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
}

async function loadMaster() {
  state.master = await api('/internal/master-data');
}

async function route() {
  try {
    if (!state.master) await loadMaster();
    const path = location.hash.replace(/^#\/?/, '') || 'dashboard';
    const [routeName, id] = path.split('/');
    state.route = routeName;
    content.innerHTML = '<div class="loading">正在加载…</div>';
    if (routeName === 'dashboard') return renderDashboard();
    if (routeName === 'deliverables' && id) return renderDeliverableDetail(Number(id));
    if (routeName === 'deliverables') return renderDeliverables();
    if (routeName === 'changes') return renderChanges();
    if (routeName === 'settings') return renderSettings();
    location.hash = '#/dashboard';
  } catch (error) {
    content.innerHTML = `<div class="card"><div class="empty">页面加载失败：${esc(error.message)}</div></div>`;
    toast(error.message, 'error');
  }
}
