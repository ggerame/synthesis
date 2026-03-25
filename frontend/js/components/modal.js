/** Custom styled confirm dialog to replace browser-native confirm(). */

let activeModal = null;
let stylesInjected = false;

function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    @keyframes modal-fade-in  { from { opacity: 0 } to { opacity: 1 } }
    @keyframes modal-fade-out { from { opacity: 1 } to { opacity: 0 } }
    @keyframes modal-scale-in  { from { opacity: 0; transform: scale(0.95) } to { opacity: 1; transform: scale(1) } }
    @keyframes modal-scale-out { from { opacity: 1; transform: scale(1) } to { opacity: 0; transform: scale(0.95) } }
  `;
  document.head.appendChild(style);
}

/**
 * Show a styled confirmation modal. Returns a Promise<boolean>.
 * @param {object} opts
 * @param {string} opts.title - Modal heading
 * @param {string} opts.message - Body text (supports \n for line breaks)
 * @param {string} [opts.confirmText='Confirm'] - Confirm button label
 * @param {string} [opts.cancelText='Cancel'] - Cancel button label
 * @param {boolean} [opts.destructive=false] - If true, confirm button uses error/red styling
 */
export function showConfirm({ title, message, confirmText = 'Confirm', cancelText = 'Cancel', destructive = false } = {}) {
  // Dismiss any existing modal
  if (activeModal) {
    activeModal.remove();
    activeModal = null;
  }

  return new Promise((resolve) => {
    injectStyles();
    const backdrop = document.createElement('div');
    backdrop.className = 'fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4';
    backdrop.style.animation = 'modal-fade-in 150ms ease-out';

    const messageParagraphs = (message || '').split('\n').filter(Boolean).map(line => {
      const p = document.createElement('p');
      p.className = 'text-sm text-on-surface-variant leading-relaxed';
      p.textContent = line;
      return p;
    });

    const confirmBtnClass = destructive
      ? 'px-5 py-2.5 bg-error text-on-error rounded-lg font-bold text-sm transition-all hover:brightness-110 active:scale-95'
      : 'px-5 py-2.5 bg-primary text-on-primary rounded-lg font-bold text-sm transition-all hover:brightness-110 active:scale-95';

    const dialog = document.createElement('div');
    dialog.className = 'bg-surface-container rounded-xl max-w-md w-full p-6 sm:p-8 space-y-5 elevation-3';
    dialog.style.animation = 'modal-scale-in 150ms ease-out';

    // Title
    const titleEl = document.createElement('h3');
    titleEl.className = 'text-xl font-bold text-on-surface';
    titleEl.textContent = title || 'Confirm';
    dialog.appendChild(titleEl);

    // Message lines
    const bodyEl = document.createElement('div');
    bodyEl.className = 'space-y-2';
    messageParagraphs.forEach(p => bodyEl.appendChild(p));
    dialog.appendChild(bodyEl);

    // Buttons
    const actions = document.createElement('div');
    actions.className = 'flex justify-end gap-3 pt-2';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'px-5 py-2.5 text-on-surface-variant font-bold text-sm rounded-lg hover:bg-surface-container-high transition-colors active:scale-95';
    cancelBtn.textContent = cancelText;

    const confirmBtn = document.createElement('button');
    confirmBtn.className = confirmBtnClass;
    confirmBtn.textContent = confirmText;

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    dialog.appendChild(actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    activeModal = backdrop;

    confirmBtn.focus();

    function close(result) {
      backdrop.style.animation = 'modal-fade-out 100ms ease-in forwards';
      dialog.style.animation = 'modal-scale-out 100ms ease-in forwards';
      backdrop.addEventListener('animationend', () => {
        backdrop.remove();
        if (activeModal === backdrop) activeModal = null;
      }, { once: true });
      resolve(result);
    }

    cancelBtn.addEventListener('click', () => close(false));
    confirmBtn.addEventListener('click', () => close(true));

    // Close on backdrop click
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close(false);
    });

    // Close on Escape
    function onKey(e) {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', onKey);
        close(false);
      }
    }
    document.addEventListener('keydown', onKey);
  });
}
