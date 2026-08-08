import './secure.css'

// The credential window must never navigate away from itself — a dropped file
// or link would otherwise load foreign content that still carries secureBridge.
// The main process blocks the navigation too; this stops the drop at the source.
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => e.preventDefault())

interface SecureBridge {
  init(): Promise<{ connectorName: string; fieldLabel: string } | null>
  submit(value: string): Promise<boolean>
  cancel(): void
}

declare global {
  interface Window {
    secureBridge?: SecureBridge
  }
}

const root = document.getElementById('secure-root')!

async function boot(): Promise<void> {
  const secure = window.secureBridge
  if (!secure) {
    root.innerHTML = `<div class="secure-frame"><p class="secure-error">This window only works inside Lyme Hype.</p></div>`
    return
  }

  const request = await secure.init()
  if (!request) {
    root.innerHTML = `<div class="secure-frame"><p class="secure-error">Stale credential request — close this window.</p></div>`
    return
  }

  root.innerHTML = `
    <div class="secure-frame">
      <div class="secure-head">
        <span class="secure-lock">●</span>
        <span>Secure credential — ${escapeHtml(request.connectorName)}</span>
      </div>
      <p class="secure-copy">
        Paste the <strong>${escapeHtml(request.fieldLabel)}</strong> below. It is encrypted with
        Windows DPAPI and never shown to the agent — only its length and last 4 characters are
        reported back.
      </p>
      <input id="secret-input" type="password" autocomplete="off" spellcheck="false"
             placeholder="${escapeHtml(request.fieldLabel)}" />
      <div class="secure-actions">
        <button id="cancel-btn" type="button">Cancel</button>
        <button id="save-btn" type="button" disabled>Save securely</button>
      </div>
    </div>`

  const input = document.getElementById('secret-input') as HTMLInputElement
  const saveBtn = document.getElementById('save-btn') as HTMLButtonElement
  const cancelBtn = document.getElementById('cancel-btn') as HTMLButtonElement

  input.focus()
  input.addEventListener('input', () => {
    saveBtn.disabled = input.value.length === 0
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.length > 0) void save()
    if (e.key === 'Escape') secure.cancel()
  })
  saveBtn.addEventListener('click', () => void save())
  cancelBtn.addEventListener('click', () => secure.cancel())

  async function save(): Promise<void> {
    saveBtn.disabled = true
    const ok = await secure!.submit(input.value)
    if (!ok) {
      saveBtn.disabled = false
    }
    // On success the main process closes this window.
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

void boot()
