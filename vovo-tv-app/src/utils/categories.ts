import type { Channel, CategoryInfo, CategoryKey } from '../types';

export const CATEGORIES: CategoryInfo[] = [
  { key: 'favoritos', label: '⭐ Favoritos', icon: 'Star' },
  { key: 'abertos', label: '📺 Canais Abertos TV', icon: 'Tv' },
  { key: 'radios-todas', label: '📻 Todas as Rádios (Brasil)', icon: 'Radio' },
  { key: 'radios-sp', label: '📍 Rádios de São Paulo (SP)', icon: 'Radio' },
  { key: 'radios-mg', label: '☕ Rádios de Minas Gerais (BH)', icon: 'Radio' },
  { key: 'radios-ba', label: '🌴 Rádios da Bahia (Salvador)', icon: 'Radio' },
  { key: 'radios-rj', label: '🏖️ Rádios do Rio de Janeiro', icon: 'Radio' },
  { key: 'radios-sul', label: '🧉 Rádios do Sul (RS, PR, SC)', icon: 'Radio' },
  { key: 'radios-co', label: '🏛️ Rádios Centro-Oeste & Brasília', icon: 'Radio' },
  { key: 'radios-ne', label: '☀️ Rádios Nordeste (Recife, Fortaleza)', icon: 'Radio' },
  { key: 'radios-norte', label: '🌳 Rádios Norte (Manaus, Belém)', icon: 'Radio' },
  { key: 'sp-mogi', label: '📍 TV SP & Mogi', icon: 'MapPin' },
  { key: 'bahia', label: '🌴 TV Bahia', icon: 'Sun' },
  { key: 'noticias', label: '📰 Notícias', icon: 'Newspaper' },
  { key: 'filmes', label: '🎬 Filmes', icon: 'Film' },
  { key: 'series', label: '🍿 Séries & Novelas', icon: 'Clapperboard' },
  { key: 'infantil', label: '🧸 Infantil (Kids)', icon: 'Baby' },
  { key: 'esportes', label: '⚽ Esportes', icon: 'Trophy' },
  { key: 'documentarios', label: '📚 Documentários', icon: 'BookOpen' },
  { key: 'musica', label: '🎵 Música & Clipes', icon: 'Music' },
  { key: 'religioso', label: '🙏 Religiosos', icon: 'Heart' },
  { key: 'todos', label: '🌐 Todos os Canais', icon: 'Globe' },
];

