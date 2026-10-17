import assert from 'node:assert/strict';
import test from 'node:test';

import {
  externalUrlHref,
  findCaptionEntities,
  findProfileBioEntities,
  hashtagSearchHref,
  profileHref,
} from '../src/caption-entities.js';

test('caption entities find hashtags, mentions and web links in order', () => {
  const entities = findCaptionEntities(
    'Karibu #SautiLink kutoka @drcharlestz — https://sautilink.com/about.',
  );

  assert.deepEqual(
    entities.map(({ type, text, href }) => ({ type, text, href })),
    [
      {
        type: 'hashtag',
        text: '#SautiLink',
        href: '/discover?q=%23SautiLink',
      },
      {
        type: 'mention',
        text: '@drcharlestz',
        href: '/u/drcharlestz',
      },
      {
        type: 'url',
        text: 'https://sautilink.com/about',
        href: 'https://sautilink.com/about',
      },
    ],
  );
});

test('profile bio makes only hashtags and mentions clickable', () => {
  const entities = findProfileBioEntities(
    'Founder of #SautiLink. Follow @drcharlestz or visit https://sautilink.com.',
  );

  assert.deepEqual(
    entities.map(({ type, text, href }) => ({ type, text, href })),
    [
      {
        type: 'hashtag',
        text: '#SautiLink',
        href: '/discover?q=%23SautiLink',
      },
      {
        type: 'mention',
        text: '@drcharlestz',
        href: '/u/drcharlestz',
      },
    ],
  );
});

test('caption entities do not mistake an email address for a profile mention', () => {
  assert.deepEqual(findCaptionEntities('Email support@sautilink.com for help.'), []);
});

test('mention punctuation stays outside the clickable username', () => {
  const [entity] = findCaptionEntities('Follow @drcharlestz.');
  assert.equal(entity.type, 'mention');
  assert.equal(entity.text, '@drcharlestz');
  assert.equal(entity.href, '/u/drcharlestz');
});

test('unicode hashtags route to the filtered Discover feed', () => {
  assert.equal(hashtagSearchHref('#Mwanza'), '/discover?q=%23Mwanza');
  assert.equal(hashtagSearchHref('#Habari_Leo'), '/discover?q=%23Habari_Leo');
});

test('profile links normalize the username and web links accept www shorthand', () => {
  assert.equal(profileHref('@DrCharlesTZ'), '/u/drcharlestz');
  assert.equal(externalUrlHref('www.sautilink.com/privacy.'), 'https://www.sautilink.com/privacy');
});

test('unsupported protocols are not linkified', () => {
  assert.equal(externalUrlHref('javascript:alert(1)'), '');
  assert.deepEqual(findCaptionEntities('javascript:alert(1)'), []);
});

test('underscores stay in entity routes without matching email or URL fragments', () => {
  assert.deepEqual(findCaptionEntities('Email cloud_engine@example.com; @cloud_engine #Habari_Leo https://example.com/@path#fragment.')
    .map(({ type, text, href }) => ({ type, text, href })), [
    { type: 'mention', text: '@cloud_engine', href: '/u/cloud_engine' },
    { type: 'hashtag', text: '#Habari_Leo', href: '/discover?q=%23Habari_Leo' },
    { type: 'url', text: 'https://example.com/@path#fragment', href: 'https://example.com/@path#fragment' },
  ]);
});

test('overlong identifiers and Unicode email boundaries never become partial entity links', () => {
  assert.deepEqual(findCaptionEntities(`@${'a'.repeat(31)} #${'b'.repeat(65)} josé@example.com e\u0301@example.com 中@example.com 𐐀@example.com @cloud_engineé @cloud_engine𐐀 𐐀#tag`), []);
  const entities = findCaptionEntities(`@${'a'.repeat(30)}. #${'b'.repeat(64)}! @cloud_engine...`);
  assert.deepEqual(entities.map((entity) => entity.text), [`@${'a'.repeat(30)}`, `#${'b'.repeat(64)}`, '@cloud_engine']);
});
