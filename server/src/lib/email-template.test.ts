import { describe, expect, it } from "vitest";
import { renderBroadcastEmail, renderTransactionalEmail } from "./email-template";

describe("KampusOne email templates", () => {
  it("uses the reference layout: terracotta logo header, dark content, action and footer", () => {
    const message = renderTransactionalEmail({
      subject: "Welcome to KampusOne",
      label: "Welcome aboard",
      heading: "You're already ready.",
      intro: "Your account is verified. Your campus, all in one.",
      firstName: "Gideon",
      recipientEmail: "gideon@example.com",
      actionLabel: "Open KampusOne",
      actionUrl: "https://kampusone.app/download",
    });

    expect(message.html).toContain('bgcolor="#C35D38"');
    expect(message.html).toContain('bgcolor="#29231F"');
    expect(message.html).toContain('bgcolor="#1C1816"');
    expect(message.html).toContain("border-radius:24px 24px 0 0");
    expect(message.html).toContain("Open KampusOne");
    expect(message.html).toContain("https://kampusone.app/download");
    expect(message.html).toContain("gideon@example.com");
    expect(message.html).toContain("Already Ready for School");
    expect(message.html).toContain("Lato");
    expect(message.html).toContain("Inter");
    expect(message.text).toContain("Open KampusOne: https://kampusone.app/download");
  });

  it("escapes personal data, protects codes, and omits unsafe action URLs", () => {
    const message = renderTransactionalEmail({
      subject: "Verify your email",
      label: "Email verification",
      heading: "Verify your email",
      intro: "Use the code below.",
      firstName: "<Gideon>",
      recipientEmail: '<test@example.com>',
      code: "12<456",
      note: "Expires in 10 minutes & is single-use.",
      actionLabel: "Unsafe action",
      actionUrl: "javascript:alert(1)",
    });

    expect(message.html).toContain("&lt;Gideon&gt;");
    expect(message.html).toContain("&lt;test@example.com&gt;");
    expect(message.html).toContain("12&lt;456");
    expect(message.html).toContain("Expires in 10 minutes &amp; is single-use.");
    expect(message.html).not.toContain("javascript:alert");
    expect(message.html).not.toContain("Unsafe action");
    expect(message.text).toContain("Your verification code: 12<456");
  });

  it("preserves George's editorial signature, branded layout, disclosures and unsubscribe", () => {
    const message = renderBroadcastEmail({
      subject: "What changed in KampusOne this week",
      body: "George here. A few things changed around KampusOne.\n\n- Faster feed loading\n- Better timetable reminders",
      senderName: "George from KampusOne",
      kind: "MARKETING",
      postalAddress: "1 Campus Road",
      unsubscribeUrl: "https://api.kampusone.app/v1/email/unsubscribe/example",
    });

    expect(message.html).toContain("George&#39;s update");
    expect(message.html).toContain("KampusOne email agent");
    expect(message.html).toContain("This sender identity is managed by KampusOne.");
    expect(message.html).toContain("1 Campus Road");
    expect(message.html).toContain("Unsubscribe from promotional email");
    expect(message.html).toContain('bgcolor="#C35D38"');
    expect(message.text).toContain("George\nKampusOne email agent");
  });

  it("escapes campaign HTML instead of executing authored copy", () => {
    const message = renderBroadcastEmail({
      subject: "Update",
      body: "<script>alert(1)</script> & goodbye",
      senderName: "KampusOne",
      kind: "OPERATIONAL",
    });

    expect(message.html).not.toContain("<script>");
    expect(message.html).toContain("&lt;script&gt;");
    expect(message.html).toContain("&amp; goodbye");
    expect(message.html).not.toContain("Unsubscribe from promotional email");
  });
});
