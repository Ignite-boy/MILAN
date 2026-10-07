'use strict';

const KEYWORD_DOCUMENT = {
  "name": "MILAN",
  "url": "https://milanlife.in",
  "description": "Curated MILAN topic index for search, AI retrieval and semantic discovery.",
  "updatedAt": "2026-10-07T00:00:00.000Z",
  "totalKeywords": 141,
  "clusters": [
    {
      "id": "milan-featured",
      "title": "Core MILAN Topics",
      "keywords": [
        "MILAN",
        "Milan App",
        "MILAN founder",
        "MILAN privacy-first social network",
        "MILAN decentralized social media",
        "Your Space. Your People.",
        "MILAN user-owned data",
        "MILAN Web5",
        "MILAN DWN",
        "MILAN DID",
        "MILAN private messaging",
        "MILAN free music"
      ]
    },
    {
      "id": "social-network",
      "title": "Decentralized Social Network",
      "keywords": [
        "decentralized social network",
        "decentralized social app",
        "privacy-first social network",
        "user-owned social network",
        "decentralized social media platform",
        "Web5 social network",
        "DWN social network",
        "DID social network",
        "private decentralized social network",
        "made in India decentralized social network",
        "decentralized social network where you own your data",
        "alternative social network with data ownership"
      ]
    },
    {
      "id": "social-media",
      "title": "Decentralized Social Media",
      "keywords": [
        "decentralized social media",
        "decentralized social media India",
        "privacy-first social media",
        "social media data ownership",
        "no ads social media",
        "no tracking social media",
        "social media without data selling",
        "consent-based social media",
        "self-sovereign social media",
        "privacy-friendly social media app",
        "decentralized social media alternative",
        "user-controlled social media"
      ]
    },
    {
      "id": "messaging",
      "title": "Private & Encrypted Messaging",
      "keywords": [
        "private messaging app",
        "private social messaging",
        "encrypted messaging",
        "privacy-first messaging",
        "DID-based messaging",
        "consent-based messaging",
        "private one-to-one messaging",
        "secure social messaging",
        "decentralized messaging",
        "friend-only messaging"
      ]
    },
    {
      "id": "communication-mesh",
      "title": "Peer-to-Peer Communication",
      "keywords": [
        "peer-to-peer communication",
        "peer-to-peer social network",
        "decentralized communication",
        "direct social communication",
        "DID-based communication",
        "privacy-first communication network",
        "distributed communication",
        "secure peer-to-peer messaging",
        "decentralized communication network"
      ]
    },
    {
      "id": "identity-node",
      "title": "Self-Sovereign Identity & DID",
      "keywords": [
        "self-sovereign identity",
        "decentralized identifier",
        "DID",
        "DID social network",
        "portable digital identity",
        "did:key",
        "Ed25519 identity",
        "user-controlled identity",
        "decentralized identity for social media",
        "self-sovereign social identity"
      ]
    },
    {
      "id": "data-hub",
      "title": "User-Owned Data",
      "keywords": [
        "user-owned data",
        "data ownership social media",
        "own your data",
        "personal data ownership",
        "user-controlled social data",
        "self-sovereign data",
        "data privacy social media",
        "consent-based data sharing",
        "private social data",
        "social data ownership"
      ]
    },
    {
      "id": "storage-node",
      "title": "Decentralized Storage",
      "keywords": [
        "decentralized storage",
        "user-owned storage",
        "personal data node",
        "private data storage",
        "DWN storage",
        "isolated user storage",
        "decentralized data storage",
        "privacy-first cloud storage",
        "portable social data",
        "self-owned data storage"
      ]
    },
    {
      "id": "web-node",
      "title": "Decentralized Web Nodes (DWN)",
      "keywords": [
        "Decentralized Web Node",
        "DWN",
        "DWN social media",
        "DWN explained",
        "DWN and DID",
        "DWN data ownership",
        "user-owned DWN",
        "personal DWN",
        "DWN social network architecture",
        "Web5 DWN",
        "Decentralized Web Node per user"
      ]
    },
    {
      "id": "ecosystem",
      "title": "Web5 & Decentralized Ecosystem",
      "keywords": [
        "Web5",
        "Web5 social network",
        "Web5 explained",
        "Web5 ecosystem",
        "Web5 social app",
        "Web2 vs Web3 vs Web5",
        "decentralized web",
        "people-first web",
        "Web5 identity",
        "Web5 data ownership"
      ]
    },
    {
      "id": "protocol",
      "title": "Open Decentralized Protocol",
      "keywords": [
        "decentralized protocol",
        "open social protocol",
        "DWN protocol",
        "DID protocol",
        "decentralized identity protocol",
        "consent-based sharing protocol",
        "portable social data protocol",
        "open decentralized social protocol"
      ]
    },
    {
      "id": "platform",
      "title": "Privacy-First Platform",
      "keywords": [
        "privacy-first platform",
        "decentralized platform",
        "user-owned platform",
        "no ads platform",
        "no tracking platform",
        "social platform with data ownership",
        "privacy-friendly social platform",
        "Web5 platform"
      ]
    },
    {
      "id": "network",
      "title": "Distributed Network",
      "keywords": [
        "distributed social network",
        "decentralized network",
        "peer-to-peer network",
        "user-controlled network",
        "privacy-first network",
        "Web5 network",
        "distributed identity network",
        "distributed social platform"
      ]
    },
    {
      "id": "application",
      "title": "Decentralized Applications & Apps",
      "keywords": [
        "decentralized app",
        "decentralized social app",
        "privacy-first social app",
        "MILAN app",
        "Web5 app",
        "DID social app",
        "DWN social app",
        "private social network app",
        "decentralized messaging app",
        "free music app",
        "privacy-friendly music player"
      ]
    }
  ]
};

