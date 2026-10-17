import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

// Full exported app with local, synthetic API responses. All remote traffic is
// intercepted: no production login, purchase, review or profile is modified.
const root = resolve(import.meta.dirname, '..');
const evidence = process.env.UI_EVIDENCE_DIR || resolve(root, 'browser-evidence/resource-order');
const modulePath = process.env.PLAYWRIGHT_MODULE;
if (!modulePath) throw Error('Set PLAYWRIGHT_MODULE to the installed Playwright entry point.');
const { chromium } = await import(pathToFileURL(modulePath).href);
mkdirSync(evidence, { recursive: true });
const user = { id: '00000000-0000-4000-8000-000000000001', universityId: '00000000-0000-4000-8000-000000000002', roles: ['STUDENT'], operatorRoles: [], email: 'ui-fixture@example.invalid' };
const resourceId = '00000000-0000-4000-8000-000000000003', tutorId = '00000000-0000-4000-8000-000000000004', orderId = '00000000-0000-4000-8000-000000000005';
const vendorId = '00000000-0000-4000-8000-000000000007';
const brand = { id: vendorId, agent_type: 'VENDOR', display_name: 'Campus Audio', profile_image_url: 'http://localhost:8100/__fixture/avatar.png', verified: true };
const vendorProfile = { service: { ...brand, user_id: tutorId, owner_name: 'Synthetic owner', username: 'campusaudio', biography: 'Headphones, speakers and accessories for campus life.', categories: ['Electronics'], follower_count: 12, followed: false, product_count: 0, tutorial_count: 0, completed_trip_count: 0, rating: 0, review_count: 0 }, products: [], tutorials: [], reviews: [], commerceAvailable: false, isOwner: false };
const resourceBase = { id: resourceId, title: 'Fluid mechanics', description: 'Understand how fluids behave at rest and in motion, with worked examples for engineering students.', publisher_name: 'An old publisher', tutor_name: 'Gideon Igiehon', tutor_profile_id: tutorId, tutor_image_url: 'http://localhost:8100/__fixture/avatar.png', tutor_verified: true, is_saved: false, resource_type: 'PDF', page_count: 18, course_code: 'GET', subject: 'Engineering', access_model: 'FREE', can_access: true, price_kobo: 0, preview_text: null, listing_id: null, cover_url: 'http://localhost:8100/__fixture/cover.png' };
const orderBase = { id: orderId, vendor_name: 'Gid', status: 'DELIVERED', fulfilment_mode: 'PICKUP', total_kobo: 31300, subtotal_kobo: 30000, delivery_fee_kobo: 0, created_at: '2026-10-15T09:00:00Z', delivery_location: 'Pickup from Gid', pickup_location: 'Faculty of Engineering, main entrance', pickup_instructions: null };
const items = [{ product_id: '00000000-0000-4000-8000-000000000006', name: 'Engineering notebook', image_url: 'http://localhost:8100/__fixture/cover.png', quantity: 1, unit_price_kobo: 30000 }];
const defaultTimeline = [{ status: 'PAID', occurred_at: '2026-10-15T09:00:00Z' }, { status: 'ACCEPTED', occurred_at: '2026-10-15T09:03:00Z' }, { status: 'READY', occurred_at: '2026-10-15T09:12:00Z' }, { status: 'DELIVERED', occurred_at: '2026-10-15T09:20:00Z' }];
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf', '.json': 'application/json' };
const web = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost:8100').pathname;
  if (path.startsWith('/__fixture/')) {
    const file = resolve(root, path.endsWith('avatar.png') ? 'mobile/assets/illustrations/auth-study-v2.png' : 'mobile/assets/brand-scenes/tutorials.png');
    res.setHeader('Content-Type', 'image/png'); res.end(readFileSync(file)); return;
  }
  let file = resolve(root, 'mobile/dist', path === '/' ? 'index.html' : '.' + path);
  if (!extname(file) && existsSync(file + '.html')) file += '.html';
  if (!file.startsWith(resolve(root, 'mobile/dist') + '/') || !existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream'); res.end(readFileSync(file));
});
await new Promise(done => web.listen(8100, '127.0.0.1', done));
let browser;
const results = [];
try {
  browser = await chromium.launch({ headless: true });
  async function scenario({ width = 390, dark = false, resource = {}, order = {}, timeline = defaultTimeline, pickupReady = true } = {}) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, locale: 'en-NG', timezoneId: 'Africa/Lagos', reducedMotion: 'reduce' });
    await context.addInitScript(mode => localStorage.setItem('k1.appearance', mode), dark ? 'dark' : 'light');
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.stack ?? e.message));
    let currentResource = { ...resourceBase, ...resource }, reviews = [], saveCalls = 0, lastQuote = null;
    await context.route('**/*', async route => {
      const url = new URL(route.request().url()), path = url.pathname;
      if (path.startsWith('/v1/')) {
        const headers = { 'Access-Control-Allow-Origin': 'http://localhost:8100', 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'authorization,content-type,x-device-label', 'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS', 'Cache-Control': 'no-store' };
        if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
        let body;
        if (path === '/v1/auth/refresh') body = { accessToken: 'synthetic-local-fixture', refreshToken: 'synthetic-local-fixture', expiresIn: 3600, refreshExpiresIn: 86400, user };
        else if (path === '/v1/student/me') body = { profile: { id: user.id, display_name: 'UI fixture student', university_id: user.universityId, university_name: 'Synthetic university', onboarding_completed_at: '2026-10-01T00:00:00Z', settings: {} } };
        else if (path === `/v1/student/tutorial-resources/${resourceId}`) body = { resource: currentResource };
        else if (path === `/v1/student/tutorial-resources/${resourceId}/save`) { saveCalls++; currentResource.is_saved = route.request().postDataJSON().saved; body = { saved: currentResource.is_saved }; }
        else if (path === `/v1/student/orders/${orderId}`) body = { order: { ...orderBase, ...order }, items, reviews, timeline };
        else if (path === '/v1/student/product-reviews') { const payload = route.request().postDataJSON(); reviews = [{ product_id: payload.productId, rating: payload.rating, body: payload.body }]; body = { id: 'synthetic-review' }; }
        else if (path === '/v1/student/catalog') body = { universities: [{ id: user.universityId, name: 'Synthetic university' }], faculties: [], departments: [] };
        else if (path === '/v1/featured-brands/public') body = { brands: [brand, { ...brand, id: tutorId, display_name: 'Legacy brand', verified: false }] };
        else if (path === '/v1/student/store') body = { products: [{ id: items[0].product_id, vendor_profile_id: vendorId, name: 'Campus headphones', description: 'Comfortable wired headphones.', category: 'Electronics', vendor_name: brand.display_name, price_kobo: 250000, stock_quantity: 3, image_url: null, pickup_enabled: true, pickup_location: 'Faculty of Engineering entrance', rider_pickup_ready: pickupReady }], deliveryZones: [{ id: vendorId, name: 'Ugbowo campus', base_fee_kobo: 0 }], checkoutEnabled: true, riderDeliveryEnabled: true, catalogueMode: 'LIVE' };
        else if (path === '/v1/student/pickup-hubs') body = { hubs: [] };
        else if (path === '/v1/student/delivery-places') body = url.searchParams.has('cursor') ? { places: [{ id: tutorId, name: 'Physical Science Shopping Complex', campus_name: 'Ugbowo campus', search_aliases: ['Science shops', 'Physical Sciences'], delivery_zone_id: vendorId, has_map_point: true }], nextCursor: null } : { places: Array.from({ length: 200 }, (_,n) => ({ id: `10000000-0000-4000-8000-${String(n).padStart(12,'0')}`, name: `Campus location ${n}`, campus_name: 'Ugbowo campus', has_map_point: true, delivery_zone_id: vendorId })), nextCursor: vendorId };
        else if (path === '/v1/student/order-quotes') { lastQuote = route.request().postDataJSON(); body = { quote: { id: orderId, expiresAt: new Date(Date.now()+120000).toISOString(), pricing: { listedItemsKobo: 250000, discountKobo: 0, fareKobo: 50000, payableKobo: 300000, cashDueKobo: 0, totalKobo: 300000 }, fare: { routeMetres: 700, distanceBasis: 'OSM_BICYCLE_NETWORK' } } }; }
        else if (path === `/v1/people/services/${vendorId}`) body = vendorProfile;
        else if (path === '/v1/learning/alarms') body = { alarms: [] };
        else if (path === '/v1/learning/alarm-sounds') body = { sounds: [] };
        else if (path === '/v1/calendar/exam-periods') body = { examPeriods: [] };
        else if (path.endsWith('/unread-count')) body = { count: 0, unreadCount: 0 };
        else body = { notifications: [], messages: [], prompts: [], reviews: [], events: [], count: 0, unreadCount: 0 };
        await route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(body) }); return;
      }
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.protocol === 'data:') await route.continue();
      else await route.abort();
    });
    async function open(path, ready) {
      await page.goto('http://localhost:8100' + path);
      try { await page.getByText(ready, { exact: true }).first().waitFor({ timeout: 45000 }); }
      catch (error) { await page.screenshot({ path: resolve(evidence, `failed-${path.split('?')[0].replaceAll('/','_')}-${width}.png`) }); writeFileSync(resolve(evidence,'failed-page.json'),JSON.stringify({ url:page.url(), text:await page.locator('body').innerText(), errors },null,2)); throw error; }
      await page.getByLabel('Opening KampusOne', { exact: true }).waitFor({ state: 'hidden' });
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'Viewport overflow');
    }
    return { page, errors, open, context, get saves() { return saveCalls; }, get quote() { return lastQuote; } };
  }
  for (const width of [360, 390]) {
    const s = await scenario({ width });
    await s.open(`/learning-preview?id=${resourceId}`, 'Fluid mechanics');
    await s.page.getByRole('img', { name: 'Verified tutor', exact: true }).waitFor();
    const openButton = s.page.getByRole('button', { name: 'Open resource', exact: true });
    const before = await openButton.boundingBox(); assert.ok(before && before.y + before.height <= 844, 'Primary action is not visible');
    await s.page.getByRole('button', { name: 'Save resource', exact: true }).click();
    await s.page.getByRole('button', { name: 'Remove from saved resources', exact: true }).waitFor(); assert.equal(s.saves, 1);
    await s.page.getByRole('button', { name: 'Remove from saved resources', exact: true }).click();
    await s.page.getByRole('button', { name: 'Save resource', exact: true }).waitFor(); assert.equal(s.saves, 2);
    await s.page.getByRole('button', { name: 'Dismiss notification', exact: true }).click();
    await s.page.getByRole('button', { name: 'Dismiss notification', exact: true }).waitFor({ state: 'hidden' });
    await s.page.getByRole('button', { name: 'Go back', exact: true }).scrollIntoViewIfNeeded();
    await s.page.screenshot({ path: resolve(evidence, `resource-${width}.png`) });
    await s.page.getByText('Attach the full file in Kira to study the whole resource.', { exact: true }).scrollIntoViewIfNeeded();
    assert.equal(Math.round((await openButton.boundingBox()).y), Math.round(before.y), 'Primary action moved with page content');
    await s.open(`/order-detail?id=${orderId}`, 'Collected');
    assert.equal(await s.page.getByLabel('Order timeline', { exact: true }).count(), 0);
    await s.page.screenshot({ path: resolve(evidence, `order-${width}.png`) });
    await s.page.getByRole('button', { name: 'View order timeline', exact: true }).click();
    await s.page.getByLabel('Order timeline', { exact: true }).waitFor();
    await s.page.screenshot({ path: resolve(evidence, `order-timeline-${width}.png`) });
    await s.page.getByRole('button', { name: 'Review Engineering notebook', exact: true }).click();
    await s.page.getByRole('radio', { name: '5 out of 5 stars', exact: true }).click({ position: { x: 34, y: 22 } });
    await s.page.getByRole('textbox', { name: 'Your product review, optional', exact: true }).fill('Useful notebook for class.');
    await s.page.getByRole('button', { name: 'Publish review', exact: true }).click();
    await s.page.getByText('Your rating · 5/5', { exact: true }).waitFor();
    assert.deepEqual(s.errors, []); results.push({ width, bookmarks: true, pinnedAction: true, timeline: true, review: true });
    await s.context.close();
  }
  for (const pickupReady of [true, false]) {
    const s = await scenario({ width: 390, pickupReady });
    await s.open('/store', 'Top campus brands');
    await s.page.getByRole('button', { name: 'Add Campus headphones to cart', exact: true }).click();
    await s.page.getByRole('button', { name: 'Open cart with 1 item', exact: true }).click();
    await s.page.getByRole('button', { name: 'Proceed to checkout', exact: true }).click();
    await s.page.waitForURL(url => url.pathname === '/marketplace-checkout');
    await s.page.getByRole('textbox', { name: 'Recipient name', exact: true }).fill('Ada Student');
    await s.page.getByRole('textbox', { name: 'Recipient phone', exact: true }).fill('08031234567');
    assert.equal(await s.page.getByText('Cash at delivery', { exact: true }).count(), 0);
    if (pickupReady) {
      await s.page.getByRole('button', { name: 'Choose delivery point on the campus map', exact: true }).click();
      await s.page.getByText('201 locations', { exact: true }).waitFor();
      await s.page.getByRole('textbox', { name: 'Search campus locations', exact: true }).fill('ugbowo science shops');
      await s.page.getByRole('radio', { name: 'Physical Science Shopping Complex, Ugbowo campus', exact: true }).waitFor();
      await s.page.screenshot({ path: resolve(evidence, 'checkout-location-search.png') });
      await s.page.getByRole('radio', { name: 'Physical Science Shopping Complex, Ugbowo campus', exact: true }).click();
      await s.page.getByRole('button', { name: 'Review route and checkout total', exact: true }).click();
      await s.page.getByRole('button', { name: /Confirm order and pay/ }).waitFor();
      assert.equal(s.quote.deliveryPaymentMethod, 'IN_APP'); assert.equal(s.quote.deliveryPlaceId, tutorId);
    } else {
      await s.page.getByLabel('Rider delivery unavailable', { exact: true }).waitFor();
      assert.equal(await s.page.getByRole('button', { name: 'Choose delivery point on the campus map', exact: true }).count(), 0);
      await s.page.getByRole('button', { name: 'Review route and checkout total', exact: true }).click();
      await s.page.getByRole('button', { name: /Confirm order and pay/ }).waitFor();
      assert.equal(s.quote.fulfilmentMode, 'PICKUP'); assert.equal(s.quote.deliveryPaymentMethod, 'IN_APP');
    }
    await s.page.screenshot({ path: resolve(evidence, `checkout-${pickupReady ? 'rider' : 'pickup'}.png`) });
    assert.deepEqual(s.errors, []); results.push({ pickupReady, inAppPaymentOnly: true, checkout: true }); await s.context.close();
  }
  const dark = await scenario({ width: 390, dark: true });
  await dark.open(`/learning-preview?id=${resourceId}`, 'Fluid mechanics');
  await dark.page.screenshot({ path: resolve(evidence, 'resource-dark.png') });
  await dark.open(`/order-detail?id=${orderId}`, 'Collected');
  await dark.page.screenshot({ path: resolve(evidence, 'order-dark.png') });
  assert.deepEqual(dark.errors, []); await dark.context.close();
  for (const width of [360, 390]) {
    const s = await scenario({ width });
    await s.open('/store', 'Top campus brands');
    const tile = s.page.getByRole('button', { name: "View Campus Audio's vendor profile, verified", exact: true });
    await tile.waitFor();
    assert.equal(await s.page.getByRole('img', { name: 'Verified vendor', exact: true }).count(), 1);
    assert.equal(await s.page.getByRole('button', { name: "View Legacy brand's vendor profile", exact: true }).count(), 1);
    await s.page.screenshot({ path: resolve(evidence, `campus-brands-${width}.png`) });
    if (width === 360) await tile.click({ position: { x: 48, y: 34 } });
    else await tile.getByText(brand.display_name, { exact: true }).click();
    await s.page.waitForURL(url => url.pathname === '/student-service' && url.searchParams.get('id') === vendorId);
    await s.page.getByText('Vendor profile', { exact: true }).waitFor();
    await s.page.getByRole('img', { name: 'Verified vendor', exact: true }).waitFor();
    await s.page.screenshot({ path: resolve(evidence, `campus-brand-profile-${width}.png`) });
    assert.deepEqual(s.errors, []); results.push({ width, brandPhotoOrNameOpensProfile: true, brandVerifiedBadge: true });
    await s.context.close();
  }
  const pending = await scenario({ order: { status: 'PENDING_PAYMENT' }, timeline: [{ status: 'PENDING_PAYMENT', occurred_at: '2026-10-15T09:00:00Z' }] });
  await pending.open(`/order-detail?id=${orderId}`, 'Awaiting payment');
  assert.equal(await pending.page.getByRole('button', { name: 'Review Engineering notebook', exact: true }).count(), 0);
  await pending.page.getByRole('button', { name: 'Review payment', exact: true }).waitFor();
  await pending.page.screenshot({ path: resolve(evidence, 'order-pending.png') });
  assert.deepEqual(pending.errors, []); await pending.context.close();
  writeFileSync(resolve(evidence, 'checks.json'), JSON.stringify({ results, darkMode: true, pendingOrder: true }, null, 2));
  console.log(JSON.stringify({ results, darkMode: true, pendingOrder: true }));
} finally {
  await browser?.close(); await new Promise(done => web.close(done));
}
