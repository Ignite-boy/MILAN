'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const guard = read('backend/services/avatar-hydration-guard.js');
const store = read('backend/utils/store.js');
const profile = read('backend/routes/profile.js');
const appActions = read('frontend/assets/js/app-page-actions.js');
const inlineActions = read('frontend/assets/js/inline-05.js');
const uiActions = read('frontend/assets/js/milan-ui-actions.js');
const appHtml = read('frontend/app.html');

const checks = [
  ['guard wraps the exported Voroa hydration function', () => {
    assert.match(store, /async function hydrateFilesFromVoroa/);
    assert.match(guard, /const originalHydrate = store\.hydrateFilesFromVoroa/);
    assert.doesNotMatch(guard, /hydrateFilesFromRealDwn/);
  }],
  ['guard preserves local avatar only when hydrated avatar is missing', () => {
    assert.match(guard, /if \(!current\)\s*\{/);
    assert.doesNotMatch(guard, /if \(!current \|\| current !== avatar\)/);
  }],
  ['profile GET reads avatar from Voroa DWN storage using authoritative DID space mapping', () => {
    assert.match(profile, /async function readProfilePicture\(user\)/);
    assert.match(profile, /SELECT space_id FROM public\.users WHERE did = \$1 LIMIT 1/);
    assert.match(profile, /const spaceId = String\(owner\.rows\?\.\[0\]\?\.space_id/);
    assert.match(profile, /FROM public\.dwn_storage/);
    assert.match(profile, /readProfilePictureFromUserDwn\(/);
  }],
  ['profile PUT confirms a persistent DWN write before returning success', () => {
    assert.match(profile, /const saved = await writeProfilePicture\(/);
    assert.match(profile, /profile\.avatarRecordId = saved\.dwnRecordId/);
  }],
  ['main avatar upload records a successful upload timestamp', () => {
    assert.match(appActions, /window\.__milanAvatarUploadCommittedAt = Date\.now\(\)/);
  }],
  ['live identity sync ignores stale reads after an avatar upload', () => {
    assert.match(appActions, /syncVersion !== \(Number\(window\.__milanAvatarUploadVersion\) \|\| 0\)[\s\S]{0,120}window\.__milanAvatarUploadActive/);
  }],
  ['authoritative identity captures upload version before network requests', () => {
    const fn = uiActions.indexOf('async function loadAuthoritativeIdentity()');
    const capture = uiActions.indexOf('const identityVersion =', fn);
    const request = uiActions.indexOf('const [profileResponse, meResponse] = await Promise.all([', fn);
    assert.ok(fn >= 0 && capture > fn && request > capture, 'upload version must be captured before Promise.all');
    assert.match(uiActions.slice(request, request + 2200), /identityVersion !==/);
  }],
  ['app page cache-busts the updated avatar scripts', () => {
    assert.match(appHtml, /milan-ui-actions\.js\?v=avatar-persist-20261027-1/);
    assert.match(appHtml, /app-page-actions\.js\?v=avatar-dwn-readback-20261104-1/);
    assert.match(appHtml, /inline-05\.js\?v=milan-feed-media-20261026-1&avatar=avatar-dwn-readback-20261104-1/);
  }],
  ['modal avatar save updates persistent in-memory identity and timestamp', () => {
    assert.match(uiActions, /window\.__milanPersistentAvatar = String\(saved\.avatar\)/);
    assert.match(uiActions, /window\.__milanAvatarUploadCommittedAt = Date\.now\(\)/);
  }],

  ['camera uploader sends compressed Blob directly without fetching a data URL', () => {
    assert.match(appActions, /form\.append\("avatar", optimized\.blob, "profile-picture\.jpg"\)/);
    assert.doesNotMatch(appActions, /fetch\(optimized\.dataUrl\)/);
  }],
  ['shared uploader requires a matching synced persistent GET readback', () => {
    assert.match(appActions, /async function uploadProfileAvatar/);
    assert.match(appActions, /profileData\.avatarSync === "synced"/);
    assert.match(appActions, /readbackRecordId === savedRecordId/);
    assert.match(appActions, /cache: "no-store"/);
  }],
  ['Edit Profile modal photo save uses the shared verified uploader', () => {
    assert.match(inlineActions, /window\.milanUploadProfileAvatar\(f,fields\)/);
    assert.doesNotMatch(inlineActions, /fileToDataUrl\(f\)/);
  }],
  ['successful profile GET overrides and clears stale browser avatar cache', () => {
    assert.match(appActions, /profileReadSucceeded\s*\?\s*String\(profileData\.avatar/);
    assert.match(appActions, /localStorage\.removeItem\("milanAvatar"\)/);
  }],
  ['profile GET and PUT responses both disable caching', () => {
    assert.equal(
      (profile.match(/Cache-Control': 'private, no-store, no-cache, must-revalidate'/g) || []).length,
      2
    );
  }]

];

let failed = 0;
for (const [name, run] of checks) {
  try {
    run();
    console.log('PASS ' + name);
  } catch (error) {
    failed += 1;
    console.error('FAIL ' + name + ': ' + error.message);
  }
}
console.log(`Avatar persistence regression checks: ${checks.length - failed}/${checks.length} passed`);
if (failed) process.exitCode = 1;