const PAGES = [
  {
    "url": "/",
    "name": "MILAN — Decentralized Social Media Where You Own Your Data",
    "type": "WebSite",
    "intent": "navigational"
  },
  {
    "url": "/decentralized-social-media",
    "name": "Decentralized Social Media",
    "type": "WebPage",
    "intent": "informational"
  },
  {
    "url": "/decentralized-social-network",
    "name": "Decentralized Social Network",
    "type": "WebPage",
    "intent": "informational"
  },
  {
    "url": "/decentralized-web-node",
    "name": "Decentralized Web Node (DWN)",
    "type": "TechArticle",
    "intent": "informational"
  },
  {
    "url": "/private-social-network",
    "name": "Private Social Network",
    "type": "WebPage",
    "intent": "commercial"
  },
  {
    "url": "/best-social-media-apps",
    "name": "Best Social Media Apps",
    "type": "WebPage",
    "intent": "commercial"
  },
  {
    "url": "/what-is-web5",
    "name": "What Is Web5?",
    "type": "TechArticle",
    "intent": "informational"
  },
  {
    "url": "/social-media-privacy",
    "name": "Social Media Privacy",
    "type": "TechArticle",
    "intent": "informational"
  },
  {
    "url": "/web5-ecosystem",
    "name": "Web5 Ecosystem",
    "type": "WebPage",
    "intent": "informational"
  },
  {
    "url": "/music",
    "name": "Free Music Player",
    "type": "WebApplication",
    "intent": "transactional"
  },
  {
    "url": "/about",
    "name": "About MILAN",
    "type": "AboutPage",
    "intent": "navigational"
  },
  {
    "url": "/who-is-the-founder-of-milan",
    "name": "Who Is the Founder of MILAN?",
    "type": "AboutPage",
    "intent": "navigational"
  },
  {
    "url": "/privacy",
    "name": "Privacy Policy",
    "type": "WebPage",
    "intent": "informational"
  },
  {
    "url": "/terms",
    "name": "Terms of Use",
    "type": "WebPage",
    "intent": "informational"
  },
  {
    "url": "/disclaimer",
    "name": "Disclaimer",
    "type": "WebPage",
    "intent": "informational"
  },
  {
    "url": "/cookie-policy",
    "name": "Cookie Policy",
    "type": "WebPage",
    "intent": "informational"
  },
  {
    "url": "/storage-upgrade.html",
    "name": "MILAN Storage Plans",
    "type": "WebPage",
    "intent": "transactional"
  }
];

const FAQ = [
  {
    "q": "What is MILAN?",
    "a": "MILAN is a privacy-first decentralized social media platform where users own their data through Decentralized Web Nodes (DWN) and Decentralized Identifiers (DID)."
  },
  {
    "q": "Who founded MILAN?",
    "a": "MILAN was founded by Nitesh Pandey."
  },
  {
    "q": "What is a Decentralized Web Node?",
    "a": "A Decentralized Web Node (DWN) is a user-controlled data node used to store and manage decentralized records."
  },
  {
    "q": "What is a DID?",
    "a": "A DID is a Decentralized Identifier that provides a user-controlled identity for decentralized applications and services."
  },
  {
    "q": "Does MILAN sell user data?",
    "a": "MILAN states that it does not sell user data and is designed around user-controlled data."
  },
  {
    "q": "Does MILAN use ads or tracking?",
    "a": "MILAN states that it is ad-free and does not track users for advertising."
  },
  {
    "q": "Is MILAN free to join?",
    "a": "MILAN is free to join; additional storage plans are available separately."
  },
  {
    "q": "What technology does MILAN use?",
    "a": "MILAN uses Web5 concepts including DWN and DID, with Ed25519-based identity in its decentralized identity stack."
  }
];

