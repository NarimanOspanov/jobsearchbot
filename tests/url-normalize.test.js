import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCareerUrl } from '../src/utils/urlNormalize.js';

test('normalizeCareerUrl unwraps Google redirect links', () => {
  const googleUrl =
    'https://www.google.com/url?q=https://www.deel.com/careers/open-roles/&sa=D&source=editors&ust=1782137549872017&usg=AOvVaw3yCRE94n8AtGOfA6IWoBMg';
  assert.equal(normalizeCareerUrl(googleUrl), 'https://www.deel.com/careers/open-roles');
});

test('normalizeCareerUrl unwraps nested encoded query params', () => {
  const googleUrl =
    'https://www.google.com/url?q=https://yango.com/career/vacancy?srsltid%3DAfmBOooCH6s4FyUw-6i3yhgjDcox1PE16u-WJ7wYrrId4tBp3dIDdsSA&sa=D&source=editors';
  assert.equal(normalizeCareerUrl(googleUrl), 'https://yango.com/career/vacancy');
});

test('normalizeCareerUrl strips tracking params from direct links', () => {
  const url =
    'https://www.airalo.com/airalo-careers/job-vacancies?srsltid=AfmBOoqVUnrw7vWeO5wi6rQ8fIC3urN1MqVfhNV1Tp1ac8sCccJy6b92';
  assert.equal(normalizeCareerUrl(url), 'https://www.airalo.com/airalo-careers/job-vacancies');
});

test('normalizeCareerUrl preserves hash fragments', () => {
  assert.equal(normalizeCareerUrl('https://www.libertexgroup.com/#careers'), 'https://www.libertexgroup.com#careers');
  const googleUrl =
    'https://www.google.com/url?q=https://everhour.com/about%23careers&sa=D&source=editors';
  assert.equal(normalizeCareerUrl(googleUrl), 'https://everhour.com/about#careers');
});

test('normalizeCareerUrl leaves clean URLs unchanged', () => {
  assert.equal(normalizeCareerUrl('https://careers.airbnb.com'), 'https://careers.airbnb.com');
});
