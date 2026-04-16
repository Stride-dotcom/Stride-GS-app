/**
 * scanAudioFeedback.ts — WebAudio beeps for scan confirmation.
 *
 * Ported from the production Stride WMS app (session 68). Success = single
 * 880Hz 120ms sine. Error = two lower-pitch beeps.
 *
 * iOS Safari suspends audio context until a user gesture — the Start-camera
 * tap counts, so by the time the first scan fires audio is live. If the
 * context is still suspended after a scan we log a console hint and skip
 * the beep rather than blocking the scan flow.
 *
 * Opt-out: set localStorage['stride.scan_audio_feedback_enabled'] = 'false'.
 */
export type ScanAudioFeedbackType = 'success' | 'error';

let audioContext: AudioContext | null = null;
let audioHintLogged = false;

function isAudioFeedbackEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = localStorage.getItem('stride.scan_audio_feedback_enabled');
    if (raw == null) return true;
    return raw.trim().toLowerCase() !== 'false';
  } catch {
    return true;
  }
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!audioContext) audioContext = new Ctx();
  return audioContext;
}

function playBeep(opts: { ctx: AudioContext; freq: number; durationMs: number; volume: number }) {
  const { ctx, freq, durationMs, volume } = opts;
  const now = ctx.currentTime || 0;
  const duration = Math.max(10, durationMs) / 1000;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, now);

  const v = Math.max(0.0001, Math.min(volume, 0.6));
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(v, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + duration + 0.02);
}

/** Play a short beep. Safe to call rapidly — never blocks. */
export async function playScanAudioFeedback(type: ScanAudioFeedbackType): Promise<void> {
  try {
    if (!isAudioFeedbackEnabled()) return;
    const ctx = getAudioContext();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch { /* ignore */ }
    }
    if (ctx.state === 'suspended') {
      if (!audioHintLogged) {
        audioHintLogged = true;
        // eslint-disable-next-line no-console
        console.info('[scan audio] suspended — tap page once to enable scan sounds');
      }
      return;
    }

    if (type === 'success') {
      playBeep({ ctx, freq: 880, durationMs: 120, volume: 0.18 });
      return;
    }

    // error: two lower beeps
    playBeep({ ctx, freq: 220, durationMs: 140, volume: 0.22 });
    setTimeout(() => {
      const ctx2 = getAudioContext();
      if (!ctx2) return;
      playBeep({ ctx: ctx2, freq: 150, durationMs: 220, volume: 0.22 });
    }, 200);
  } catch {
    /* never block scan flow on audio errors */
  }
}

/** Short haptic buzz if the device supports it. */
export function hapticScan(): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(20);
    }
  } catch { /* ignore */ }
}
