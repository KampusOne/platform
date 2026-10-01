export type TransactionalEmailInput = {
  subject: string;
  label: string;
  heading: string;
  intro: string;
  firstName?: string | null;
  code?: string;
  note?: string;
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
  mutedInk: "#685E58",
  white: "#FFFFFF",
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
    const escaped = escapeEmailHtml(url);
    return `<a href="${escaped}" style="color:${palette.deepTerracotta};text-decoration:underline;text-underline-offset:2px">${escapeEmailHtml(part)}</a>`;
  }).join("");
}

function renderPlainTextBody(body: string) {
  const blocks = body.trim().split(/\n{2,}/).filter(Boolean);
  return blocks.map((block) => {
    const lines = block.split("\n");
    if (lines.length > 0 && lines.every((line) => /^\s*[-•]\s+/.test(line))) {
      const items = lines.map((line) => line.replace(/^\s*[-•]\s+/, ""));
      return `<ul style="margin:0 0 22px;padding:0 0 0 22px;color:${palette.mutedInk};font:400 16px/1.7 Inter,Arial,sans-serif">${items.map((item) => `<li style="margin:0 0 8px">${linkifyLine(item)}</li>`).join("")}</ul>`;
    }
    return `<p style="margin:0 0 22px;color:${palette.mutedInk};font:400 16px/1.7 Inter,Arial,sans-serif">${lines.map(linkifyLine).join("<br>")}</p>`;
  }).join("");
}

function preheader(value: string) {
  return `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all">${escapeEmailHtml(value)}</div>`;
}

function wordmark() {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:0 0 28px"><div style="font:600 23px/1 Lato,Arial,sans-serif;letter-spacing:-.02em;color:${palette.ink}">KampusOne</div><div style="margin-top:7px;font:500 11px/1.3 Inter,Arial,sans-serif;letter-spacing:.08em;color:${palette.stone};text-transform:uppercase">Already Ready for School</div></td></tr></table>`;
}

function baseOpen(title: string, preview: string) {
  return `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escapeEmailHtml(title)}</title></head><body style="margin:0;padding:0;background:${palette.cream};color:${palette.ink};-webkit-text-size-adjust:100%;text-size-adjust:100%">${preheader(preview)}<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;background:${palette.cream}"><tr><td align="center" style="padding:40px 18px 28px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:620px">`;
}

function baseClose(extraFooter = "") {
  return `<tr><td style="padding:32px 0 8px;border-top:1px solid ${palette.sand}"><div style="font:600 15px/1.3 Lato,Arial,sans-serif;color:${palette.ink}">KampusOne</div><div style="margin-top:5px;font:400 12px/1.5 Inter,Arial,sans-serif;color:${palette.stone}">Already Ready for School</div>${extraFooter}</td></tr></table></td></tr></table></body></html>`;
}

export function renderTransactionalEmail(input: TransactionalEmailInput) {
  const greeting = input.firstName ? `Hi ${escapeEmailHtml(input.firstName)},` : "Hi there,";
  const codeBlock = input.code ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:28px 0"><tr><td align="center" style="padding:22px 20px;background:${palette.sand};border:1px solid ${palette.peach};border-radius:14px"><div style="font:600 11px/1.2 Inter,Arial,sans-serif;letter-spacing:.12em;color:${palette.mutedInk};text-transform:uppercase">Your code</div><div style="margin-top:10px;font:700 34px/1.1 Inter,Arial,sans-serif;letter-spacing:.2em;color:${palette.ink}">${escapeEmailHtml(input.code)}</div></td></tr></table>` : "";
  const note = input.note ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:26px"><tr><td style="padding:17px 18px;border-left:3px solid ${palette.terracotta};background:${palette.white};font:400 13px/1.6 Inter,Arial,sans-serif;color:${palette.mutedInk}">${escapeEmailHtml(input.note)}</td></tr></table>` : "";
  const html = `${baseOpen(input.subject, input.intro)}<tr><td>${wordmark()}</td></tr><tr><td style="padding:0 0 38px"><div style="font:600 11px/1.2 Inter,Arial,sans-serif;letter-spacing:.12em;color:${palette.terracotta};text-transform:uppercase">${escapeEmailHtml(input.label)}</div><h1 style="margin:12px 0 20px;font:600 36px/1.12 Lato,Arial,sans-serif;letter-spacing:-.025em;color:${palette.ink}">${escapeEmailHtml(input.heading)}</h1><p style="margin:0 0 12px;font:500 16px/1.65 Inter,Arial,sans-serif;color:${palette.ink}">${greeting}</p><p style="margin:0;font:400 16px/1.7 Inter,Arial,sans-serif;color:${palette.mutedInk}">${escapeEmailHtml(input.intro)}</p>${codeBlock}${note}</td></tr>${baseClose()}`;
  const text = [input.heading, greeting, input.intro, input.code ? `Your code: ${input.code}` : "", input.note ?? "", "KampusOne", "Already Ready for School"].filter(Boolean).join("\n\n");
  return { html, text };
}

