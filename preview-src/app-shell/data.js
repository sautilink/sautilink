export const currentMember = {
  name: 'SautiLink Member',
  handle: '@yourhandle',
  initials: 'SM',
  bio: 'Building meaningful connections across East Africa.',
  location: 'East Africa',
  website: 'sautilink.com',
  joined: 'Joined August 2026',
  following: 148,
  followers: 632,
};

export const publicMember = {
  name: 'Asha Mhando',
  handle: '@asham',
  initials: 'AM',
  bio: 'Product designer exploring humane technology, local media and better digital public spaces.',
  location: 'Dar es Salaam, Tanzania',
  website: 'asham.design',
  joined: 'Joined March 2026',
  following: 389,
  followers: '12.6K',
  verified: true,
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
    text: 'The first SautiLink app shell is taking shape: a fast Home feed, focused Sautify and a media layer designed to grow without slowing conversations.',
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
    text: 'Today’s Sautify discussion: what is one small product decision that made your app noticeably faster on entry-level phones?',
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
    access: 'Open',
    role: 'Member',
    rules: ['Share practical knowledge', 'Credit original work', 'Disagree without attacking people'],
  },
  {
    id: 'creator-economy',
    name: 'Creator Economy',
    description: 'A practical Sautify for publishers, creators and independent media teams.',
    members: '11.2K',
    active: '218 active now',
    initials: 'CE',
    access: 'Approval',
    role: null,
    rules: ['No engagement bait', 'Declare commercial relationships', 'Keep feedback constructive'],
  },
  {
    id: 'sauti-mtaani',
    name: 'Sauti Mtaani',
    description: 'Local observations, useful updates and conversations that start close to home.',
    members: '8.7K',
    active: '109 active now',
    initials: 'SM',
    access: 'Open',
    role: null,
    rules: ['Protect private information', 'Add location context', 'Correct mistakes clearly'],
  },
  {
    id: 'quiet-design-club',
    name: 'Quiet Design Club',
    description: 'A small private Sautify for focused critique, research notes and work in progress.',
    members: '84',
    active: '12 active now',
    initials: 'QD',
    access: 'Private',
    role: 'Moderator',
    rules: ['Keep work inside the Sautify', 'Ask before sharing screenshots', 'Give specific feedback'],
  },
];

export const notifications = [
  { id: 'n1', kind: 'follow', initials: 'NH', tone: 'graphite', title: 'Neema Habari followed you', detail: '@neemahabari · 3m' },
  { id: 'n2', kind: 'like', initials: 'KT', tone: 'blue', title: 'Kijiji Tech and 18 others liked your Sauti', detail: 'A lightweight platform is a product choice… · 24m' },
  { id: 'n3', kind: 'reply', initials: 'JO', tone: 'sand', title: 'Jabari Otieno replied to you', detail: '“This is exactly why measurement matters.” · 48m' },
  { id: 'n4', kind: 'circle', initials: 'EA', tone: 'blue', title: 'East Africa Builders has a new discussion', detail: 'Performance on entry-level phones · 1h' },
];

export const directMessageConversations = [
  {
    id: 'asha-mhando',
    participant: {
      name: 'Asha Mhando',
      handle: '@asham',
      initials: 'AM',
      tone: 'graphite',
      verified: true,
    },
    unread: 2,
    updatedAt: '2m',
    lastMessage: 'The Sautify notes are ready when you are.',
    blocked: false,
    reported: false,
    messages: [
      { id: 'asha-1', sender: 'them', text: 'Hello! I liked the direction of the public threads preview.', time: '10:14' },
      { id: 'asha-2', sender: 'me', text: 'Thank you. We are keeping the first release focused and lightweight.', time: '10:18', status: 'Read' },
      { id: 'asha-3', sender: 'them', text: 'That makes sense. I gathered a few Sautify notes for the team.', time: '10:26' },
      { id: 'asha-4', sender: 'them', text: 'The Sautify notes are ready when you are.', time: '10:27' },
    ],
  },
  {
    id: 'jabari-otieno',
    participant: {
      name: 'Jabari Otieno',
      handle: '@jabariotieno',
      initials: 'JO',
      tone: 'sand',
      verified: true,
    },
    unread: 0,
    updatedAt: '1h',
    lastMessage: 'I will add the performance results tomorrow.',
    blocked: false,
    reported: false,
    messages: [
      { id: 'jabari-1', sender: 'me', text: 'Did the entry-level phone test finish?', time: 'Yesterday', status: 'Read' },
      { id: 'jabari-2', sender: 'them', text: 'Yes. The first pass looks stable.', time: '09:02' },
      { id: 'jabari-3', sender: 'them', text: 'I will add the performance results tomorrow.', time: '09:03' },
    ],
  },
  {
    id: 'neema-habari',
    participant: {
      name: 'Neema Habari',
      handle: '@neemahabari',
      initials: 'NH',
      tone: 'blue',
      verified: true,
    },
    unread: 1,
    updatedAt: '3h',
    lastMessage: 'Can we review the reporting flow this week?',
    blocked: false,
    reported: false,
    messages: [
      { id: 'neema-1', sender: 'them', text: 'Can we review the reporting flow this week?', time: '07:48' },
    ],
  },
];