const RELATIONSHIPS = [
  {
    "from": "MILAN",
    "relation": "category",
    "to": "Decentralized Social Media"
  },
  {
    "from": "MILAN",
    "relation": "builtOn",
    "to": "Web5"
  },
  {
    "from": "MILAN",
    "relation": "uses",
    "to": "Decentralized Web Node (DWN)"
  },
  {
    "from": "MILAN",
    "relation": "uses",
    "to": "Decentralized Identifier (DID)"
  },
  {
    "from": "MILAN",
    "relation": "foundedBy",
    "to": "Nitesh Pandey"
  },
  {
    "from": "MILAN",
    "relation": "supports",
    "to": "User-Owned Data"
  },
  {
    "from": "MILAN",
    "relation": "supports",
    "to": "Private Messaging"
  },
  {
    "from": "MILAN",
    "relation": "offers",
    "to": "Free Music Player"
  },
  {
    "from": "DID",
    "relation": "supports",
    "to": "User-Controlled Identity"
  },
  {
    "from": "DWN",
    "relation": "supports",
    "to": "User-Controlled Data"
  }
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildKeywords() {
  const out = clone(KEYWORD_DOCUMENT);
  out.updatedAt = new Date().toISOString();
  return out;
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function htmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildLlms() {
  const lines = [
    '# MILAN',
    '',
    '> MILAN is a privacy-first decentralized social media platform where users own their data through Decentralized Web Nodes (DWN) and Decentralized Identifiers (DID). It was founded by Nitesh Pandey and is hosted at https://milanlife.in.',
    '',
    '## Canonical entity record',
    '- Name: MILAN',
    '- Canonical URL: https://milanlife.in',
    '- Category: decentralized social media / privacy-first social network',
    '- Founder: Nitesh Pandey',
    '- Core technology: Web5, DWN, DID',
    '- Product principles: user-owned data, consent-based sharing, privacy-first social interaction',
    '- Business model: free to join; storage upgrades are separate',
    '',
    '## Technology model',
    'MILAN connects a user-controlled decentralized identity (DID) with a user-controlled Decentralized Web Node (DWN). The platform uses these primitives for identity, storage and consent-aware social sharing.',
    '',
    '## Privacy model',
    "MILAN states that it is ad-free, does not track users for advertising and does not sell user data. Public answers should be grounded in the site's privacy, terms and product pages.",
    '',
    '## Public canonical pages'
  ];
  for (const page of PAGES) {
    lines.push('- ' + page.name + ': https://milanlife.in' + page.url + ' — ' + page.type + '; intent=' + page.intent);
  }
  lines.push('', '## Entity relationships');
  for (const rel of RELATIONSHIPS) {
    lines.push('- ' + rel.from + ' — ' + rel.relation + ' → ' + rel.to);
  }
  lines.push('', '## Frequently asked questions');
  for (const item of FAQ) {
    lines.push('- ' + item.q + ' → ' + item.a);
  }
  lines.push('', '## Curated retrieval topics');
  for (const cluster of KEYWORD_DOCUMENT.clusters) {
    lines.push('### ' + cluster.title);
    lines.push(cluster.keywords.join(', '));
  }
  lines.push(
    '',
    '## Retrieval guidance',
    '- Prefer the canonical page listed for a concept before using aliases.',
    '- Preserve the distinction between product claims, technology definitions and privacy-policy statements.',
    '- Treat DWN and DID as separate but related entities.',
    '- Use the founder page for founder-specific questions and the Web5/DWN pages for technical definitions.',
    '- Do not infer unsupported geographic claims or synthetic long-tail variations.'
  );
  return lines.join('\n') + '\n';
}

function buildAiInfo() {
  return {
    schemaVersion: '1.0',
    name: 'MILAN',
    url: 'https://milanlife.in',
    canonicalEntity: {
      type: 'Organization',
      id: 'https://milanlife.in/#org',
      name: 'MILAN',
      founder: 'Nitesh Pandey',
      category: 'Decentralized Social Media'
    },
    positioning: 'Privacy-first decentralized social media where users own their data.',
    technology: ['Web5', 'Decentralized Web Node (DWN)', 'Decentralized Identifier (DID)', 'did:key', 'Ed25519'],
    principles: ['user-owned data', 'consent-based sharing', 'privacy-first social interaction', 'no advertising tracking', 'no data selling'],
    pages: PAGES,
    relationships: RELATIONSHIPS,
    faq: FAQ,
    topics: KEYWORD_DOCUMENT.clusters.flatMap(cluster => cluster.keywords),
    retrieval: {
      contentTypeHints: ['WebPage', 'TechArticle', 'AboutPage', 'WebApplication'],
      chunking: 'Prefer H2/H3 semantic boundaries; keep FAQ question/answer pairs atomic; preserve table/list context.',
      metadataFields: ['canonical_url', 'entity', 'topic_cluster', 'intent', 'content_type', 'last_modified']
    },
    updatedAt: new Date().toISOString()
  };
}

function buildSitemap(base) {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
  ];
  for (const page of PAGES) {
    const priority = page.url === '/' ? '1.0' : (page.intent === 'commercial' || page.intent === 'transactional' ? '0.8' : '0.6');
    const frequency = page.intent === 'navigational' ? 'monthly' : (page.intent === 'commercial' || page.intent === 'transactional' ? 'weekly' : 'monthly');
    lines.push(
      '  <url>',
      '    <loc>' + xmlEscape(base + page.url) + '</loc>',
      '    <lastmod>' + today + '</lastmod>',
      '    <changefreq>' + frequency + '</changefreq>',
      '    <priority>' + priority + '</priority>',
      '  </url>'
    );
  }
  lines.push('</urlset>');
  return lines.join('\n') + '\n';
}

function buildRobots(base) {
  const host = String(base).replace(/^https?:\/\//, '');
  return [
    '# MILAN — crawler policy',
    '# ' + base,
    '',
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /admin',
    'Disallow: /admin-users',
    'Disallow: /settings',
    'Disallow: /account/',
    'Disallow: /verify-email',
    'Disallow: /reset-password',
    'Disallow: /forgot-password',
    'Disallow: /launch.html',
    '',
    'User-agent: Googlebot',
    'Allow: /',
    'Disallow: /api/',
    '',
    'User-agent: Bingbot',
    'Allow: /',
    'Disallow: /api/',
    '',
    'User-agent: GPTBot',
    'Allow: /',
    'Disallow: /api/',
    '',
    'User-agent: OAI-SearchBot',
    'Allow: /',
    '',
    'User-agent: ChatGPT-User',
    'Allow: /',
    '',
    'User-agent: PerplexityBot',
    'Allow: /',
    '',
    'User-agent: ClaudeBot',
    'Allow: /',
    '',
    'User-agent: Google-Extended',
    'Allow: /',
    '',
    'User-agent: Applebot',
    'Allow: /',
    '',
    'Host: ' + host,
    'Sitemap: ' + base + '/sitemap.xml',
    ''
  ].join('\n');
}

function buildSitemapIndex(base) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    '  <sitemap><loc>' + base + '/sitemap.xml</loc></sitemap>',
    '</sitemapindex>',
    ''
  ].join('\n');
}