export function renderBroadcastEmail(input: BroadcastEmailInput) {
  const george = /^george(?:\s+from\s+kampusone)?$/i.test(input.senderName.trim());
  const label = george ? "George's update" : input.kind === "MARKETING" ? "KampusOne update" : "KampusOne notice";
  const title = `${input.isTest ? "[Test] " : ""}${input.subject}`;
  const body = renderPlainTextBody(input.body);
  const hero = input.kind === "MARKETING"
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 30px"><tr><td style="padding:30px 30px 32px;background:${palette.deepTerracotta};border-radius:16px"><div style="font:600 11px/1.2 Inter,Arial,sans-serif;letter-spacing:.12em;color:${palette.sand};text-transform:uppercase">${escapeEmailHtml(label)}${input.isTest ? " · Test message" : ""}</div><h1 style="margin:12px 0 0;font:600 34px/1.15 Lato,Arial,sans-serif;letter-spacing:-.025em;color:${palette.white}">${escapeEmailHtml(input.subject)}</h1></td></tr></table>`
    : `<div style="font:600 11px/1.2 Inter,Arial,sans-serif;letter-spacing:.12em;color:${palette.terracotta};text-transform:uppercase">${escapeEmailHtml(label)}${input.isTest ? " · Test message" : ""}</div><h1 style="margin:12px 0 28px;font:600 36px/1.12 Lato,Arial,sans-serif;letter-spacing:-.025em;color:${palette.ink}">${escapeEmailHtml(input.subject)}</h1>`;
  const signature = george ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:28px 0 0"><tr><td style="padding-top:20px;border-top:1px solid ${palette.sand}"><div style="font:600 16px/1.35 Lato,Arial,sans-serif;color:${palette.ink}">George</div><div style="margin-top:3px;font:400 13px/1.5 Inter,Arial,sans-serif;color:${palette.stone}">KampusOne email agent</div></td></tr></table>` : "";
  const disclosure = "An official KampusOne team message. This sender identity is managed by KampusOne.";
  const marketingFooter = input.kind === "MARKETING" && input.unsubscribeUrl
    ? `<div style="margin-top:16px;font:400 12px/1.65 Inter,Arial,sans-serif;color:${palette.stone}">${input.postalAddress ? `${escapeEmailHtml(input.postalAddress)}<br>` : ""}<a href="${escapeEmailHtml(input.unsubscribeUrl)}" style="color:${palette.deepTerracotta};text-decoration:underline;text-underline-offset:2px">Unsubscribe from promotional email</a></div>`
    : "";
  const footer = `<div style="margin-top:16px;font:400 12px/1.65 Inter,Arial,sans-serif;color:${palette.stone}">${escapeEmailHtml(disclosure)}</div>${marketingFooter}`;
  const html = `${baseOpen(title, input.body.slice(0, 140))}<tr><td>${wordmark()}</td></tr><tr><td style="padding:0 0 38px">${hero}${body}${signature}</td></tr>${baseClose(footer)}`;
  const text = [title, input.body, george ? "George\nKampusOne email agent" : "", disclosure, input.kind === "MARKETING" ? input.postalAddress ?? "" : "", input.kind === "MARKETING" && input.unsubscribeUrl ? `Unsubscribe: ${input.unsubscribeUrl}` : ""].filter(Boolean).join("\n\n");
  return { html, text };
}
