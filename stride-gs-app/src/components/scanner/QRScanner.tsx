/**
 * QRScanner.tsx — Camera-backed barcode/QR scanner component (session 68).
 *
 * Ported from the production Stride WMS app, rewritten to use inline theme
 * styles + lucide icons for GS Inventory. Dual-path:
 *   1. Native BarcodeDetector API (Chrome/Edge on desktop + Android, iOS 16.4+)
 *      — fast, low CPU, supports 10+ formats.
 *   2. html5-qrcode fallback for older browsers / iOS < 16.4.
 *
 * Supported formats: QR, CODE_128, CODE_39, CODE_93, EAN_13/8, UPC_A/E,
 * DATA_MATRIX, PDF_417. Covers every label Stride prints.
 *
 * Features:
 *   • Tap-to-start overlay (browsers require a user gesture for camera)
 *   • Animated orange corner brackets + scan line + "SENSOR ACTIVE" chip
 *   • 400 ms repeat dedupe (holding a barcode in frame won't spam onScan)
 *   • Auto-stops on unmount and when `scanning=false`
 *   • Graceful degraded states: denied / error / unsupported with retry
 *   • `paused` prop to ignore scans temporarily without killing the stream
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, RefreshCw, CameraOff, Loader2, ExternalLink } from 'lucide-react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { theme } from '../../styles/theme';
import { hapticScan } from '../../lib/scanAudioFeedback';

// ── BarcodeDetector ambient typing (Chrome/Edge/Android/iOS 16.4+) ─────
interface DetectedBarcode { rawValue: string; format: string; }
interface BarcodeDetectorCtorOpts { formats?: string[] }
interface BarcodeDetectorInstance { detect(source: HTMLVideoElement): Promise<DetectedBarcode[]> }
declare global {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-var
  var BarcodeDetector: (new (opts?: BarcodeDetectorCtorOpts) => BarcodeDetectorInstance) | undefined;
}

const SUPPORTED_FORMATS: Html5QrcodeSupportedFormats[] = [
  Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.CODE_93,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.DATA_MATRIX,
  Html5QrcodeSupportedFormats.PDF_417,
];

const NATIVE_FORMATS = [
  'qr_code', 'code_128', 'code_39', 'code_93',
  'ean_13', 'ean_8', 'upc_a', 'upc_e',
  'data_matrix', 'pdf417',
];

type Status = 'idle' | 'starting' | 'active' | 'denied' | 'error' | 'unsupported';

const DEFAULT_CONSTRAINTS: MediaStreamConstraints = {
  video: { facingMode: 'environment' },
  audio: false,
};

function isEmbeddedFrame(): boolean {
  try { return window.self !== window.top; } catch { return true; }
}
function getLegacyGetUserMedia(): ((c: MediaStreamConstraints, ok: (s: MediaStream) => void, err: (e: unknown) => void) => void) | null {
  const nav = navigator as unknown as Record<string, unknown>;
  return (nav.getUserMedia || nav.webkitGetUserMedia || nav.mozGetUserMedia || nav.msGetUserMedia) as typeof getLegacyGetUserMedia extends () => infer R ? R : never || null;
}
async function getUserMediaCompat(constraints: MediaStreamConstraints): Promise<MediaStream> {
  if (navigator.mediaDevices?.getUserMedia) return navigator.mediaDevices.getUserMedia(constraints);
  const legacy = getLegacyGetUserMedia();
  if (!legacy) throw new Error('getUserMedia is not available in this browser');
  return new Promise<MediaStream>((resolve, reject) => {
    try { legacy.call(navigator, constraints, resolve, reject); } catch (e) { reject(e); }
  });
}
function isCameraBlockedByEmbed(): boolean {
  if (!isEmbeddedFrame()) return false;
  const modern = !!navigator.mediaDevices?.getUserMedia;
  const legacy = !!getLegacyGetUserMedia();
  return !modern && !legacy;
}

// ── Styles ─────────────────────────────────────────────────────────────
const s = {
  wrap: {
    position: 'relative' as const,
    width: '100%',
    aspectRatio: '1 / 1',
    maxWidth: 360,
    borderRadius: 14,
    overflow: 'hidden',
    background: '#111',
  } as React.CSSProperties,
  video: {
    width: '100%',
    height: '100%',
    objectFit: 'cover' as const,
    display: 'block',
  } as React.CSSProperties,
  corner: (pos: 'tl' | 'tr' | 'bl' | 'br') => ({
    position: 'absolute' as const,
    width: 42, height: 42,
    [pos === 'tl' || pos === 'tr' ? 'top' : 'bottom']: 14,
    [pos === 'tl' || pos === 'bl' ? 'left' : 'right']: 14,
    borderColor: theme.colors.primary,
    borderStyle: 'solid' as const,
    borderTopWidth:    pos === 'tl' || pos === 'tr' ? 4 : 0,
    borderBottomWidth: pos === 'bl' || pos === 'br' ? 4 : 0,
    borderLeftWidth:   pos === 'tl' || pos === 'bl' ? 4 : 0,
    borderRightWidth:  pos === 'tr' || pos === 'br' ? 4 : 0,
    borderRadius:
      pos === 'tl' ? '14px 0 0 0'
      : pos === 'tr' ? '0 14px 0 0'
      : pos === 'bl' ? '0 0 0 14px'
      : '0 0 14px 0',
    boxShadow: `0 0 14px ${theme.colors.primary}88`,
    pointerEvents: 'none' as const,
  }) as React.CSSProperties,
  scanLine: {
    position: 'absolute' as const,
    left: '12%', right: '12%',
    height: 3,
    background: `linear-gradient(to right, transparent, ${theme.colors.primary}, transparent)`,
    borderRadius: 99,
    boxShadow: `0 0 20px ${theme.colors.primary}aa`,
    animation: 'stride-scan 1.8s ease-in-out infinite',
    pointerEvents: 'none' as const,
  } as React.CSSProperties,
  chip: {
    position: 'absolute' as const,
    top: 10,
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 12px',
    borderRadius: 99,
    background: 'rgba(255,255,255,0.92)',
    backdropFilter: 'blur(4px)',
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.05em',
    color: theme.colors.primary,
    textTransform: 'uppercase' as const,
  } as React.CSSProperties,
  chipDot: {
    width: 7, height: 7,
    borderRadius: '50%',
    background: theme.colors.primary,
    animation: 'stride-pulse 1.2s ease-in-out infinite',
  } as React.CSSProperties,
  overlay: {
    position: 'absolute' as const,
    inset: 0,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(30,30,30,0.92)',
    color: '#fff',
    padding: 20,
    textAlign: 'center' as const,
    gap: 10,
  } as React.CSSProperties,
  btnPrimary: {
    padding: '10px 18px',
    fontSize: 13,
    fontWeight: 600,
    background: theme.colors.primary,
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    fontFamily: 'inherit',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  } as React.CSSProperties,
  btnOutline: {
    padding: '8px 14px',
    fontSize: 12,
    fontWeight: 500,
    background: 'transparent',
    color: '#fff',
    border: '1px solid rgba(255,255,255,0.5)',
    borderRadius: 8,
    cursor: 'pointer',
    fontFamily: 'inherit',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  } as React.CSSProperties,
};

const KEYFRAMES = `
@keyframes stride-scan {
  0%, 100% { top: 14%; }
  50%      { top: 86%; }
}
@keyframes stride-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.4; transform: scale(1.3); }
}
`;

// ── Props ──────────────────────────────────────────────────────────────
export interface QRScannerProps {
  onScan: (data: string) => void;
  onError?: (error: string) => void;
  /** When false, camera is fully stopped */
  scanning?: boolean;
  /** When true, ignore scan results but keep camera active */
  paused?: boolean;
  /** Explicit close button handler; also stops the camera */
  onStop?: () => void;
}

