export interface RadioStation {
  name: string;
  state: string;
  city: string;
  genre: string;
  url: string;
  logo?: string;
  freq?: string;
  destaque?: boolean;
}

export type RadioCategoryKey =
  | 'destaques'
  | 'favoritos'
  | 'sp-mogi'
  | 'religioso'
  | 'sertanejo'
  | 'noticias'
  | 'flashback'
  | 'rj'
  | 'mg'
  | 'nordeste'
  | 'sul'
  | 'todos';

export interface RadioCategoryInfo {
  key: RadioCategoryKey;
  label: string;
  icon: string;
}
