import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const configPath = decodeURIComponent(new URL('../app.json', import.meta.url).pathname);
const config = JSON.parse(readFileSync(configPath, 'utf8'));

test('sets required iOS release metadata for EAS and App Store Connect', () => {
  assert.equal(config.expo.ios.bundleIdentifier, 'com.thuemmlerai.parkingremindertimer');
  assert.equal(config.expo.ios.infoPlist.ITSAppUsesNonExemptEncryption, false);
  assert.equal(config.expo.ios.buildNumber, undefined);
});
