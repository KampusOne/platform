import { describe, expect, it } from "vitest";
import { renderBroadcastEmail, renderTransactionalEmail } from "./email-template";

describe("KampusOne email templates", () => {
  it("renders transactional mail as KampusOne with the brand system and escaped personal data", () => {
    const message = renderTransactionalEmail({
      subject: "Verify your KampusOne email",
      label: "Email verification",
      heading: "Verify your email",
      intro: "Use the six digit code below to continue.",
      firstName: "<Gideon>",
      code: "123456",
      note: "This code expires in 10 minutes.",
    });

    expect(message.html).toContain("KampusOne");
    expect(message.html).toContain("Already Ready for School");
    expect(message.html).toContain("#FBF7F2");
    expect(message.html).toContain("#C35D38");
    expect(message.html).toContain("Lato");
    expect(message.html).toContain("Inter");
    expect(message.html).toContain("&lt;Gideon&gt;");
    expect(message.html).toContain("123456");
    expect(message.html).not.toContain("George");
    expect(message.text).toContain("Your code: 123456");
  });

  it("gives George campaign mail a distinct editorial identity without changing KampusOne ownership", () => {
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
    expect(message.text).toContain("George\nKampusOne email agent");
  });

  it("escapes campaign content instead of treating authored copy as HTML", () => {
    const message = renderBroadcastEmail({
      subject: "Update",
      body: "<script>alert(1)</script> & goodbye",
      senderName: "KampusOne",
      kind: "OPERATIONAL",
    });

    expect(message.html).not.toContain("<script>");
    expect(message.html).toContain("&lt;script&gt;");
    expect(message.html).toContain("&amp; goodbye");
  });
});
