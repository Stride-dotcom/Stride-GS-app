/**
 * Builds a fully branded HTML email from plain text content.
 *
 * Users only edit plain text fields (heading, body with markdown/tokens, CTA).
 * This function wraps that content in a professional HTML email layout with
 * branding pulled from [[token]] values at send time.
 */

// Tokens that produce raw HTML and must NOT be escaped
const HTML_TOKENS = new Set([
  'items_table_html',
  'items_list_html',
  'inspection_findings_table_html',
  'task_services_table_html',
  'repair_actions_table_html',
]);

export interface BrandedEmailOptions {
  heading: string;
  body: string;
  ctaEnabled: boolean;
  ctaLabel: string;
  ctaLink: string;
  accentColor: string;
}

/**
 * Converts the user's plain text body (with markdown and tokens) into HTML.
 *
 * Supports:
 * - **bold** → <strong>
 * - *italic* → <em>
 * - [text](url) → <a>
 * - {size:Npx}text{/size} → <span style="font-size:Npx">
 * - [[html_token]] tokens rendered as raw HTML (not escaped)
 * - Line breaks preserved
 */
export function markdownToEmailHtml(text: string): string {
  // Step 1: Extract and placeholder HTML tokens so they don't get escaped
  const htmlPlaceholders: Record<string, string> = {};
  let placeholderIndex = 0;
  let processed = text.replace(
    /\[\[(\w+_(?:table_html|list_html))\]\]/g,
    (_match, tokenKey) => {
      if (HTML_TOKENS.has(tokenKey)) {
        const placeholder = `__HTML_TOKEN_${placeholderIndex}__`;
        htmlPlaceholders[placeholder] = `[[${tokenKey}]]`;
        placeholderIndex++;
        return placeholder;
      }
      return _match;
    }
  );

  // Step 2: Escape HTML entities in the remaining text
  processed = processed
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Step 3: Apply markdown formatting

  // Font size: {size:Npx}text{/size}
  processed = processed.replace(
    /\{size:(\d+)px\}([\s\S]*?)\{\/size\}/g,
    '<span style="font-size:$1px;line-height:1.5;">$2</span>'
  );

  // Bold: **text**
  processed = processed.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic: *text* (but not inside ** pairs)
  processed = processed.replace(
    /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g,
    '<em>$1</em>'
  );

  // Links: [text](url)
  processed = processed.replace(
    /\[(.+?)\]\((.+?)\)/g,
    '<a href="$2" style="color:#2563eb;text-decoration:underline;">$1</a>'
  );

  // Step 4: Convert line breaks to <br> tags
  processed = processed.replace(/\n/g, '<br>');

  // Step 5: Restore HTML token placeholders
  Object.entries(htmlPlaceholders).forEach(([placeholder, token]) => {
    processed = processed.replace(placeholder, token);
  });

  return processed;
}

/**
 * Builds the complete branded HTML email document.
 *
 * Uses [[token]] placeholders for brand values that get replaced at send time:
 * - [[brand_logo_url]] - Company logo
 * - [[tenant_name]] - Company name
 * - [[brand_support_email]] - Support email
 * - [[portal_base_url]] - Portal URL
 * - [[tenant_company_address]] - Company address
 *
 * The accent color is baked in directly since it's set per-template.
 */