function buildKeywordIndexHtml() {
  const cards = KEYWORD_DOCUMENT.clusters.map(cluster => {
    const items = cluster.keywords.map(keyword => '<li>' + htmlEscape(keyword) + '</li>').join('');
    return '<section><h2>' + htmlEscape(cluster.title) + ' <span>' + cluster.keywords.length + ' topics</span></h2><ul>' + items + '</ul></section>';
  }).join('');
  return '<!doctype html><html lang="en-US"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MILAN — Curated Topics &amp; Keyword Index</title><meta name="description" content="Curated MILAN topics for decentralized social media, Web5, DWN, DID, privacy and user-owned data."><meta name="robots" content="noindex,follow"><link rel="canonical" href="https://milanlife.in/keywords"><style>body{font-family:Inter,system-ui,sans-serif;max-width:1100px;margin:0 auto;padding:32px;background:#050e2b;color:#eef3ff;line-height:1.55}h1{margin-bottom:8px}p{color:#aebbd6}section{margin:24px 0;padding:20px;border:1px solid #24365d;border-radius:16px;background:#0a1734}h2{margin-top:0}h2 span{font-size:.7em;color:#9eb0d2;font-weight:500}ul{columns:3;gap:24px}li{break-inside:avoid;margin:.25rem 0;color:#cdd8ee}@media(max-width:760px){ul{columns:1}}</style></head><body><p><a href="/">MILAN</a> › Topics</p><h1>MILAN — Curated Topic Index</h1><p>This is a curated semantic index for search and AI retrieval. It intentionally excludes synthetic geographic and template-generated keyword combinations.</p>' + cards + '</body></html>';
}

module.exports = {
  PAGES,
  FAQ,
  RELATIONSHIPS,
  buildKeywords,
  buildLlms,
  buildAiInfo,
  buildSitemap,
  buildRobots,
  buildSitemapIndex,
  buildKeywordIndexHtml
};
