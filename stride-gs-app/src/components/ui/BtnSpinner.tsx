/**
 * Tiny inline spinner for use INSIDE a button while its async action is in
 * flight. Pair with a label change ("Saving…", "Sending…") so the user gets
 * both motion + text feedback.
 *
 * Usage:
 *   <button disabled={saving}>
 *     {saving && <BtnSpinner />}
 *     {saving ? 'Saving…' : 'Save'}
 *   </button>
 *
 * Keyframes are injected once on first import so callers don't need a local
 * <style> block.
 */

const KEYFRAMES_ID = 'stride-btn-spinner-shared-kf';
if (typeof document !== 'undefined' && !document.getElementById(KEYFRAMES_ID)) {
  const s = document.createElement('style');
  s.id = KEYFRAMES_ID;
  s.textContent = `@keyframes stride-btn-spinner-shared { to { transform: rotate(360deg); } }`;
  document.head.appendChild(s);
}

interface Props {
  /** Pixel size of the spinner. Default 12, matches small buttons. */
  size?: number;
  /** Override the spinner color. Defaults to currentColor so it follows button text. */
  color?: string;
  /** Margin-right in px. Default 0 — caller controls layout via flex gap. */
  marginRight?: number;
}

export function BtnSpinner({ size = 12, color, marginRight = 0 }: Props) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        border: `2px solid ${color ?? 'currentColor'}`,
        borderTopColor: 'transparent',
        animation: 'stride-btn-spinner-shared 0.7s linear infinite',
        flexShrink: 0,
        marginRight,
        verticalAlign: 'middle',
      }}
    />
  );
}
