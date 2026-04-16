const HTML_TOKEN_PATTERN = /\[\[(\w+_(?:table_html|list_html|section_html))\]\]/g;

export const DEFAULT_PLATFORM_EMAIL_WRAPPER = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>{{subject}}</title>
  <!--[if mso]>
  <style>body,table,td{font-family:Arial,Helvetica,sans-serif !important;}</style>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#F1F5F9;font-family:'Plus Jakarta Sans',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;">
  <span style="display:none;max-height:0;max-width:0;opacity:0;overflow:hidden;line-height:1px;color:transparent;">{{preheader}}</span>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F1F5F9;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table width="680" cellpadding="0" cellspacing="0" border="0" style="max-width:680px;width:100%;">
          <tr>
            <td>
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;border:1px solid #E2E8F0;border-radius:16px;overflow:hidden;">
                <tr>
                  <td style="padding:24px 28px;border-bottom:4px solid {{accent_color}};">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="vertical-align:middle;">
                          <img src="[[brand_logo_url]]" alt="[[tenant_name]]" style="height:34px;max-width:180px;vertical-align:middle;" onerror="this.style.display='none'" />
                        </td>
                        <td style="vertical-align:middle;text-align:right;">
                          <span style="font-size:18px;font-weight:800;color:#0F172A;letter-spacing:-0.2px;">[[tenant_name]]</span>
                          <span style="font-size:18px;font-weight:800;color:{{accent_color}};letter-spacing:-0.2px;margin-left:6px;">WMS</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:36px 28px 28px;">
                    {{test_banner}}
                    <h1 style="margin:0 0 16px;font-size:26px;font-weight:800;color:#0F172A;letter-spacing:-0.3px;line-height:1.2;">
                      {{heading}}
                    </h1>
                    <div style="font-size:14px;color:#475569;line-height:1.7;">
                      {{content}}
                    </div>
                    {{cta_section}}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 28px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="text-align:center;">
                    <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#0F172A;">[[tenant_name]]</p>
                    <p style="margin:0 0 4px;font-size:12px;color:#94A3B8;">
                      <a href="[[portal_base_url]]" style="color:#64748B;text-decoration:underline;">Customer Portal</a>
                    </p>
                    <p style="margin:0 0 4px;font-size:12px;color:#94A3B8;">
                      Support: <a href="mailto:[[brand_support_email]]" style="color:#64748B;text-decoration:underline;">[[brand_support_email]]</a>
                    </p>
                    <p style="margin:8px 0 0;font-size:11px;color:#CBD5E1;">[[tenant_company_address]]</p>
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

