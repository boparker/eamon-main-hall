export function initHelpMenu({
  button = globalThis.document?.getElementById('help-toggle-btn'),
  panel = globalThis.document?.getElementById('help-panel'),
} = {}) {
  if (!button || !panel) return { open() {}, close() {}, toggle() {} };

  function open() {
    panel.hidden = false;
    button.classList.add('active');
    button.setAttribute('aria-expanded', 'true');
  }

  function close() {
    panel.hidden = true;
    button.classList.remove('active');
    button.setAttribute('aria-expanded', 'false');
  }

  function toggle() {
    if (panel.hidden) open();
    else close();
  }

  button.addEventListener('click', toggle);
  button.setAttribute('aria-expanded', 'false');
  close();

  return { open, close, toggle };
}
