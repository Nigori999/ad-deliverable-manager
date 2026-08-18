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
    field.innerHTML = `<label>对象编码</label><div class="derived-code-box"><strong id="derived-object-code">—</strong><small>自动取自“交付物类别编码”，用于生成交付物编码，无需手工填写。</small></div><input type="hidden" name="objectCode" value="">`;
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