function escapeHtml(value: string): string {
  return (value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function normalizeEditorJson(editorJson: unknown): Record<string, unknown> {
  if (editorJson && typeof editorJson === "object" && !Array.isArray(editorJson)) {
    return editorJson as Record<string, unknown>;
  }
  if (typeof editorJson === "string") {
    try {
      const parsed = JSON.parse(editorJson);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Keep fallback
    }
  }
  return {};
}

function getEditorString(editor: Record<string, unknown>, key: string): string {
  const value = editor[key];
  return typeof value === "string" ? value : "";
}

function getEditorBoolean(editor: Record<string, unknown>, key: string): boolean {
  return editor[key] === true;
}

function isLikelyHtmlBody(body: string): boolean {
  const trimmed = (body || "").trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<!doctype")) return true;
  if (trimmed.startsWith("<html") || trimmed.startsWith("<HTML")) return true;
  return /<\/?[a-z][\s\S]*>/i.test(trimmed);
}

export function isFullHtmlDocument(body: string): boolean {
  const trimmed = (body || "").trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<!doctype")) return true;
  if (trimmed.startsWith("<html") || trimmed.startsWith("<HTML")) return true;
  return /<html[\s>]/i.test(trimmed) && /<\/html>/i.test(trimmed);
}

function injectBannerIntoFullHtmlDocument(html: string, bannerHtml: string): string {
  if (!bannerHtml.trim()) return html;
  if (/<body[^>]*>/i.test(html)) {
    return html.replace(/<body([^>]*)>/i, (match, attrs) => `${match}\n${bannerHtml}`);
  }
  return `${bannerHtml}${html}`;
}

function stripHtmlTags(html: string): string {
  return decodeHtmlEntities(
    (html || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<\/tr>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

export function markdownToEmailHtml(text: string): string {
  const htmlPlaceholders: Record<string, string> = {};
  let placeholderIndex = 0;

  let processed = (text || "").replace(HTML_TOKEN_PATTERN, (fullMatch, tokenKey) => {
    const placeholder = `__HTML_TOKEN_${placeholderIndex}__`;
    htmlPlaceholders[placeholder] = `[[${tokenKey}]]`;
    placeholderIndex += 1;
    return placeholder;
  });

  processed = processed
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  processed = processed.replace(
    /\{size:(\d+)px\}([\s\S]*?)\{\/size\}/g,
    '<span style="font-size:$1px;line-height:1.5;">$2</span>',
  );
  processed = processed.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  processed = processed.replace(
    /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g,
    "<em>$1</em>",
  );
  processed = processed.replace(
    /\[(.+?)\]\((.+?)\)/g,
    '<a href="$2" style="color:#2563eb;text-decoration:underline;">$1</a>',
  );
  processed = processed.replace(/\n/g, "<br>");

  for (const [placeholder, token] of Object.entries(htmlPlaceholders)) {
    processed = processed.replace(placeholder, token);
  }

  return processed;
}

function buildCtaSection(ctaLabel: string, ctaLink: string, accentColor: string): string {
  if (!ctaLabel.trim()) return "";

  const safeLabel = escapeHtml(ctaLabel.trim());
  const safeLink = ctaLink.trim() ? escapeHtmlAttribute(ctaLink.trim()) : "#";
  const safeColor = escapeHtmlAttribute(accentColor || "#FD5A2A");

  return `
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;">
  <tr>
    <td align="center">
      <table cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="background-color:${safeColor};border-radius:12px;">
            <a href="${safeLink}" target="_blank" style="display:inline-block;padding:14px 32px;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;">
              ${safeLabel}
            </a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
  <tr>
    <td align="center" style="padding-top:10px;">
      <span style="font-size:11px;color:#94A3B8;">If the button does not work, copy this link: <a href="${safeLink}" style="color:#94A3B8;text-decoration:underline;">${safeLink}</a></span>
    </td>
  </tr>
</table>`;
}

function ensureWrapperTemplate(value: string | null | undefined): string {
  const trimmed = (value || "").trim();
  if (!trimmed || !trimmed.includes("{{content}}")) {
    return DEFAULT_PLATFORM_EMAIL_WRAPPER;
  }
  return trimmed;
}

function applyWrapperTemplate(
  wrapperHtml: string,
  values: {
    subject: string;
    preheader: string;
    heading: string;
    content: string;
    accentColor: string;
    ctaSection: string;
    testBanner: string;
  },
): string {
  const hasCtaPlaceholder = wrapperHtml.includes("{{cta_section}}");
  const hasBannerPlaceholder = wrapperHtml.includes("{{test_banner}}");

  const contentWithExtras =
    `${hasBannerPlaceholder ? "" : values.testBanner}${values.content}${hasCtaPlaceholder ? "" : values.ctaSection}`;

  const replacements: Record<string, string> = {
    subject: escapeHtml(values.subject),
    preheader: escapeHtml(values.preheader),
    heading: escapeHtml(values.heading),
    content: contentWithExtras,
    accent_color: escapeHtmlAttribute(values.accentColor),
    cta_section: values.ctaSection,
    test_banner: values.testBanner,
  };

  let rendered = wrapperHtml;
  for (const [key, replacement] of Object.entries(replacements)) {
    rendered = rendered.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), replacement);
  }
  return rendered;
}

function buildTestBannerHtml(): string {
  return `
<div style="background:#fef3c7;border:1px solid #f59e0b;padding:12px;text-align:center;border-radius:8px;margin:0 0 20px 0;">
  <strong>TEST EMAIL</strong> - This is a preview of your email template
</div>`;
}

export interface RenderBrandedEmailOptions {
  subject: string;
  bodyTemplate: string;
  bodyFormat?: string | null;
  editorJson?: unknown;
  accentColor?: string | null;
  wrapperHtmlTemplate?: string | null;
  includeTestBanner?: boolean;
}

export interface RenderBrandedEmailResult {
  html: string;
  text: string;
  usedWrapper: boolean;
}

export function renderBrandedEmail(options: RenderBrandedEmailOptions): RenderBrandedEmailResult {
  const rawBody = options.bodyTemplate || "";
  const normalizedFormat = options.bodyFormat === "html" || options.bodyFormat === "text"
    ? options.bodyFormat
    : isLikelyHtmlBody(rawBody)
      ? "html"
      : "text";

  const editor = normalizeEditorJson(options.editorJson);
  const heading = getEditorString(editor, "heading").trim() || options.subject || "Notification";
  const ctaEnabled = getEditorBoolean(editor, "cta_enabled");
  const ctaLabel = getEditorString(editor, "cta_label");
  const ctaLink = getEditorString(editor, "cta_link");
  const accentColor = (options.accentColor || "").trim() || "#FD5A2A";
  const ctaSection = ctaEnabled ? buildCtaSection(ctaLabel, ctaLink, accentColor) : "";
  const testBanner = options.includeTestBanner ? buildTestBannerHtml() : "";
  const wrapperTemplate = ensureWrapperTemplate(options.wrapperHtmlTemplate);

  if (normalizedFormat === "html") {
    if (isFullHtmlDocument(rawBody)) {
      const htmlDoc = options.includeTestBanner
        ? injectBannerIntoFullHtmlDocument(rawBody, testBanner)
        : rawBody;
      return {
        html: htmlDoc,
        text: stripHtmlTags(rawBody),
        usedWrapper: false,
      };
    }

    const wrappedHtml = applyWrapperTemplate(wrapperTemplate, {
      subject: options.subject || heading,
      preheader: heading,
      heading,
      content: rawBody,
      accentColor,
      ctaSection,
      testBanner,
    });
    return {
      html: wrappedHtml,
      text: stripHtmlTags(rawBody),
      usedWrapper: true,
    };
  }

  const bodyHtml = markdownToEmailHtml(rawBody);
  const wrappedHtml = applyWrapperTemplate(wrapperTemplate, {
    subject: options.subject || heading,
    preheader: heading,
    heading,
    content: bodyHtml,
    accentColor,
    ctaSection,
    testBanner,
  });
  const textWithCta = ctaEnabled && ctaLabel.trim()
    ? `${rawBody}\n\n${ctaLabel.trim()}: ${ctaLink.trim()}`.trim()
    : rawBody.trim();
  return {
    html: wrappedHtml,
    text: stripHtmlTags(markdownToEmailHtml(textWithCta)),
    usedWrapper: true,
  };
}

export async function resolvePlatformEmailWrapperTemplate(serviceClient: any): Promise<string | null> {
  try {
    const { data, error } = await serviceClient
      .from("platform_email_settings")
      .select("wrapper_html_template")
      .eq("id", 1)
      .maybeSingle();

    if (error) {
      console.warn("[email-branding] Failed to load wrapper template:", error.message);
      return null;
    }

    const candidate = typeof data?.wrapper_html_template === "string"
      ? data.wrapper_html_template.trim()
      : "";
    if (!candidate || !candidate.includes("{{content}}")) {
      return null;
    }

    return candidate;
  } catch (err) {
    console.warn("[email-branding] Unexpected error loading wrapper template:", err);
    return null;
  }
}
