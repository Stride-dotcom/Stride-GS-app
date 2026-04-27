import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, X, Link2, Code2 } from 'lucide-react';
import { theme } from '../../styles/theme';

/**
 * SharePublicPageDialog — reusable share modal for public-facing pages.
 *
 * Two tabs:
 *   • Link  — full URL with one-click copy
 *   • Embed — iframe HTML snippet with editable width/height; the
 *             snippet updates live as the user adjusts the dimensions.
 *
 * Inline copy feedback (Check icon + "Copied" label that auto-clears
 * after 2s) follows the same pattern as PriceList's share-link copy.
 * The repo has no global toast system; if one is added later, swap the
 * inline confirmation for a toast call here.
 */

export interface SharePublicPageDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  url: string;
  /** Short description shown above the tabs. Defaults to a generic line. */
  description?: string;
}

type Tab = 'link' | 'embed';

// Escape any character that would let a value break out of an HTML
// attribute. Today's call sites pass app-controlled URLs only, but the
// component is reusable and width/height take user input — so we run
// every interpolated value through the same escape to keep the snippet
// well-formed and inert if a future caller passes anything weirder.
function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildEmbedSnippet(url: string, width: string, height: string): string {
  const safeWidth = width.trim() || '100%';
  const safeHeight = height.trim() || '800px';
  return `<iframe src="${escapeAttr(url)}" width="${escapeAttr(safeWidth)}" height="${escapeAttr(safeHeight)}" frameborder="0" style="border:0;" loading="lazy"></iframe>`;
}

export function SharePublicPageDialog({
  open,
  onClose,
  title,
  url,
  description = 'Share a public link or paste the embed snippet into your site.',
}: SharePublicPageDialogProps) {
  const [tab, setTab] = useState<Tab>('link');
  const [width, setWidth] = useState('100%');
  const [height, setHeight] = useState('800px');
  const [copiedTarget, setCopiedTarget] = useState<'link' | 'embed' | null>(null);

  const embedSnippet = useMemo(() => buildEmbedSnippet(url, width, height), [url, width, height]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function copyToClipboard(text: string, target: 'link' | 'embed') {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Legacy fallback for non-secure contexts. try/finally so the
        // hidden textarea is always removed even if execCommand throws.
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        try {
          ta.select();
          document.execCommand('copy');
        } finally {
          document.body.removeChild(ta);
        }
      }
      setCopiedTarget(target);
      setTimeout(() => setCopiedTarget(curr => (curr === target ? null : curr)), 2000);
    } catch (e) {
      console.warn('[SharePublicPageDialog] clipboard write failed:', e);
    }
  }

  const tabBtn = (which: Tab): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '8px 14px', borderRadius: 100,
    border: tab === which ? 'none' : `1px solid ${theme.colors.border}`,
    background: tab === which ? theme.colors.primary : '#fff',
    color: tab === which ? '#fff' : theme.colors.textSecondary,
    fontSize: 11, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase',
    cursor: 'pointer', fontFamily: 'inherit',
  });

  const fieldLabel: React.CSSProperties = {
    display: 'block', fontSize: 11, fontWeight: 600,
    color: theme.colors.textSecondary, marginBottom: 6,
    textTransform: 'uppercase', letterSpacing: '0.5px',
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px', borderRadius: 8,
    border: `1px solid ${theme.colors.border}`, background: '#fff',
    fontSize: 13, fontFamily: 'inherit', color: theme.colors.text,
    boxSizing: 'border-box',
  };

  function CopyButton({ target, value }: { target: 'link' | 'embed'; value: string }) {
    const isCopied = copiedTarget === target;
    return (
      <button
        type="button"
        onClick={() => copyToClipboard(value, target)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '10px 16px', borderRadius: 100,
          border: 'none',
          background: isCopied ? '#10B981' : theme.colors.primary,
          color: '#fff',
          fontSize: 11, fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase',
          cursor: 'pointer', fontFamily: 'inherit',
          transition: 'background 0.18s ease',
          whiteSpace: 'nowrap',
        }}
      >
        {isCopied ? <Check size={13} /> : <Copy size={13} />}
        {isCopied ? 'Copied' : 'Copy'}
      </button>
    );
  }

  return createPortal(
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(15, 23, 42, 0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16, fontFamily: theme.typography.fontFamily,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          background: '#fff', borderRadius: 20, width: '100%', maxWidth: 540,
          boxShadow: '0 24px 60px rgba(0,0,0,0.25)', overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', borderBottom: `1px solid ${theme.colors.border}`,
        }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: theme.colors.text }}>{title}</span>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: theme.colors.textMuted, padding: 4,
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '18px' }}>
          <div style={{ fontSize: 12, color: theme.colors.textSecondary, marginBottom: 14, lineHeight: 1.5 }}>
            {description}
          </div>

          {/* Tab switcher */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button type="button" onClick={() => setTab('link')} style={tabBtn('link')}>
              <Link2 size={12} /> Link
            </button>
            <button type="button" onClick={() => setTab('embed')} style={tabBtn('embed')}>
              <Code2 size={12} /> Embed
            </button>
          </div>

          {tab === 'link' && (
            <div>
              <label style={fieldLabel}>Public URL</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                <input
                  type="text"
                  value={url}
                  readOnly
                  onFocus={e => e.currentTarget.select()}
                  style={{ ...inputStyle, flex: 1 }}
                />
                <CopyButton target="link" value={url} />
              </div>
              <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 8 }}>
                Anyone with this link can view the page — no login required.
              </div>
            </div>
          )}

          {tab === 'embed' && (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div>
                  <label style={fieldLabel} htmlFor="share-embed-width">Width</label>
                  <input
                    id="share-embed-width"
                    type="text"
                    value={width}
                    onChange={e => setWidth(e.target.value)}
                    placeholder="100%"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={fieldLabel} htmlFor="share-embed-height">Height</label>
                  <input
                    id="share-embed-height"
                    type="text"
                    value={height}
                    onChange={e => setHeight(e.target.value)}
                    placeholder="800px"
                    style={inputStyle}
                  />
                </div>
              </div>

              <label style={fieldLabel}>Embed snippet</label>
              <textarea
                value={embedSnippet}
                readOnly
                rows={4}
                onFocus={e => e.currentTarget.select()}
                style={{
                  ...inputStyle,
                  fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontSize: 12,
                  resize: 'vertical',
                  minHeight: 88,
                  whiteSpace: 'pre',
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                <CopyButton target="embed" value={embedSnippet} />
              </div>
              <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 8 }}>
                Paste this HTML into any web page to embed the public view.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
