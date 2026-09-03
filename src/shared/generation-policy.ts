/**
 * The generation safeguard's two numbers, shared by main (which enforces them)
 * and the renderer (which explains them). Constants for now; settings later.
 */

/** Below this, a prompt is "thin": too little for a model to pin down subject,
 *  count and framing, which is where hallucinated extra limbs and heads come
 *  from. "A dog walking through a park" is 30 characters. */
export const THIN_PROMPT_CHARS = 60

/** How many times a LOCAL image is regenerated (new seed) after the verifier
 *  rejects it. Local renders are free, so retries cost only time. Billed
 *  connectors are never retried automatically. */
export const LOCAL_VERIFY_RETRIES = 2

export function promptIsThin(prompt: string): boolean {
  const trimmed = prompt.trim()
  return trimmed.length > 0 && trimmed.length < THIN_PROMPT_CHARS
}
