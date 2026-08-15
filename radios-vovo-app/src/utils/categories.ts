import type { RadioStation, RadioCategoryInfo, RadioCategoryKey } from '../types';

export const RADIO_CATEGORIES: RadioCategoryInfo[] = [
  { key: 'destaques', label: '⭐ Mais Ouvidas', icon: 'Sparkles' },
  { key: 'favoritos', label: '❤️ Minhas Favoritas', icon: 'Heart' },
  { key: 'sp-mogi', label: '📍 SP & Mogi', icon: 'MapPin' },
  { key: 'religioso', label: '🙏 Missas & Orações', icon: 'Cross' },
  { key: 'sertanejo', label: '🤠 Sertanejo & Viola', icon: 'Music' },
  { key: 'noticias', label: '📰 Notícias & Jornal', icon: 'Newspaper' },
  { key: 'flashback', label: '📻 Anos 70, 80 e 90', icon: 'Disc' },
  { key: 'rj', label: '🏖️ Rio de Janeiro', icon: 'Sun' },
  { key: 'mg', label: '☕ Minas Gerais', icon: 'Coffee' },
  { key: 'nordeste', label: '🌵 Nordeste / Bahia', icon: 'Flame' },
  { key: 'sul', label: '🧉 Região Sul', icon: 'Compass' },
  { key: 'todos', label: '🌐 Todas as Rádios', icon: 'Radio' },
];

export function getRadioCategories(station: RadioStation): RadioCategoryKey[] {
  const name = (station.name || '').toLowerCase();
  const genre = (station.genre || '').toLowerCase();
  const state = (station.state || '').toLowerCase();
  const city = (station.city || '').toLowerCase();
  const combined = `${name} ${genre} ${state} ${city}`;

  const matched: RadioCategoryKey[] = [];

  if (station.destaque) {
    matched.push('destaques');
  }

  // SP & Mogi
  if (
    state.includes('sp') ||
    city.includes('são paulo') ||
    city.includes('sao paulo') ||
    combined.includes('mogi') ||
    combined.includes('transcontinental') ||
    combined.includes('metropolitana') ||
    combined.includes('gazeta') ||
    combined.includes('nativa') ||
    combined.includes('alpha') ||
    combined.includes('bandeirantes')
  ) {
    matched.push('sp-mogi');
  }

  // Religioso / Missas / Terço / Gospel
  if (
    combined.includes('aparecida') ||
    combined.includes('canção nova') ||
    combined.includes('cancao nova') ||
    combined.includes('evangelizar') ||
    combined.includes('manzotti') ||
    combined.includes('terço') ||
    combined.includes('terco') ||
    combined.includes('catolica') ||
    combined.includes('católica') ||
    combined.includes('missa') ||
    combined.includes('gospel') ||
    combined.includes('louvor') ||
    combined.includes('imaculada') ||
    combined.includes('9 de julho') ||
    combined.includes('melodia') ||
    combined.includes('fé') ||
    combined.includes('fe') ||
    combined.includes('relig')
  ) {
    matched.push('religioso');
  }

  // Sertanejo & Moda de Viola
  if (
    combined.includes('sertanejo') ||
    combined.includes('viola') ||
    combined.includes('caipira') ||
    combined.includes('modão') ||
    combined.includes('modao') ||
    combined.includes('raiz') ||
    combined.includes('country')
  ) {
    matched.push('sertanejo');
  }

  // Notícias
  if (
    combined.includes('news') ||
    combined.includes('noticia') ||
    combined.includes('notícia') ||
    combined.includes('jornal') ||
    combined.includes('cbn') ||
    combined.includes('bandnews') ||
    combined.includes('jovem pan') ||
    combined.includes('itatiaia') ||
    combined.includes('bandeirantes')
  ) {
    matched.push('noticias');
  }

  // Flashback & Anos 70/80
  if (
    combined.includes('flashback') ||
    combined.includes('anos 80') ||
    combined.includes('anos 70') ||
    combined.includes('anos 90') ||
    combined.includes('saudade') ||
    combined.includes('antena 1') ||
    combined.includes('classic') ||
    combined.includes('vintage') ||
    combined.includes('retro')
  ) {
    matched.push('flashback');
  }

  // Rio de Janeiro
  if (
    state.includes('rj') ||
    city.includes('rio de janeiro') ||
    combined.includes('tupi') ||
    combined.includes('jb fm') ||
    combined.includes('fm o dia')
  ) {
    matched.push('rj');
  }

  // Minas Gerais
  if (
    state.includes('mg') ||
    city.includes('minas') ||
    city.includes('belo horizonte') ||
    combined.includes('itatiaia') ||
    combined.includes('alvorada')
  ) {
    matched.push('mg');
  }

  // Nordeste / Bahia
  if (
    state.includes('ba') ||
    state.includes('pe') ||
    state.includes('ce') ||
    state.includes('rn') ||
    state.includes('pb') ||
    state.includes('al') ||
    state.includes('se') ||
    state.includes('ma') ||
    state.includes('pi') ||
    combined.includes('salvador') ||
    combined.includes('recife') ||
    combined.includes('fortaleza') ||
    combined.includes('sociedade da bahia')
  ) {
    matched.push('nordeste');
  }

  // Sul
  if (
    state.includes('rs') ||
    state.includes('pr') ||
    state.includes('sc') ||
    city.includes('porto alegre') ||
    city.includes('curitiba') ||
    city.includes('florianopolis') ||
    combined.includes('gaúcha') ||
    combined.includes('gaucha') ||
    combined.includes('massa fm') ||
    combined.includes('banda b')
  ) {
    matched.push('sul');
  }

  return matched;
}
