/*
 * v0.9 Permission Model Compatibility Bridge
 *
 * v070.js is a legacy feature module that is still loaded by the application and
 * contains the old canEdit()/canApprove() helper calls. The application no longer
 * uses roleCode/hasRole for business authorization, so these helpers are deliberately
 * backed by Permission Code only.
 *
 * This bridge is isolated to the legacy v070 module. It must not introduce any role
 * based authorization logic. When v070 is eventually refactored, this bridge can be
 * removed together with the legacy helper calls.
 */
function canEdit() {
  return hasPermission('CHANGE_CREATE') ||
    hasPermission('CHANGE_EDIT') ||
    hasPermission('CHANGE_START') ||
    hasPermission('CHANGE_VERIFY');
}

function canApprove() {
  return hasPermission('CHANGE_APPROVE') ||
    hasPermission('CHANGE_CLOSE');
}
