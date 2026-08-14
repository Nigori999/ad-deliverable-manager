/* V0.9 permission migration guard.
 * The legacy list renderer still contains historical canEdit() checks. This final
 * layer restores the UI from the canonical Permission Code model so custom roles
 * are not dependent on ADMIN/EDITOR/APPROVER role names.
 */
(function () {
  const originalRenderDeliverables = window.renderDeliverables;
  if (typeof originalRenderDeliverables === 'function') {
    window.renderDeliverables = async function () {
      await originalRenderDeliverables();
      const toolbar = byId('new-deliverable')?.parentElement || content.querySelector('.card-head .toolbar');
      if (toolbar && hasPermission('DELIVERY_CREATE') && !byId('new-deliverable')) {
        const button = document.createElement('button');
        button.type = 'button';
        button.id = 'new-deliverable';
        button.className = 'btn btn-primary';
        button.textContent = '+ 新增交付物';
        button.onclick = openDeliverableForm;
        toolbar.prepend(button);
      }
      const exportButton = byId('export-deliverables');
      if (exportButton) exportButton.classList.toggle('hidden', !hasPermission('DELIVERY_EXPORT'));
    };
  }

  // The active change/settings renderer is already permission-code based, but
  // keep export visibility consistent with the canonical permission catalog.
  const originalRenderChanges = window.renderChanges;
  if (typeof originalRenderChanges === 'function') {
    window.renderChanges = async function () {
      await originalRenderChanges();
      const exportButton = byId('export-changes');
      if (exportButton) exportButton.classList.toggle('hidden', !hasPermission('CHANGE_EXPORT'));
    };
  }
})();
