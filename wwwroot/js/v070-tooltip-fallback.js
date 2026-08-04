function infoTipV070(text) {
  const value = esc(text).replaceAll('\n', '&#10;');
  return `<span class="info-tip" tabindex="0" aria-label="${value}" title="${value}" data-tooltip="${value}">i</span>`;
}
