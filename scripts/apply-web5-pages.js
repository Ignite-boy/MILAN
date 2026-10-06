const fs=require('fs'),path=require('path');
const root=path.join(process.cwd(),'frontend');
const pages=[
 ['index.html','MILAN Web5 Ecosystem','A Web5 ecosystem built around user-controlled identity, data and permissioned digital relationships.','The Web5 ecosystem for digital ownership','Identity, data and permission belong closer to the person — MILAN connects them in one Web5 environment.'],
 ['about.html','About MILAN — Web5 Ecosystem','Discover the vision behind MILAN: a people-first Web5 ecosystem for digital identity, data ownership, privacy and connected services.','The vision behind MILAN','MILAN is building an ecosystem where people can understand, control and create value from their digital lives.'],
 ['app.html','MILAN — Your Web5 Space','Enter MILAN, a Web5 environment for identity, data, communication and connected digital experiences.','Your Web5 space','Your identity, your data and your connections — brought together in one ecosystem.'],
 ['music.html','MILAN Music — Web5 Ecosystem','Experience music inside the MILAN Web5 ecosystem, alongside identity, community and user-controlled digital experiences.','Music inside the ecosystem','A richer digital life can include music, media and community without losing the Web5 foundation.'],
 ['keywords.html','MILAN Web5 Knowledge Hub','Explore the vocabulary, concepts and architecture behind the MILAN Web5 ecosystem.','Understand the Web5 layer','Learn the language behind DID, DWN, ownership, privacy and the emerging Web5 ecosystem.'],
 ['decentralized-social-media.html','Web5 Ecosystem — Digital Ownership | MILAN','Milan is a Web5 ecosystem built around digital identity, data ownership, privacy and permissioned connections.','Beyond social media: a Web5 ecosystem','MILAN is not just another social platform. It is a Web5 ecosystem designed around identity, data and user control.'],
 ['private-social-network.html','Private Digital Space — Web5 Ecosystem | MILAN','Explore a privacy-first digital space within the MILAN Web5 ecosystem, designed around identity, data control and permissioned sharing.','A private digital space, built for Web5','Privacy is not a setting added at the end. It is part of the architecture.'],
 ['social-media-privacy.html','Digital Privacy & Data Ownership — MILAN Web5','Understand privacy and data ownership in a Web5 ecosystem designed to give people more control over digital information.','Privacy is part of the architecture','MILAN approaches privacy through identity, data ownership and explicit permission — not surveillance.'],
 ['what-is-web5.html','What Is Web5? — MILAN','Understand Web5, DID and DWN and how they can form a more people-centered digital architecture.','Web5, explained simply','Web5 brings identity and data ownership closer to the person using the internet.'],
 ['best-social-media-apps.html','The Next Digital Era — MILAN Web5 Ecosystem','Explore how the next generation of digital products can move from platform ownership toward user ownership.','The next digital era','The question is no longer only which app is best — it is who owns the digital layer underneath it.'],
 ['launch.html','Launch into the MILAN Web5 Ecosystem','Start exploring MILAN and its Web5 vision for identity, data ownership and connected digital services.','Enter the ecosystem','A new internet experience starts with understanding who controls the digital layer.'],
 ['privacy.html','Privacy Policy — MILAN','Privacy information for the MILAN Web5 ecosystem.','Privacy at the foundation','Transparency and responsible handling of information are core to the ecosystem.'],
 ['terms.html','Terms — MILAN Web5 Ecosystem','Terms governing use of the MILAN Web5 ecosystem and its services.','The rules of the ecosystem','Clear terms help create a trustworthy digital environment.'],
 ['cookie-policy.html','Cookie Policy — MILAN','Cookie information for the MILAN Web5 ecosystem and its public website.','How website technologies work','Understand the technologies used around the public-facing MILAN experience.'],
 ['disclaimer.html','Disclaimer — MILAN Web5 Ecosystem','Important information and limitations relating to the MILAN Web5 ecosystem.','Important information','A transparent ecosystem also explains its boundaries and limitations clearly.'],
 ['offline.html','MILAN Offline Experience','Offline page for the MILAN Web5 ecosystem.','Your Web5 space is still here','Reconnect to continue your MILAN experience.'],
 ['reset-password.html','Reset Password — MILAN','Reset access credentials for your MILAN account.','Restore your access','Securely restore access and return to your MILAN Web5 space.'],
 ['verify-email.html','Verify Email — MILAN','Verify your email to continue into the MILAN Web5 ecosystem.','Verify your access','A verified account helps you continue into your Web5 experience.'],
 ['settings.html','Settings — MILAN Web5 Space','Manage settings for your MILAN Web5 experience.','Control your experience','Your settings are part of keeping your digital space aligned with your choices.'],
 ['admin-users.html','Milan Administration','Administrative tools for the MILAN application.','Ecosystem administration','Internal administration surface for the MILAN application.'],
 ['404.html','Page Not Found — MILAN','The requested MILAN page could not be found.','That path does not exist','Return to the MILAN Web5 ecosystem and continue exploring.'],
];
const cities=['bengaluru','chennai','delhi','hyderabad','jaipur','kolkata','mumbai','pune'];
for(const city of cities){pages.push([`city/${city}.html`,`MILAN in ${city[0].toUpperCase()+city.slice(1)} — Web5 Ecosystem`,`Explore the MILAN Web5 ecosystem in ${city[0].toUpperCase()+city.slice(1)}, with a focus on digital identity, data ownership, privacy and connected people.`,`Web5 in ${city[0].toUpperCase()+city.slice(1)}`,`Your city is part of a wider Web5 ecosystem where identity, data and digital relationships can be designed around people. `]);}
const css='/milan-web5-page.css';
const marker='milan-web5-bridge';
for(const [rel,title,desc,heading,copy] of pages){
 const file=path.join(root,rel); if(!fs.existsSync(file)) continue;
 let s=fs.readFileSync(file,'utf8');
 s=s.replace(/<title>[\\s\\S]*?<\\/title>/i,`<title>${title}</title>`);
 if(/<meta[^>]+name=["']description["'][^>]*>/i.test(s)) s=s.replace(/<meta[^>]+name=["']description["'][^>]*>/i,`<meta name="description" content="${desc.replace(/"/g,'&quot;')}">`);
 else s=s.replace(/<head>/i,`<head>\n<link rel="stylesheet" href="${rel.includes('/')?'..':'.'}${'/'.repeat(rel.includes('/')?0:1)}${css}">`);
 if(!s.includes(css)) s=s.replace(/<head>/i,`<head>\n<link rel="stylesheet" href="/${css}">`);
 if(!s.includes(marker)){
  const block=`<section class="m5-bridge" id="${marker}" aria-label="MILAN Web5 ecosystem positioning"><span class="m5-bridge__eyebrow">WEB5 · DID · DWN · OWNERSHIP</span><h2 class="m5-bridge__title">${heading.split(' ').slice(0,-1).join(' ')} <span>${heading.split(' ').slice(-1).join(' ')}</span></h2><p class="m5-bridge__copy">${copy}</p><div class="m5-bridge__grid"><div class="m5-node"><b>DID</b><span>Identity you can understand and control.</span></div><div class="m5-node"><b>DWN</b><span>A user-centered data layer for the ecosystem.</span></div><div class="m5-node"><b>YOU</b><span>Permissions and choices stay central.</span></div></div></section>`;
  s=s.replace(/<body([^>]*)>/i,`<body$1>\n${block}`);
 }
 fs.writeFileSync(file,s);
}
console.log(`Updated ${pages.length} active HTML pages with Web5 positioning.`);