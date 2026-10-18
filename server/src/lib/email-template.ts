export type TransactionalEmailInput = {
  subject: string;
  label: string;
  heading: string;
  intro: string;
  firstName?: string | null;
  recipientEmail?: string;
  code?: string;
  note?: string;
  actionLabel?: string;
  actionUrl?: string;
};

export type BroadcastEmailInput = {
  subject: string;
  body: string;
  senderName: string;
  kind: "OPERATIONAL" | "MARKETING";
  postalAddress?: string;
  unsubscribeUrl?: string;
  isTest?: boolean;
};

const palette = {
  terracotta: "#C35D38",
  deepTerracotta: "#A8462E",
  clay: "#D9855F",
  peach: "#E9B18E",
  sand: "#F1DFC8",
  cream: "#FBF7F2",
  ink: "#29231F",
  stone: "#9A8D84",
  mutedInk: "#D7CBC3",
  white: "#FFFFFF",
  backdrop: "#221D1A",
  footer: "#1C1816",
  subtle: "#AC9D94",
  line: "#4B403B",
} as const;

export function escapeEmailHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] ?? character);
}

function safeUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function linkifyLine(value: string) {
  const parts = value.split(/(https?:\/\/[^\s<>]+)/gi);
  return parts.map((part) => {
    const url = /^https?:\/\//i.test(part) ? safeUrl(part) : null;
    if (!url) return escapeEmailHtml(part);
    return `<a href="${escapeEmailHtml(url)}" style="color:${palette.peach};text-decoration:underline">${escapeEmailHtml(part)}</a>`;
  }).join("");
}

function renderPlainTextBody(body: string) {
  return body.trim().split(/\n{2,}/).filter(Boolean).map((block) => {
    const lines = block.split("\n");
    if (lines.every((line) => /^\s*[-•]\s+/.test(line))) {
      return `<ul style="margin:0 0 24px;padding:0 0 0 23px;color:${palette.mutedInk};font:400 16px/1.7 Inter,Arial,sans-serif">${lines.map((line) => `<li style="margin:0 0 8px">${linkifyLine(line.replace(/^\s*[-•]\s+/, ""))}</li>`).join("")}</ul>`;
    }
    return `<p style="margin:0 0 24px;color:${palette.mutedInk};font:400 16px/1.7 Inter,Arial,sans-serif">${lines.map(linkifyLine).join("<br>")}</p>`;
  }).join("");
}

function preheader(value: string) {
  return `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all">${escapeEmailHtml(value)}</div>`;
}

// Text stays legible when the recipient's email client blocks external imagery.
// Lato matches the official KampusOne wordmark typography.
function wordmark(color: string, muted: string) {
  return `<div style="font:600 30px/1.1 Lato,Arial,sans-serif;letter-spacing:-.035em;color:${color}">KampusOne</div><div style="margin-top:7px;font:500 11px/1.4 Inter,Arial,sans-serif;letter-spacing:.07em;color:${muted}">Already Ready for School</div>`;
}

function baseOpen(title: string, preview: string) {
  return `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${escapeEmailHtml(title)}</title><style>@media screen and (max-width:640px){.email-header{padding:37px 28px!important}.email-main{padding:44px 28px 46px!important}.email-footer{padding:36px 28px!important}.email-title{font-size:31px!important}}</style></head><body style="margin:0;padding:0;background:${palette.backdrop};color:${palette.cream};-webkit-text-size-adjust:100%;text-size-adjust:100%">${preheader(preview)}<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${palette.backdrop}" style="width:100%;background:${palette.backdrop}"><tr><td align="center" style="padding:38px 15px 44px"><table role="presentation" width="620" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:620px;border-collapse:separate;border-spacing:0"><tr><td class="email-header" bgcolor="${palette.terracotta}" style="padding:46px 48px 45px;background:${palette.terracotta};border-radius:24px 24px 0 0">${wordmark(palette.white, palette.cream)}</td></tr>`;
}

function baseClose(extraFooter = "", footerNote = "You're receiving this because you have a KampusOne account.") {
  return `<tr><td class="email-footer" bgcolor="${palette.footer}" style="padding:43px 48px 46px;background:${palette.footer};border-radius:0 0 24px 24px">${wordmark(palette.cream, palette.peach)}<p style="margin:23px 0 0;font:400 13px/1.65 Inter,Arial,sans-serif;color:${palette.subtle}">${escapeEmailHtml(footerNote)}</p>${extraFooter}<p style="margin:23px 0 0;font:400 12px/1.6 Inter,Arial,sans-serif;color:${palette.subtle}">&copy; KampusOne. All rights reserved.</p></td></tr></table></td></tr></table></body></html>`;
}

function mainContent(contents: string) {
  return `<tr><td class="email-main" bgcolor="${palette.ink}" style="padding:57px 48px 56px;background:${palette.ink}">${contents}</td></tr>`;
}

function label(value: string) {
  return `<p style="margin:0 0 19px;font:700 12px/1.3 Inter,Arial,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:${palette.peach}">${escapeEmailHtml(value)}</p>`;
}

function title(value: string) {
  return `<h1 class="email-title" style="margin:0 0 23px;font:600 37px/1.17 Lato,Arial,sans-serif;letter-spacing:-.03em;color:${palette.cream}">${escapeEmailHtml(value)}</h1>`;
}

