# KampusOne email design system refresh

Date: 1 October 2026

## What changed

- Transactional authentication email now always presents the sender as **KampusOne**, even when the configured verified mailbox includes another display name.
- Verification, password reset, agent sign-in and welcome messages share one reusable brand renderer instead of maintaining one-off HTML.
- The renderer follows the current KampusOne brand system: Warm Cream canvas, Terracotta accents, Campus Ink text, Lato display typography, Inter body typography, short line lengths and one dominant message hierarchy.
- Campaign email uses the same renderer and now has two intentional voices. **KampusOne** is the official brand sender. **George from KampusOne** is the managed editorial voice for promotions, product updates and community communication.
- George messages receive a distinct editorial treatment and signature while preserving the existing disclosure that the sender identity is managed by KampusOne.
- Promotional messages retain the required postal address, visible unsubscribe link and one-click unsubscribe headers. Auth and security messages remain outside promotional consent rules.
- Plain-text alternatives are generated alongside HTML for transactional mail as well as campaign mail.
- Authored campaign copy remains escaped. Plain HTTP/HTTPS links are made clickable and simple bullet paragraphs are rendered as accessible lists without accepting arbitrary HTML.

## Sender rules

- Email verification, password reset, one-time sign-in codes and account welcome messages: **KampusOne**.
- Promotions, product announcements and community updates: **George from KampusOne** by default when an administrator selects George, with **KampusOne** still available as an alternative sender.
- Additional managed sender identities remain supported by the existing audited admin workflow.

## Brand and client constraints

The template uses table-based layout and inline styles for broad email-client compatibility. It deliberately avoids web-app visual tropes such as glass panels, neon gradients and card grids. No externally hosted hero image is required for the core template, so blocked remote images do not break message hierarchy.

## Release notes

The new `20261001040000_email_sender_personas.sql` migration seeds George as a managed sender persona. Apply it before expecting George to appear as a selectable campaign sender in production. The Worker code can deploy independently; existing KampusOne campaign and transactional sending continues to work if the migration has not yet been applied.
