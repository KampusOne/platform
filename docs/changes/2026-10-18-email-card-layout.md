# KampusOne email card layout

Date: 18 October 2026

## Design

The shared transactional and broadcast renderer uses one structured email card: a Terracotta brand header, Campus Ink content area, one primary action when applicable, and a dark footer. The layout responds to the user-provided YarnGPT onboarding email reference while retaining KampusOne's official colour palette, Lato/Inter typography, and "Already Ready for School" identity.

- Header: terracotta (#C35D38), high-contrast KampusOne wordmark and tagline.
- Body: Campus Ink (#29231F), peach section label, warm cream title, concise copy. OTP messages have a readable sand code box instead of an unrelated button.
- Main CTA: accessible pill in Deep Terracotta (#A8462E). The account welcome email links to the KampusOne download page.
- Footer: deep neutral (#1C1816), account or subscription context, and campaign-only unsubscribe details.
- Compatibility: inline CSS + table markup for email clients, mobile padding fallback, text wordmark so remote image blocking does not break the email. The existing plain-text alternative remains mandatory.

## Coverage

This update applies to the existing shared renderer for verification, reset, agent login, welcome, exam-awareness, operational and marketing campaigns. No authentication, code validity, sender authority, consent, payment or delivery logic changes.

## Verification

Run `cd server && npm test -- src/lib/email-template.test.ts` in a clean checkout. The new tests check brand colors/structure, welcome CTA, recipient disclosure, link safety, campaign sender identity and unsubscribe links.

Preview in Gmail/Outlook/mobile clients before the production Worker rollout; this commit does not automatically deploy or send emails.