function button(value?: string, urlValue?: string) {
  if (!value || !urlValue) return "";
  const href = safeUrl(urlValue);
  if (!href) return "";
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:34px 0 25px"><tr><td bgcolor="${palette.deepTerracotta}" style="border-radius:99px;background:${palette.deepTerracotta}"><a href="${escapeEmailHtml(href)}" style="display:inline-block;padding:17px 33px;border:1px solid ${palette.deepTerracotta};border-radius:99px;background:${palette.deepTerracotta};font:700 16px/1.3 Inter,Arial,sans-serif;color:${palette.white};text-align:center;text-decoration:none">${escapeEmailHtml(value)}</a></td></tr></table>`;
}

function codeBox(code?: string) {
  if (!code) return "";
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:31px 0 26px;width:100%"><tr><td bgcolor="${palette.sand}" style="padding:24px 18px;background:${palette.sand};border-radius:16px;text-align:center"><div style="font:700 11px/1.3 Inter,Arial,sans-serif;letter-spacing:.15em;text-transform:uppercase;color:${palette.deepTerracotta}">Your verification code</div><div style="margin-top:10px;font:700 33px/1.25 Inter,Arial,sans-serif;letter-spacing:.16em;color:${palette.ink}">${escapeEmailHtml(code)}</div></td></tr></table>`;
}

function supportingNote(note?: string) {
  if (!note) return "";
  return `<p style="margin:21px 0 0;padding:21px 0 0;border-top:1px solid ${palette.line};font:400 13px/1.75 Inter,Arial,sans-serif;color:${palette.subtle}">${escapeEmailHtml(note)}</p>`;
}

export function renderTransactionalEmail(input: TransactionalEmailInput) {
  const greeting = input.firstName ? `<p style="margin:0 0 12px;font:600 16px/1.6 Inter,Arial,sans-serif;color:${palette.cream}">Hi ${escapeEmailHtml(input.firstName)},</p>` : "";
  const recipient = input.recipientEmail
    ? `<p style="margin:31px 0 0;font:400 13px/1.75 Inter,Arial,sans-serif;color:${palette.subtle}">Sent to <span style="color:${palette.peach}">${escapeEmailHtml(input.recipientEmail)}</span>. If this wasn't you, <a href="mailto:hello@kampusone.app" style="color:${palette.peach};text-decoration:underline">contact support</a>.</p>`
    : "";
  const contents = label(input.label) + title(input.heading) + greeting +
    `<p style="margin:0;color:${palette.mutedInk};font:400 17px/1.75 Inter,Arial,sans-serif">${escapeEmailHtml(input.intro)}</p>` +
    codeBox(input.code) + button(input.actionLabel, input.actionUrl) + supportingNote(input.note) + recipient;
  const html = baseOpen(input.subject, input.intro) + mainContent(contents) + baseClose();
  const action = input.actionLabel && input.actionUrl && safeUrl(input.actionUrl) ? `${input.actionLabel}: ${input.actionUrl}` : "";
  const text = [input.heading, input.firstName ? `Hi ${input.firstName},` : "", input.intro, input.code ? `Your verification code: ${input.code}` : "", action, input.note ?? "", input.recipientEmail ? `Sent to ${input.recipientEmail}. If this wasn't you, contact hello@kampusone.app.` : "", "KampusOne — Already Ready for School"].filter(Boolean).join("\n\n");
  return { html, text };
}

export function renderBroadcastEmail(input: BroadcastEmailInput) {
  const george = /^george(?:\s+from\s+kampusone)?$/i.test(input.senderName.trim());
  const headingLabel = george ? "George's update" : input.kind === "MARKETING" ? "KampusOne update" : "KampusOne notice";
  const subject = `${input.isTest ? "[Test] " : ""}${input.subject}`;
  const hero = label(`${headingLabel}${input.isTest ? " · Test message" : ""}`) + title(input.subject);
  const signature = george
    ? `<div style="margin-top:35px;padding-top:21px;border-top:1px solid ${palette.line}"><div style="font:600 16px/1.3 Lato,Arial,sans-serif;color:${palette.cream}">George</div><div style="margin-top:5px;font:400 13px/1.4 Inter,Arial,sans-serif;color:${palette.subtle}">KampusOne email agent</div></div>`
    : "";
  const disclosure = "An official KampusOne team message. This sender identity is managed by KampusOne.";
  const unsubscribe = input.kind === "MARKETING" && input.unsubscribeUrl ? safeUrl(input.unsubscribeUrl) : null;
  const marketingFooter = input.kind === "MARKETING"
    ? `<p style="margin:18px 0 0;font:400 12px/1.7 Inter,Arial,sans-serif;color:${palette.subtle}">${input.postalAddress ? `${escapeEmailHtml(input.postalAddress)}<br>` : ""}${unsubscribe ? `<a href="${escapeEmailHtml(unsubscribe)}" style="color:${palette.peach};text-decoration:underline">Unsubscribe from promotional email</a>` : ""}</p>`
    : "";
  const footer = `<p style="margin:17px 0 0;font:400 12px/1.7 Inter,Arial,sans-serif;color:${palette.subtle}">${escapeEmailHtml(disclosure)}</p>${marketingFooter}`;
  const html = baseOpen(subject, input.body.slice(0, 140)) +
    mainContent(hero + renderPlainTextBody(input.body) + signature) +
    baseClose(footer, input.kind === "MARKETING" ? "You're receiving this because you subscribed to KampusOne updates." : "You're receiving this because you have a KampusOne account.");
  const text = [subject, input.body, george ? "George\nKampusOne email agent" : "", disclosure, input.kind === "MARKETING" ? input.postalAddress ?? "" : "", unsubscribe ? `Unsubscribe: ${unsubscribe}` : "", "KampusOne — Already Ready for School"].filter(Boolean).join("\n\n");
  return { html, text };
}
