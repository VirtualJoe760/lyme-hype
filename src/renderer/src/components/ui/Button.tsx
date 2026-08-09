import type { ButtonHTMLAttributes } from 'react'

/**
 * The one button component (user call 2026-08-09: "are those reusable
 * components? they should be"). Variants map onto the app's established
 * button styles so adopting it is a no-regression rename; new surfaces should
 * use this instead of hand-picking classes.
 *
 *  mini          — small bordered action ("Test", "↗ Setup page")
 *  mini-primary  — small accent action ("+ Add", "Export mp4")
 *  block         — full-width secondary ("↑ Upload file")
 *  block-primary — full-width accent hero ("Generate")
 *  dialog        — dialog footer secondary ("Cancel")
 *  dialog-primary— dialog footer confirm ("Save")
 */
export type ButtonVariant =
  | 'mini'
  | 'mini-primary'
  | 'block'
  | 'block-primary'
  | 'dialog'
  | 'dialog-primary'

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  mini: 'conn-mini',
  'mini-primary': 'conn-mini primary-mini',
  block: 'action-btn',
  'block-primary': 'generate-btn',
  dialog: 'btn',
  'dialog-primary': 'btn primary'
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
}

export function Button({ variant = 'mini', className, ...rest }: ButtonProps): React.JSX.Element {
  return <button className={`${VARIANT_CLASS[variant]}${className ? ` ${className}` : ''}`} {...rest} />
}

/** Small non-interactive state chip ("✓ Added", "coming") — visible in every
 *  theme, unlike the bare text span it replaces. */
export function StatusChip(props: {
  kind?: 'ok' | 'muted'
  title?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <span className={`status-chip${props.kind === 'ok' ? ' ok' : ''}`} title={props.title}>
      {props.children}
    </span>
  )
}
