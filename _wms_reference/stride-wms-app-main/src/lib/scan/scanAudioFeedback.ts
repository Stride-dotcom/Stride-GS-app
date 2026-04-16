export type ScanAudioFeedbackType = 'success' | 'error';

import { toast } from '@/hooks/use-toast';

let audioContext: AudioContext | null = null;
let audioHintShownInSession = false;

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

function showAudioHintOnce(): void {
  if (audioHintShownInSession) return;
  audioHintShownInSession = true;
  toast({
    title: 'Audio feedback blocked',
    description: 'Tap the scanner once to allow scan sounds on this device.',
    type: 'warning',
  });
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx = window.AudioContext || (window as any).webkitAudioContext;
  if (!Ctx) return null;
  if (!audioContext) audioContext = new Ctx();
  return audioContext;
}

function safeNow(ctx: AudioContext): number {
  // Some WebViews can temporarily report 0; currentTime is still the right source.
  return ctx.currentTime || 0;
}

function playBeep(opts: { ctx: AudioContext; freq: number; durationMs: number; volume: number }) {
  const { ctx, freq, durationMs, volume } = opts;
  const now = safeNow(ctx);
  const duration = Math.max(10, durationMs) / 1000;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, now);

  // Fast attack/decay envelope to avoid clicks.
  const v = Math.max(0.0001, Math.min(volume, 0.6));
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(v, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + duration + 0.02);
}

/**
 * Best-effort scan audio feedback.
 * - On iOS Safari, audio may be blocked until a user gesture (the "Start camera" click often counts).
 * - If audio is blocked or unavailable, this fails silently.
 */
export async function playScanAudioFeedback(type: ScanAudioFeedbackType): Promise<void> {
  try {
    if (!isAudioFeedbackEnabled()) return;

    const ctx = getAudioContext();
    if (!ctx) return;

    // Resume if needed (common on mobile)
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        // ignore
      }
    }
    if (ctx.state === 'suspended') {
      showAudioHintOnce();
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
    // Never block scan flows on audio issues.
    showAudioHintOnce();
  }
}