export function buildBrandedEmailHtml(options: BrandedEmailOptions): string {
  const { heading, body, ctaEnabled, ctaLabel, ctaLink, accentColor } = options;
  const bodyHtml = markdownToEmailHtml(body);
  const color = accentColor || '#FD5A2A';

  const ctaSection =
    ctaEnabled && ctaLabel
      ? `
                    <!-- CTA Button -->
                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;">
                      <tr>
                        <td align="center">
                          <table cellpadding="0" cellspacing="0" border="0">
                            <tr>
                              <td style="background-color:${color};border-radius:12px;">
                                <a href="${ctaLink}" target="_blank" style="display:inline-block;padding:14px 32px;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;font-family:'Plus Jakarta Sans',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
                                  ${escapeHtml(ctaLabel)}
                                </a>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      <tr>
                        <td align="center" style="padding-top:10px;">
                          <span style="font-size:11px;color:#94A3B8;">If the button doesn't work, copy this link: <a href="${ctaLink}" style="color:#94A3B8;text-decoration:underline;">${ctaLink}</a></span>
                        </td>
                      </tr>
                    </table>`
      : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${escapeHtml(heading)}</title>
<!--[if mso]>
<style>body,table,td{font-family:Arial,Helvetica,sans-serif !important;}</style>
<![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#F1F5F9;font-family:'Plus Jakarta Sans',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F1F5F9;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table width="680" cellpadding="0" cellspacing="0" border="0" style="max-width:680px;width:100%;">

          <!-- Email Container -->
          <tr>
            <td>
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;border:1px solid #E2E8F0;border-radius:16px;overflow:hidden;">

                <!-- Header: Logo + Brand Name + WMS -->
                <tr>
                  <td style="padding:24px 28px;border-bottom:4px solid ${color};">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="vertical-align:middle;">
                          <img src="[[brand_logo_url]]" alt="[[tenant_name]]" style="height:34px;max-width:180px;vertical-align:middle;" onerror="this.style.display='none'"/>
                        </td>
                        <td style="vertical-align:middle;text-align:right;">
                          <span style="font-size:18px;font-weight:800;color:#0F172A;letter-spacing:-0.2px;font-family:'Plus Jakarta Sans',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">[[tenant_name]]</span>
                          <span style="font-size:18px;font-weight:800;color:${color};letter-spacing:-0.2px;font-family:'Plus Jakarta Sans',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;margin-left:6px;">WMS</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Content Area -->
                <tr>
                  <td style="padding:36px 28px 28px;">

                    <!-- Heading -->
                    <h1 style="margin:0 0 16px;font-size:26px;font-weight:800;color:#0F172A;letter-spacing:-0.3px;line-height:1.2;font-family:'Plus Jakarta Sans',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
                      ${escapeHtml(heading)}
                    </h1>

                    <!-- Body -->
                    <div style="font-size:14px;color:#475569;line-height:1.7;font-family:'Plus Jakarta Sans',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
                      ${bodyHtml}
                    </div>
                    ${ctaSection}
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 28px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="text-align:center;font-family:'Plus Jakarta Sans',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
                    <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#0F172A;">
                      [[tenant_name]]
                    </p>
                    <p style="margin:0 0 4px;font-size:12px;color:#94A3B8;">
                      <a href="[[portal_base_url]]" style="color:#64748B;text-decoration:underline;">Customer Portal</a>
                    </p>
                    <p style="margin:0 0 4px;font-size:12px;color:#94A3B8;">
                      Support: <a href="mailto:[[brand_support_email]]" style="color:#64748B;text-decoration:underline;">[[brand_support_email]]</a>
                    </p>
                    <p style="margin:8px 0 0;font-size:11px;color:#CBD5E1;">
                      [[tenant_company_address]]
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Replaces [[token]] placeholders with values from a data map.
 * Also handles legacy {{token}} format for backwards compatibility.
 * Used for preview (with sample data) and at send time (with real data).
 */
export function replaceTokens(
  text: string,
  data: Record<string, string>
): string {
  let result = text;
  Object.entries(data).forEach(([key, value]) => {
    result = result
      .replace(new RegExp(`\\[\\[${key}\\]\\]`, 'g'), value)
      .replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  });
  return result;
}

/**
 * Detects whether a body_template contains legacy full HTML
 * (from the old buildEmailTemplate() system) rather than plain text.
 */
export function isLegacyHtmlTemplate(body: string): boolean {
  const trimmed = body.trim();
  return (
    trimmed.startsWith('<!DOCTYPE') ||
    trimmed.startsWith('<!doctype') ||
    trimmed.startsWith('<html') ||
    trimmed.startsWith('<HTML') ||
    // Also detect partial HTML templates (v4 style without doctype)
    (trimmed.includes('<table') && trimmed.includes('</table>') && trimmed.includes('style='))
  );
}

/**
 * Extracts plain text content from a legacy full HTML email template.
 * Pulls out the heading, body text, CTA label/link, and converts
 * {{tokens}} to [[tokens]].
 */
export function migrateLegacyHtmlToPlainText(html: string): {
  heading: string;
  body: string;
  ctaLabel: string;
  ctaLink: string;
  subject: string;
} {
  // Normalize token format: {{token}} → [[token]]
  let normalized = html.replace(/\{\{(\w+)\}\}/g, '[[$1]]');

  // Extract heading from <h1> tag
  const h1Match = normalized.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  let heading = '';
  if (h1Match) {
    heading = stripHtmlTags(h1Match[1]).trim();
    // Clean up line breaks from <br> in heading
    heading = heading.replace(/\s*\n\s*/g, ' ').trim();
  }

  // Extract title from <title> tag as fallback heading
  if (!heading) {
    const titleMatch = normalized.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) {
      heading = stripHtmlTags(titleMatch[1]).trim();
    }
  }

  // Extract CTA button label and link
  let ctaLabel = '';
  let ctaLink = '';
  const ctaMatch = normalized.match(/<a[^>]*class=['"]cta['"][^>]*href=['"]([^'"]*)['"]/i)
    || normalized.match(/<a[^>]*href=['"]([^'"]*)['"]\s+[^>]*class=['"]cta['"][^>]*/i)
    || normalized.match(/<td[^>]*background-color[^>]*>\s*<a[^>]*href=['"]([^'"]*)['"][^>]*>([\s\S]*?)<\/a>/i);

  if (ctaMatch) {
    if (ctaMatch[2]) {
      ctaLink = ctaMatch[1];
      ctaLabel = stripHtmlTags(ctaMatch[2]).trim();
    } else {
      ctaLink = ctaMatch[1];
      // Try to get label from the CTA link text
      const ctaLinkMatch = normalized.match(/<a[^>]*class=['"]cta['"][^>]*>([\s\S]*?)<\/a>/i);
      if (ctaLinkMatch) {
        ctaLabel = stripHtmlTags(ctaLinkMatch[1]).trim();
      }
    }
  }

  // Extract body: look for content between description/body markers
  let body = '';

  // Try to find content div/section
  const contentMatch = normalized.match(/<div\s+class=['"]content['"][^>]*>([\s\S]*?)<\/div>\s*<div\s+class=['"]footer/i);
  if (contentMatch) {
    body = extractBodyFromContentHtml(contentMatch[1], heading);
  } else {
    // Fallback: look for <p> tags after <h1>
    const afterH1 = normalized.split(/<\/h1>/i)[1] || '';
    body = extractBodyFromContentHtml(afterH1, heading);
  }

  // Clean up and normalize
  body = body
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Extract subject from title
  let subject = '';
  const titleMatch = normalized.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    subject = `[[tenant_name]]: ${stripHtmlTags(titleMatch[1]).trim()}`;
  }

  return { heading, body, ctaLabel, ctaLink, subject };
}

/**
 * Extract plain text body from an HTML content section.
 * Handles <p>, <div>, badge/meta sections, and preserves tokens.
 */
function extractBodyFromContentHtml(html: string, heading: string): string {
  const lines: string[] = [];

  // Remove the h1 (already extracted as heading)
  let cleaned = html.replace(/<h1[^>]*>[\s\S]*?<\/h1>/gi, '');

  // Remove CTA button and its sub-text
  cleaned = cleaned.replace(/<a[^>]*class=['"]cta['"][\s\S]*?<\/a>/gi, '');
  cleaned = cleaned.replace(/<div[^>]*class=['"]cta-sub['"][\s\S]*?<\/div>/gi, '');

  // Remove divider elements
  cleaned = cleaned.replace(/<div[^>]*class=['"]divider['"][^>]*><\/div>/gi, '');

  // Extract paragraphs
  const pMatches = cleaned.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
  for (const pMatch of pMatches) {
    const text = stripHtmlTags(pMatch).trim();
    if (text && !text.includes('copy/paste this link') && !text.includes('button doesn\'t work')) {
      lines.push(text);
    }
  }

  // Extract badge/meta data (key-value pairs)
  const badgeMatches = cleaned.match(/<span[^>]*class=['"]badge['"][^>]*>([\s\S]*?)<\/span>\s*([\s\S]*?)(?=<(?:div|span)[^>]*class=['"]badge|<\/div>)/gi);
  if (badgeMatches) {
    for (const match of badgeMatches) {
      const labelMatch = match.match(/<span[^>]*class=['"]badge['"][^>]*>([\s\S]*?)<\/span>/i);
      if (labelMatch) {
        const label = stripHtmlTags(labelMatch[1]).trim();
        const afterBadge = match.substring(labelMatch[0].length);
        const value = stripHtmlTags(afterBadge).trim();
        if (label && value) {
          lines.push(`**${label}:** ${value}`);
        }
      }
    }
  }

  // Check for HTML tokens that should be preserved
  const tokenMatches = cleaned.match(/\[\[\w+_(?:table_html|list_html)\]\]/g);
  if (tokenMatches) {
    for (const token of tokenMatches) {
      if (!lines.some(l => l.includes(token))) {
        lines.push('');
        lines.push(token);
      }
    }
  }

  return lines.join('\n');
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Normalizes legacy {{token}} format to [[token]] in any string.
 */
export function normalizeTokenFormat(text: string): string {
  return text.replace(/\{\{(\w+)\}\}/g, '[[$1]]');
}
