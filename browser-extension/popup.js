/* Synthesis – popup menu logic. */

const DEFAULT_ENDPOINT = 'http://localhost:8000';

const toggleBtn = document.getElementById('toggle-btn');
const toggleIcon = document.getElementById('toggle-icon');
const toggleLabel = document.getElementById('toggle-label');

// ── Load state ───────────────────────────────────────────────────────

chrome.storage.sync.get({ enabled: true }, ({ enabled }) => {
  syncToggle(enabled);
});

function syncToggle(enabled) {
  toggleIcon.textContent = enabled ? 'toggle_on' : 'toggle_off';
  toggleLabel.textContent = enabled ? 'Enabled' : 'Disabled';
  toggleBtn.classList.toggle('toggle-off', !enabled);
}

// ── Toggle enable/disable ────────────────────────────────────────────

toggleBtn.addEventListener('click', async () => {
  const { enabled } = await chrome.storage.sync.get({ enabled: true });
  const next = !enabled;
  await chrome.storage.sync.set({ enabled: next });
  syncToggle(next);

  // Notify all YouTube tabs so the content script can show/hide
  const tabs = await chrome.tabs.query({ url: '*://www.youtube.com/*' });
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, { action: 'toggleEnabled', enabled: next }).catch(() => {});
  }
});

// ── Open Dashboard ───────────────────────────────────────────────────

document.getElementById('open-frontend').addEventListener('click', async () => {
  const { endpoint } = await chrome.storage.sync.get({ endpoint: DEFAULT_ENDPOINT });
  chrome.tabs.create({ url: endpoint.replace(/\/+$/, '') + '/' });
  window.close();
});

// ── Open Settings ────────────────────────────────────────────────────

document.getElementById('open-settings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});
