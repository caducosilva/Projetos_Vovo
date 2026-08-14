import fs from 'fs';
import path from 'path';

function parseM3U(content, defaultCountry = 'br') {
  const lines = content.split(/\r?\n/);
  const channels = [];
  let current = null;

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF:')) {
      const nameMatch = line.match(/,(.+)$/);
      const name = nameMatch ? nameMatch[1].trim() : 'Canal';
      
      const logoMatch = line.match(/tvg-logo="([^"]+)"/i);
      const logo = logoMatch ? logoMatch[1] : '';

      const groupMatch = line.match(/group-title="([^"]+)"/i);
      const group = groupMatch ? groupMatch[1] : 'Canais Abertos';

      const idMatch = line.match(/tvg-id="([^"]+)"/i);
      const id = idMatch ? idMatch[1] : '';

      let country = defaultCountry;
      if (id.includes('.br')) country = 'br';
      else if (id.includes('.us')) country = 'us';
      else if (id.includes('.pt')) country = 'pt';
      else if (id.includes('.ar')) country = 'ar';
      else if (id.includes('.es')) country = 'es';

      current = {
        id: id || Math.random().toString(36).substring(2, 9),
        name,
        logo,
        group,
        country,
        url: ''
      };
    } else if (line.startsWith('http://') || line.startsWith('https://')) {
      if (current) {
        current.url = line;
        channels.push(current);
        current = null;
      }
    }
  }
  return channels;
}

const mogiPath = 'C:/Users/abobi/Desktop/iptv-org-test/lists/mogi-globo-tv-diario.m3u';
const brPath = 'C:/Users/abobi/Desktop/iptv-org-test/lists/br.m3u';

let mogiChannels = [];
if (fs.existsSync(mogiPath)) {
  mogiChannels = parseM3U(fs.readFileSync(mogiPath, 'utf8'), 'br');
}

let brChannels = [];
if (fs.existsSync(brPath)) {
  brChannels = parseM3U(fs.readFileSync(brPath, 'utf8'), 'br');
}

const all = [...mogiChannels, ...brChannels];
const unique = [];
const seen = new Set();
for (const ch of all) {
  if (ch.url && !seen.has(ch.url)) {
    seen.add(ch.url);
    unique.push(ch);
  }
}

const outDir = 'C:/Users/abobi/Downloads/vovo-tv-app/src/data';
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'default_channels.json'), JSON.stringify(unique, null, 2), 'utf8');
console.log('Channels parsed and saved:', unique.length);
