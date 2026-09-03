import { useStudio } from '../store'

/**
 * One line of terminal context at the foot of the studio: what the local
 * ComfyUI engine is doing right now. It is the only part of the app whose work
 * continues after the boot splash is gone, and the only one that can hold 12 GB
 * of memory (43 GB once, before the watchdog), so it gets a permanent, honest
 * readout — phase, last line, memory — instead of a spinner.
 */
export function StatusStrip(): React.JSX.Element | null {
  const comfy = useStudio((s) => s.comfy)
  if (!comfy) return null
  const label =
    comfy.phase === 'ready'
      ? comfy.model
        ? `ready · ${comfy.model} warm`
        : 'ready'
      : comfy.phase === 'loading'
        ? `loading ${comfy.model ?? 'model'}…`
        : comfy.phase === 'starting'
          ? 'starting…'
          : comfy.phase === 'error'
            ? 'error'
            : comfy.detail.startsWith('idle')
              ? 'idle'
              : 'off'
  return (
    <div className={`status-strip ${comfy.phase}`} title={comfy.detail}>
      <span className="ss-dot" />
      <span className="ss-name">comfyui</span>
      <span className="ss-label">{label}</span>
      <span className="ss-detail">{comfy.detail}</span>
      {typeof comfy.memGb === 'number' && (
        <span className="ss-mem" title="ComfyUI committed memory — the watchdog unloads at the limit, then kills">
          {comfy.memGb.toFixed(1)} GB
        </span>
      )}
      {comfy.owned && (
        <span className="ss-owned" title="Started by Lyme Hype — stops when the app closes">
          owned
        </span>
      )}
    </div>
  )
}
