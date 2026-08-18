/* Derive deliverable object code from the selected category; users no longer enter it manually. */
const openDeliverableFormWithManualObjectCode = openDeliverableForm;
openDeliverableForm = function () {
  openDeliverableFormWithManualObjectCode();
  const form = byId('deliverable-form');
  if (!form) return;
  const objectInput = form.elements.objectCode;
  const categorySelect = form.elements.categoryId;
  if (!objectInput || !categorySelect) return;

  const field = objectInput.closest('.field');
  if (field) {
    field.innerHTML = `<label>类别编码</label><div class="derived-code-box"><strong id="derived-object-code">—</strong><small>自动取自所选“交付物类别”的编码，并参与交付物编码生成，无需手工填写。</small></div><input type="hidden" name="objectCode" value="">`;
  }

  const sync = () => {
    const category = state.master.categories.find(x => String(x.id) === String(categorySelect.value));
    const hidden = form.elements.objectCode;
    if (hidden) hidden.value = category?.code || '';
    const display = byId('derived-object-code');
    if (display) display.textContent = category?.code || '—';
  };

  categorySelect.addEventListener('change', sync);
  sync();
};

const renderDeliverableDetailWithObjectCodeLabel = renderDeliverableDetail;
renderDeliverableDetail = async function (id) {
  await renderDeliverableDetailWithObjectCodeLabel(id);
  document.querySelectorAll('.info-item').forEach(item => {
    const label = item.querySelector('span');
    if (label?.textContent === '对象编码') label.textContent = '类别编码';
  });
};
