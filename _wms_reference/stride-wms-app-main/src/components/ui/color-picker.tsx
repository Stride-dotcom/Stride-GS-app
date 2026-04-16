import { useState, useRef, useCallback, useEffect } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// Preset color grid - common brand colors
const PRESET_COLORS = [
  // Row 1: Reds / Oranges
  '#EF4444', '#F97316', '#FD5A2A', '#E85D2D', '#DC2626', '#B91C1C',
  // Row 2: Yellows / Greens
  '#F59E0B', '#EAB308', '#84CC16', '#22C55E', '#10B981', '#059669',
  // Row 3: Blues
  '#06B6D4', '#0EA5E9', '#3B82F6', '#2563EB', '#1D4ED8', '#1E40AF',
  // Row 4: Purples / Pinks
  '#6366F1', '#8B5CF6', '#A855F7', '#D946EF', '#EC4899', '#F43F5E',
  // Row 5: Neutrals
  '#0F172A', '#334155', '#64748B', '#94A3B8', '#475569', '#1E293B',
];

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  className?: string;
}

export function ColorPicker({ value, onChange, className }: ColorPickerProps) {
  const [hexInput, setHexInput] = useState(value || '#FD5A2A');
  const [hue, setHue] = useState(0);
  const [saturation, setSaturation] = useState(100);
  const [lightness, setLightness] = useState(50);
  const spectrumRef = useRef<HTMLDivElement>(null);
  const hueBarRef = useRef<HTMLDivElement>(null);
  const isDraggingSpectrum = useRef(false);
  const isDraggingHue = useRef(false);

  // Sync hex input when value changes externally
  useEffect(() => {
    if (value && value !== hexInput) {
      setHexInput(value);
      const hsl = hexToHsl(value);
      if (hsl) {
        setHue(hsl.h);
        setSaturation(hsl.s);
        setLightness(hsl.l);
      }
    }
  }, [value]);

  // Initialize HSL from the current value
  useEffect(() => {
    const hsl = hexToHsl(value || '#FD5A2A');
    if (hsl) {
      setHue(hsl.h);
      setSaturation(hsl.s);
      setLightness(hsl.l);
    }
  }, []);

  const updateFromSpectrum = useCallback(
    (clientX: number, clientY: number) => {
      const rect = spectrumRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      const s = Math.round(x * 100);
      const l = Math.round((1 - y) * 50 + (1 - x) * (1 - y) * 50);
      setSaturation(s);
      setLightness(l);
      const hex = hslToHex(hue, s, l);
      setHexInput(hex);
      onChange(hex);
    },
    [hue, onChange]
  );

  const updateFromHueBar = useCallback(
    (clientX: number) => {
      const rect = hueBarRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const h = Math.round(x * 360);
      setHue(h);
      const hex = hslToHex(h, saturation, lightness);
      setHexInput(hex);
      onChange(hex);
    },
    [saturation, lightness, onChange]
  );

  // Mouse handlers for spectrum
  const handleSpectrumMouseDown = (e: React.MouseEvent) => {
    isDraggingSpectrum.current = true;
    updateFromSpectrum(e.clientX, e.clientY);
  };

  // Mouse handlers for hue bar
  const handleHueMouseDown = (e: React.MouseEvent) => {
    isDraggingHue.current = true;
    updateFromHueBar(e.clientX);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingSpectrum.current) {
        updateFromSpectrum(e.clientX, e.clientY);
      }
      if (isDraggingHue.current) {
        updateFromHueBar(e.clientX);
      }
    };
    const handleMouseUp = () => {
      isDraggingSpectrum.current = false;
      isDraggingHue.current = false;
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [updateFromSpectrum, updateFromHueBar]);

  // Touch handlers
  useEffect(() => {
    const spectrumEl = spectrumRef.current;
    const hueBarEl = hueBarRef.current;

    const handleSpectrumTouch = (e: TouchEvent) => {
      e.preventDefault();
      const touch = e.touches[0];
      updateFromSpectrum(touch.clientX, touch.clientY);
    };

    const handleHueTouch = (e: TouchEvent) => {
      e.preventDefault();
      const touch = e.touches[0];
      updateFromHueBar(touch.clientX);
    };

    spectrumEl?.addEventListener('touchmove', handleSpectrumTouch, { passive: false });
    spectrumEl?.addEventListener('touchstart', handleSpectrumTouch, { passive: false });
    hueBarEl?.addEventListener('touchmove', handleHueTouch, { passive: false });
    hueBarEl?.addEventListener('touchstart', handleHueTouch, { passive: false });

    return () => {
      spectrumEl?.removeEventListener('touchmove', handleSpectrumTouch);
      spectrumEl?.removeEventListener('touchstart', handleSpectrumTouch);
      hueBarEl?.removeEventListener('touchmove', handleHueTouch);
      hueBarEl?.removeEventListener('touchstart', handleHueTouch);
    };
  }, [updateFromSpectrum, updateFromHueBar]);

  const handleHexChange = (val: string) => {
    setHexInput(val);
    if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
      onChange(val);
      const hsl = hexToHsl(val);
      if (hsl) {
        setHue(hsl.h);
        setSaturation(hsl.s);
        setLightness(hsl.l);
      }
    }
  };

  const handlePresetClick = (color: string) => {
    setHexInput(color);
    onChange(color);
    const hsl = hexToHsl(color);
    if (hsl) {
      setHue(hsl.h);
      setSaturation(hsl.s);
      setLightness(hsl.l);
    }
  };

  // Compute spectrum cursor position from S/L
  const cursorX = saturation;
  const cursorY = 100 - lightness * 2 + saturation * (100 - lightness * 2) / 100;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex items-center gap-2 h-10 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer hover:bg-accent/5 w-full max-w-xs',
            className
          )}
        >
          <div
            className="w-6 h-6 rounded-md border border-border flex-shrink-0"
            style={{ backgroundColor: value || '#FD5A2A' }}
          />
          <span className="text-foreground font-mono text-sm">{value || '#FD5A2A'}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3 space-y-3" align="start">
        {/* Preset Color Grid */}
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">Presets</p>
          <div className="grid grid-cols-6 gap-1.5">
            {PRESET_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => handlePresetClick(color)}
                className={cn(
                  'w-8 h-8 rounded-md border-2 transition-all hover:scale-110',
                  value === color ? 'border-foreground ring-1 ring-foreground' : 'border-transparent'
                )}
                style={{ backgroundColor: color }}
                title={color}
              />
            ))}
          </div>
        </div>

        {/* Color Spectrum */}
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">Custom</p>
          <div
            ref={spectrumRef}
            className="relative w-full h-36 rounded-lg cursor-crosshair select-none overflow-hidden"
            style={{
              background: `linear-gradient(to bottom, #fff, transparent, #000), linear-gradient(to right, #808080, hsl(${hue}, 100%, 50%))`,
            }}
            onMouseDown={handleSpectrumMouseDown}
          >
            <div
              className="absolute w-4 h-4 border-2 border-white rounded-full shadow-md pointer-events-none"
              style={{
                left: `${cursorX}%`,
                top: `${Math.max(0, Math.min(100, cursorY))}%`,
                transform: 'translate(-50%, -50%)',
                boxShadow: '0 0 0 1px rgba(0,0,0,0.3), 0 2px 4px rgba(0,0,0,0.2)',
              }}
            />
          </div>
        </div>

        {/* Hue Bar */}
        <div
          ref={hueBarRef}
          className="relative w-full h-4 rounded-full cursor-pointer select-none"
          style={{
            background:
              'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)',
          }}
          onMouseDown={handleHueMouseDown}
        >
          <div
            className="absolute top-1/2 w-4 h-4 border-2 border-white rounded-full shadow-md pointer-events-none"
            style={{
              left: `${(hue / 360) * 100}%`,
              transform: 'translate(-50%, -50%)',
              boxShadow: '0 0 0 1px rgba(0,0,0,0.3), 0 2px 4px rgba(0,0,0,0.2)',
              backgroundColor: `hsl(${hue}, 100%, 50%)`,
            }}
          />
        </div>

        {/* Hex Input + Preview */}
        <div className="flex items-center gap-2">
          <div
            className="w-10 h-10 rounded-md border border-border flex-shrink-0"
            style={{ backgroundColor: hexInput }}
          />
          <Input
            value={hexInput}
            onChange={(e) => handleHexChange(e.target.value)}
            placeholder="#FD5A2A"
            className="font-mono text-sm"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

// --- Color conversion utilities ---

function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const match = hex.match(/^#([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})$/);
  if (!match) return null;

  const r = parseInt(match[1], 16) / 255;
  const g = parseInt(match[2], 16) / 255;
  const b = parseInt(match[3], 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToHex(h: number, s: number, l: number): string {
  const sNorm = s / 100;
  const lNorm = l / 100;

  const c = (1 - Math.abs(2 * lNorm - 1)) * sNorm;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lNorm - c / 2;

  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }

  const toHex = (n: number) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, '0');

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}