export function getChannelCategory(channel: Channel): CategoryKey[] {
  const name = (channel.name || '').toLowerCase();
  const group = (channel.group || '').toLowerCase();
  const id = (channel.id || '').toLowerCase();
  const state = (channel.state || '').toLowerCase();
  const region = (channel.region || '').toLowerCase();
  const combined = `${name} ${group} ${id} ${state} ${region}`;

  const matched: CategoryKey[] = [];

  const isRadio = channel.isRadio || group.includes('rádio') || group.includes('radio') || name.startsWith('📻');

  // Radio regional categorization
  if (isRadio) {
    matched.push('radios-todas');

    if (region === 'sp' || state === 'sp' || combined.includes('são paulo') || combined.includes('sao paulo') || combined.includes('mogi') || combined.includes('campinas') || combined.includes('santos')) {
      matched.push('radios-sp');
    }
    if (region === 'mg' || state === 'mg' || combined.includes('minas') || combined.includes('belo horizonte') || combined.includes('itatiaia') || combined.includes('inconfidencia')) {
      matched.push('radios-mg');
    }
    if (region === 'ba' || state === 'ba' || combined.includes('bahia') || combined.includes('salvador') || combined.includes('sociedade') || combined.includes('piatã') || combined.includes('itapoan')) {
      matched.push('radios-ba');
    }
    if (region === 'rj' || state === 'rj' || combined.includes('rio de janeiro') || combined.includes('tupi') || combined.includes('jb fm')) {
      matched.push('radios-rj');
    }
    if (region === 'sul' || ['rs', 'pr', 'sc'].includes(state) || combined.includes('gaúcha') || combined.includes('gaucha') || combined.includes('porto alegre') || combined.includes('curitiba') || combined.includes('florianopolis') || combined.includes('paraná') || combined.includes('santa catarina')) {
      matched.push('radios-sul');
    }
    if (region === 'co' || ['df', 'go', 'mt', 'ms'].includes(state) || combined.includes('brasília') || combined.includes('brasilia') || combined.includes('goiânia') || combined.includes('goiania') || combined.includes('senado') || combined.includes('câmara')) {
      matched.push('radios-co');
    }
    if (region === 'ne' || ['pe', 'ce', 'rn', 'pb', 'al', 'se', 'ma', 'pi'].includes(state) || combined.includes('recife') || combined.includes('fortaleza') || combined.includes('pernambuco') || combined.includes('ceará') || combined.includes('ceara') || combined.includes('natal') || combined.includes('maceio')) {
      matched.push('radios-ne');
    }
    if (region === 'norte' || ['am', 'pa', 'ro', 'ac', 'to', 'ap', 'rr'].includes(state) || combined.includes('manaus') || combined.includes('belém') || combined.includes('belem') || combined.includes('amazonas') || combined.includes('pará')) {
      matched.push('radios-norte');
    }
  }

  // SP & Mogi TV
  if (
    !isRadio &&
    (combined.includes('mogi') ||
    combined.includes('diario') ||
    combined.includes('diário') ||
    combined.includes('são paulo') ||
    combined.includes('sp') ||
    combined.includes('paulista') ||
    combined.includes('gazeta') ||
    combined.includes('jundiai') ||
    combined.includes('vale'))
  ) {
    matched.push('sp-mogi');
  }

  // Bahia TV
  if (
    !isRadio &&
    (combined.includes('bahia') ||
    combined.includes('aratu') ||
    combined.includes('salvador') ||
    combined.includes('tve bahia') ||
    combined.includes('itapoan') ||
    combined.includes('nordeste'))
  ) {
    matched.push('bahia');
  }

  // Canais Abertos
  if (
    !isRadio &&
    (combined.includes('globo') ||
    combined.includes('sbt') ||
    combined.includes('record') ||
    combined.includes('band') ||
    combined.includes('cultura') ||
    combined.includes('rede tv') ||
    combined.includes('redetv') ||
    combined.includes('tv brasil') ||
    combined.includes('futura') ||
    combined.includes('aberta') ||
    group.includes('general') ||
    group.includes('public') ||
    group.includes('abertos'))
  ) {
    matched.push('abertos');
  }

  // Notícias
  if (
    combined.includes('news') ||
    combined.includes('noticia') ||
    combined.includes('notícia') ||
    combined.includes('jornal') ||
    combined.includes('cnn') ||
    combined.includes('jovem pan') ||
    combined.includes('bm&c') ||
    combined.includes('agro') ||
    group.includes('news')
  ) {
    matched.push('noticias');
  }

  // Filmes
  if (
    combined.includes('filme') ||
    combined.includes('movie') ||
    combined.includes('cinema') ||
    combined.includes('amc') ||
    combined.includes('axn') ||
    combined.includes('adrenalina') ||
    combined.includes('telecine') ||
    combined.includes('tnt') ||
    group.includes('movies')
  ) {
    matched.push('filmes');
  }

  // Séries & Novelas
  if (
    combined.includes('serie') ||
    combined.includes('série') ||
    combined.includes('novela') ||
    combined.includes('plus sbt') ||
    group.includes('series')
  ) {
    matched.push('series');
  }

  // Kids / Infantil
  if (
    combined.includes('kid') ||
    combined.includes('infantil') ||
    combined.includes('desenho') ||
    combined.includes('bob esponja') ||
    combined.includes('baby') ||
    combined.includes('avatar') ||
    combined.includes('disney') ||
    combined.includes('cartoon') ||
    combined.includes('nickelodeon') ||
    group.includes('kids') ||
    group.includes('animation')
  ) {
    matched.push('infantil');
  }

  // Esportes
  if (
    combined.includes('esporte') ||
    combined.includes('sport') ||
    combined.includes('futebol') ||
    combined.includes('bandsports') ||
    combined.includes('inter') ||
    group.includes('sports')
  ) {
    matched.push('esportes');
  }

  // Documentários & Cultura
  if (
    combined.includes('documentar') ||
    combined.includes('arte') ||
    combined.includes('saude') ||
    combined.includes('saúde') ||
    combined.includes('educacao') ||
    combined.includes('educação') ||
    combined.includes('history') ||
    combined.includes('discovery') ||
    group.includes('documentary') ||
    group.includes('culture') ||
    group.includes('education')
  ) {
    matched.push('documentarios');
  }

  // Música & Rádios
  if (
    combined.includes('music') ||
    combined.includes('música') ||
    group.includes('music')
  ) {
    matched.push('musica');
  }

  // Religiosos
  if (
    combined.includes('relig') ||
    combined.includes('gospel') ||
    combined.includes('angel') ||
    combined.includes('boas novas') ||
    combined.includes('aparecida') ||
    combined.includes('cancao nova') ||
    group.includes('religious')
  ) {
    matched.push('religioso');
  }

  if (matched.length === 0) {
    matched.push('outros');
  }

  return matched;
}
