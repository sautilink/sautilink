export const currentMember = {
  name: 'SautiLink Member',
  handle: '@yourhandle',
  initials: 'SM',
  bio: 'Building meaningful connections across East Africa.',
  location: 'East Africa',
  joined: 'Joined August 2026',
  following: 148,
  followers: 632,
};

export const posts = [
  {
    id: 'platform-foundation',
    author: {
      name: 'SautiLink Engineering',
      handle: '@sautilinkdev',
      initials: 'SE',
      tone: 'blue',
      verified: true,
    },
    time: '18m',
    audience: 'Public',
    text: 'The first SautiLink app shell is taking shape: a fast Stream, focused Circles and a media layer designed to grow without slowing conversations.',
    tags: ['BuildInPublic', 'SautiLink'],
    metrics: { replies: 24, reshares: 81, likes: 436, views: '12.8K' },
    visual: {
      label: 'Platform foundation',
      title: 'One clear system. Built to grow.',
      items: ['Workers', 'Supabase', 'R2'],
    },
  },
  {
    id: 'local-voices',
    author: {
      name: 'Asha Mhando',
      handle: '@asham',
      initials: 'AM',
      tone: 'graphite',
      verified: false,
    },
    time: '42m',
    audience: 'Public',
    text: 'A strong social platform should help local voices travel further without making people perform for an algorithm. Choice and context matter.',
    tags: ['DigitalAfrica'],
    metrics: { replies: 18, reshares: 46, likes: 291, views: '8.4K' },
  },
  {
    id: 'circle-conversation',
    author: {
      name: 'Jabari Otieno',
      handle: '@jabariotieno',
      initials: 'JO',
      tone: 'sand',
      verified: true,
    },
    time: '1h',
    audience: 'East Africa Builders',
    text: 'Today’s Circle discussion: what is one small product decision that made your app noticeably faster on entry-level phones?',
    tags: ['ProductDesign', 'Performance'],
    metrics: { replies: 63, reshares: 33, likes: 219, views: '6.9K' },
  },
];

export const trends = [
  { context: 'Technology · East Africa', label: 'Open technology', posts: '4,820 Sauti' },
  { context: 'Trending in Tanzania', label: 'Digital creators', posts: '2,146 Sauti' },
  { context: 'Community', label: 'Build in public', posts: '1,308 Sauti' },
  { context: 'News · Live', label: 'Across the region', posts: '986 Sauti' },
];

export const suggestions = [
  { name: 'Neema Habari', handle: '@neemahabari', initials: 'NH', tone: 'graphite', verified: true },
  { name: 'Kijiji Tech', handle: '@kijijitech', initials: 'KT', tone: 'blue', verified: true },
  { name: 'Mariam Nuru', handle: '@mariamnuru', initials: 'MN', tone: 'sand', verified: false },
];

export const circles = [
  {
    id: 'east-africa-builders',
    name: 'East Africa Builders',
    description: 'Product, engineering and design conversations from across the region.',
    members: '18.4K',
    active: '364 active now',
    initials: 'EA',
  },
  {
    id: 'creator-economy',
    name: 'Creator Economy',
    description: 'A practical Circle for publishers, creators and independent media teams.',
    members: '11.2K',
    active: '218 active now',
    initials: 'CE',
  },
  {
    id: 'sauti-mtaani',
    name: 'Sauti Mtaani',
    description: 'Local observations, useful updates and conversations that start close to home.',
    members: '8.7K',
    active: '109 active now',
    initials: 'SM',
  },
];

export const conversations = [
  { name: 'Neema Habari', handle: '@neemahabari', initials: 'NH', tone: 'graphite', time: '2m', preview: 'The draft looks clean. I added one note…', unread: 2 },
  { name: 'East Africa Builders', handle: 'Circle room', initials: 'EA', tone: 'blue', time: '18m', preview: 'Jabari: Let us test it on slower networks.', unread: 5 },
  { name: 'Mariam Nuru', handle: '@mariamnuru', initials: 'MN', tone: 'sand', time: '1h', preview: 'Perfect, we can continue tomorrow.', unread: 0 },
  { name: 'SautiLink Support', handle: '@support', initials: 'SS', tone: 'blue', time: 'Mon', preview: 'Your report has been received securely.', unread: 0, verified: true },
];

export const notifications = [
  { id: 'n1', kind: 'follow', initials: 'NH', tone: 'graphite', title: 'Neema Habari followed you', detail: '@neemahabari · 3m' },
  { id: 'n2', kind: 'like', initials: 'KT', tone: 'blue', title: 'Kijiji Tech and 18 others liked your Sauti', detail: 'A lightweight platform is a product choice… · 24m' },
  { id: 'n3', kind: 'reply', initials: 'JO', tone: 'sand', title: 'Jabari Otieno replied to you', detail: '“This is exactly why measurement matters.” · 48m' },
  { id: 'n4', kind: 'circle', initials: 'EA', tone: 'blue', title: 'East Africa Builders has a new discussion', detail: 'Performance on entry-level phones · 1h' },
];
