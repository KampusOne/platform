// One-use, branch-scoped source migration. Each edit asserts its reviewed source anchor.
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const touched = [];
function edit(path, transform) {
  const before = readFileSync(path, 'utf8'), after = transform(before);
  assert.notEqual(before, after, `No change made to ${path}`);
  writeFileSync(path, after); touched.push(path);
}
function once(source, before, after) {
  assert.equal(source.split(before).length - 1, 1, `Expected one source anchor: ${before}`);
  return source.replace(before, after);
}
edit('mobile/src/components/visual-system.tsx', (source) => {
  const start = source.indexOf('export function VerifiedBadge(');
  const end = source.indexOf('\nexport function FavoriteButton', start);
  assert.ok(start > 0 && end > start, 'VerifiedBadge function boundary changed');
  return 'import { VerifiedBadge } from "./verified-badge";\n' + source.slice(0, start) + 'export { VerifiedBadge } from "./verified-badge";\n' + source.slice(end);
});
edit('mobile/app/(tabs)/profile.tsx', (source) => {
  source = 'import { hasPublicBadge } from "@/src/lib/public-badges";\n' + source;
  source = once(source, '  verification_status: string | null;', '  verification_status: string | null;\n  public_badge_verified?: boolean | null;');
  const before = `{profile?.verification_status &&
            ["VERIFIED", "APPROVED"].includes(
              profile.verification_status.toUpperCase(),
            ) ? (
              <VerifiedMark status={profile.verification_status} />
            ) : null}`;
  source = once(source, before, '{hasPublicBadge(profile) ? <VerifiedBadge size={16} /> : null}');
  const start = source.indexOf('function VerifiedMark('), end = source.indexOf('\nfunction Meta(', start);
  assert.ok(start > 0 && end > start, 'VerifiedMark boundary changed');
  return source.slice(0, start) + source.slice(end);
});
for (const path of ['server/src/routes/feed-social.ts', 'server/src/routes/feed-experience.ts']) {
  edit(path, (source) => {
    const pattern = /coalesce\((\w+)\.verification_status::text\s*=\s*'VERIFIED',\s*false\)/g;
    assert.ok(pattern.test(source), `Public badge SQL anchor missing in ${path}`);
    return source.replace(pattern, (_, alias) => `coalesce((to_jsonb(${alias})->>'public_badge_verified')::boolean, ${alias}.verification_status::text='VERIFIED', false)`);
  });
}
edit('server/src/app.ts', (source) => {
  source = 'import { publicBadgeAdminRoutes, publicBadgeProfileRoutes } from "./routes/public-badges";\n' + source;
  source = once(source, 'app.route("/v1/student", studentRoutes);', 'app.route("/v1/student", publicBadgeProfileRoutes);\napp.route("/v1/student", studentRoutes);');
  return once(source, 'app.route("/v1/admin", adminRoutes);', 'app.route("/v1/admin/public-badges", publicBadgeAdminRoutes);\napp.route("/v1/admin", adminRoutes);');
});
edit('portal/components/user-detail.tsx', (source) => {
  source = once(source, '"use client";', '"use client";\nimport { PublicBadgeControls } from "./public-badge-controls";');
  return once(source, '<div className="user-detail-grid">', '<div className="user-detail-grid">\n          <PublicBadgeControls key={id} userId={id} />');
});
edit('mobile/src/components/reply-composer.tsx', (source) => {
  source = once(source, 'parent?: FeedComment | null; initialPhoto?: UploadedFile | null;', 'parent?: FeedComment | null | undefined; initialPhoto?: UploadedFile | null | undefined;');
  source = once(source, '({ outlineStyle: "none" } as TextStyle)', '({ outlineWidth: 0, outlineColor: "transparent" } as TextStyle)');
  source = 'import { useWebKeyboardViewport } from "@/src/lib/web-keyboard-viewport";\n' + source;
  source = once(source, '  const { theme, styles } = useThemeStyles(createStyles);', '  const { theme, styles } = useThemeStyles(createStyles);\n  const keyboardViewport = useWebKeyboardViewport();');
  return once(source, '<SafeAreaView style={styles.screen}>', '<SafeAreaView style={[styles.screen, keyboardViewport]}>');
});
edit('mobile/src/lib/comment-replies.ts', (source) => once(source, 'body: "", author_name: "Comment deleted", author_image_url: null, author_username: null,', 'body: "", image_url: null, author_name: "Comment deleted", author_image_url: null, author_username: null,'));
edit('mobile/src/components/comment-thread.tsx', (source) => source.replaceAll('minHeight: 40', 'minHeight: 44').replaceAll('minWidth: 40', 'minWidth: 44'));
edit('mobile/app/post.tsx', (source) => source.replaceAll('minWidth: 40', 'minWidth: 44'));
edit('mobile/src/components/post-like-button.tsx', (source) => {
  source = 'import { compactCount } from "@/src/lib/feed-time";\n' + source;
  return once(source, 'state.count.toLocaleString("en-NG")', 'compactCount(state.count)');
});
edit('tests/feed-post-text.test.mjs', (source) => once(source,
  '  assert.match(source, /post: \\{[^\\n]*paddingVertical: 12/);',
  '  assert.match(source, /post: \\{[^\\n]*paddingTop: 10[^\\n]*paddingBottom: 3/);'));
edit('tests/feed-social.test.mjs', (source) => {
  source = once(source, '  assert.match(source, /requestId: requestId.current/); assert.match(source, /mutationLock.current/);',
    '  const composer = read("mobile/src/components/reply-composer.tsx");\n  assert.match(composer, /requestId: draft.requestId/); assert.match(composer, /requestId: randomUUID\\(\\)/);\n  assert.match(composer, /lock.current/); assert.match(source, /mutationLock.current/);');
  source = once(source, 'assert.match(source, /openComments/);', 'assert.match(source, /openReply/); assert.match(source, /openPost/);');
  return once(source, 'assert.match(source, /post: \\{[^\\n]*paddingVertical: 12/);', 'assert.match(source, /post: \\{[^\\n]*paddingTop: 10[^\\n]*paddingBottom: 3/);');
});
edit('tests/feed-comment-interactions.test.mjs', (source) => once(source, '  assert.match(thread, /comment\\.author_username/);', '  assert.doesNotMatch(thread, /comment\\.author_username/);\n  assert.match(thread, /<RelativeTime value=\\{comment.created_at\\}/);'));
edit('tests/feed-comment-replies.test.mjs', (source) => {
  source = once(source, '  assert.match(ui, /parentCommentId: parentId/);', '  const composer = source("mobile/src/components/reply-composer.tsx");\n  assert.match(composer, /parentCommentId: parent.id/);');
  source = once(source, '  assert.match(ui, /Replying to/);', '  assert.match(composer, /Replying to/);');
  source = once(source, '  assert.match(ui, /accessibilityLabel="Cancel reply"/);', '  assert.match(composer, /accessibilityLabel="Close reply, keep draft"/);');
  source = once(source, '  assert.match(ui, /opened\\.has\\(comment\\.id\\)/);', '  assert.match(ui, /expanded\\.has\\(comment\\.id\\)/);');
  return once(source, "  assert.equal(result[0].body, '');", "  assert.equal(result[0].body, '');\n  assert.equal(result[0].image_url, null);");
});
console.log(JSON.stringify({ modified: touched }, null, 2));
