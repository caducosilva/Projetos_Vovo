import type { Channel } from '../types';

export function parseM3UContent(content: string, _sourceName = 'Importado'): Channel[] {
  const lines = content.split(/\r?\n/);
  const channels: Channel[] = [];
  let current: Partial<Channel> | null = null;

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF:')) {
      const nameMatch = line.match(/,(.+)$/);
      const name = nameMatch ? nameMatch[1].trim() : 'Canal Sem Nome';

      const logoMatch = line.match(/tvg-logo="([^"]+)"/i);
      const logo = logoMatch ? logoMatch[1] : '';

      const groupMatch = line.match(/group-title="([^"]+)"/i);
      const group = groupMatch ? groupMatch[1] : 'Importados';

      const idMatch = line.match(/tvg-id="([^"]+)"/i);
      const id = idMatch ? idMatch[1] : `custom_${Math.random().toString(36).substring(2, 9)}`;

      let country = 'br';
      const lowerId = (id || '').toLowerCase();
      const lowerName = name.toLowerCase();

      if (lowerId.includes('.br') || lowerName.includes('brasil') || lowerName.includes('globo') || lowerName.includes('sbt')) {
        country = 'br';
      } else if (lowerId.includes('.us') || lowerId.includes('.usa')) {
        country = 'us';
      } else if (lowerId.includes('.pt')) {
        country = 'pt';
      } else if (lowerId.includes('.ar')) {
        country = 'ar';
      } else if (lowerId.includes('.es')) {
        country = 'es';
      }

      current = {
        id,
        name,
        logo,
        group,
        country,
        isCustom: true
      };
    } else if (line.startsWith('http://') || line.startsWith('https://')) {
      if (current) {
        current.url = line;
        channels.push(current as Channel);
        current = null;
      }
    }
  }

  return channels;
}
