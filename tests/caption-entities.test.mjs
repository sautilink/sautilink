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