// ── Component ──────────────────────────────────────────────────────────
export function QRScanner({ onScan, onError, scanning = true, paused = false, onStop }: QRScannerProps) {
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [usingFallback, setUsingFallback] = useState(false);

  const isCameraBlocked = useMemo(() => isCameraBlockedByEmbed(), []);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const detectorRef = useRef<BarcodeDetectorInstance | null>(null);
  const detectInFlightRef = useRef(false);
  const html5QrRef = useRef<Html5Qrcode | null>(null);
  const containerIdRef = useRef<string>(`qr-scanner-${Math.random().toString(36).slice(2, 9)}`);

  const lastScannedRef = useRef<string>('');
  const lastScanTimeRef = useRef<number>(0);
  const pausedRef = useRef(false);
  pausedRef.current = !!paused;

  const stopCamera = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    detectInFlightRef.current = false;

    if (html5QrRef.current) {
      const scanner = html5QrRef.current;
      html5QrRef.current = null;
      try {
        const state = scanner.getState();
        if (state === 2 || state === 3) {
          scanner.stop().catch(() => { /* ignore */ });
        }
      } catch { /* ignore */ }
    }

    const stream = streamRef.current;
    if (stream) stream.getTracks().forEach(t => t.stop());
    streamRef.current = null;

    const video = videoRef.current;
    if (video) {
      try { (video as HTMLVideoElement & { srcObject: MediaStream | null }).srcObject = null; } catch { /* ignore */ }
      video.removeAttribute('src');
    }

    setStatus('idle');
    setUsingFallback(false);
  }, []);

  const handleScanSuccess = useCallback((decodedText: string) => {
    if (pausedRef.current) return;
    const now = Date.now();
    if (decodedText !== lastScannedRef.current || now - lastScanTimeRef.current > 400) {
      lastScannedRef.current = decodedText;
      lastScanTimeRef.current = now;
      hapticScan();
      onScan(decodedText);
    }
  }, [onScan]);

  const startDetectLoop = useCallback(() => {
    const video = videoRef.current;
    const detector = detectorRef.current;
    if (!video || !detector) return;

    const tick = async () => {
      if (!scanning || !streamRef.current) return;
      if (!pausedRef.current && !detectInFlightRef.current && video.readyState >= 2) {
        detectInFlightRef.current = true;
        try {
          const barcodes = await detector.detect(video);
          const first = barcodes?.[0];
          const value = first?.rawValue ? String(first.rawValue) : '';
          if (value) handleScanSuccess(value);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[QRScanner] detect error', e);
        } finally {
          detectInFlightRef.current = false;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, [handleScanSuccess, scanning]);

  const startFallbackScanner = useCallback(async () => {
    // eslint-disable-next-line no-console
    console.info('[QRScanner] using html5-qrcode fallback');
    setUsingFallback(true);
    setStatus('starting');
    await new Promise(r => setTimeout(r, 100)); // let DOM mount

    try {
      const h5 = new Html5Qrcode(containerIdRef.current, { formatsToSupport: SUPPORTED_FORMATS, verbose: false });
      html5QrRef.current = h5;
      await h5.start(
        { facingMode: 'environment' },
        { fps: 15, qrbox: { width: 250, height: 250 }, aspectRatio: 1 },
        handleScanSuccess,
        () => { /* ignore per-frame no-match */ }
      );
      setStatus('active');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      setStatus('error');
      setUsingFallback(false);
      onError?.(msg);
    }
  }, [handleScanSuccess, onError]);

  const startCamera = useCallback(async () => {
    if (!scanning) return;
    setStatus('starting');
    setErrorMessage('');

    const hasModern = !!navigator.mediaDevices?.getUserMedia;
    const hasLegacy = !!getLegacyGetUserMedia();
    if (!hasModern && !hasLegacy) {
      const msg = 'Camera not available in this browser';
      setStatus('unsupported');
      setErrorMessage(msg);
      onError?.(msg);
      return;
    }

    stopCamera();

    const hasNativeBarcodeDetector = typeof BarcodeDetector !== 'undefined';
    if (!hasNativeBarcodeDetector) {
      await startFallbackScanner();
      return;
    }

    try {
      const stream = await getUserMediaCompat(DEFAULT_CONSTRAINTS);
      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) throw new Error('Video element not mounted');
      video.autoplay = true;
      video.muted = true;
      (video as HTMLVideoElement & { playsInline: boolean }).playsInline = true;
      (video as HTMLVideoElement & { srcObject: MediaStream | null }).srcObject = stream;
      await video.play();

      try {
        detectorRef.current = new BarcodeDetector!({ formats: NATIVE_FORMATS });
      } catch {
        try { detectorRef.current = new BarcodeDetector!({ formats: ['qr_code'] }); }
        catch { detectorRef.current = null; }
      }

      if (!detectorRef.current) {
        streamRef.current?.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        await startFallbackScanner();
        return;
      }

      setStatus('active');
      startDetectLoop();
    } catch (err: unknown) {
      const name = (err as { name?: string })?.name || 'Error';
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      setStatus(name.toLowerCase().includes('notallowed') || name.toLowerCase().includes('permission') ? 'denied' : 'error');
      onError?.(msg);
      stopCamera();
    }
  }, [scanning, stopCamera, startDetectLoop, startFallbackScanner, onError]);

  useEffect(() => () => stopCamera(), [stopCamera]);
  useEffect(() => { if (!scanning) stopCamera(); }, [scanning, stopCamera]);

  return (
    <div style={s.wrap}>
      <style>{KEYFRAMES}</style>

      <video ref={videoRef} style={{ ...s.video, display: usingFallback ? 'none' : 'block' }} playsInline />
      <div id={containerIdRef.current} style={{ width: '100%', height: '100%', display: usingFallback ? 'block' : 'none' }} />

      {/* Corner brackets + scan line when active */}
      {status === 'active' && (
        <>
          <div style={s.corner('tl')} />
          <div style={s.corner('tr')} />
          <div style={s.corner('bl')} />
          <div style={s.corner('br')} />
          <div style={s.scanLine} />
          <div style={s.chip}>
            <span style={s.chipDot} />
            Sensor active
          </div>
          {onStop && (
            <button
              onClick={() => { stopCamera(); onStop(); }}
              style={{
                position: 'absolute', top: 10, right: 10,
                padding: '4px 10px', fontSize: 11, fontWeight: 600,
                background: 'rgba(0,0,0,0.6)', color: '#fff',
                border: 'none', borderRadius: 6, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontFamily: 'inherit',
              }}
            >
              <CameraOff size={12} /> Stop
            </button>
          )}
        </>
      )}

      {/* Tap-to-start */}
      {scanning && !isCameraBlocked && (status === 'idle' || status === 'starting') && (
        <div style={s.overlay}>
          {status === 'starting'
            ? <Loader2 size={38} color={theme.colors.primary} style={{ animation: 'spin 1s linear infinite' }} />
            : <Camera size={38} color={theme.colors.primary} />}
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Start camera</div>
            <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>Needed for QR scanning</div>
          </div>
          <button onClick={startCamera} disabled={status === 'starting'} style={s.btnPrimary}>
            <Camera size={14} /> {status === 'starting' ? 'Starting…' : 'Start camera'}
          </button>
        </div>
      )}

      {/* Embedded iframe blocked */}
      {scanning && isCameraBlocked && status === 'idle' && (
        <div style={s.overlay}>
          <CameraOff size={38} opacity={0.6} />
          <div style={{ fontSize: 14, fontWeight: 600 }}>Camera unavailable in preview</div>
          <div style={{ fontSize: 12, opacity: 0.8, maxWidth: 280 }}>
            Browsers block camera access inside embedded previews. Open the scanner in a new tab.
          </div>
          <button
            style={s.btnOutline}
            onClick={() => window.open(window.location.href, '_blank', 'noopener,noreferrer')}
          >
            <ExternalLink size={12} /> Open in new tab
          </button>
        </div>
      )}

      {/* Denied */}
      {scanning && status === 'denied' && (
        <div style={s.overlay}>
          <CameraOff size={38} color="#EF4444" />
          <div style={{ fontSize: 14, fontWeight: 600 }}>Camera blocked</div>
          <div style={{ fontSize: 12, opacity: 0.8, maxWidth: 280 }}>
            Check your browser's site permissions and allow camera access.
          </div>
          <button style={s.btnOutline} onClick={startCamera}>
            <RefreshCw size={12} /> Try again
          </button>
        </div>
      )}

      {/* Error / unsupported */}
      {scanning && (status === 'error' || status === 'unsupported') && (
        <div style={s.overlay}>
          <CameraOff size={38} opacity={0.6} />
          <div style={{ fontSize: 14, fontWeight: 600 }}>Camera failed</div>
          {errorMessage && <div style={{ fontSize: 12, opacity: 0.8, maxWidth: 280 }}>{errorMessage}</div>}
          <button style={s.btnOutline} onClick={startCamera}>
            <RefreshCw size={12} /> Try again
          </button>
        </div>
      )}
    </div>
  );
}
