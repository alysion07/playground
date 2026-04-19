import type { ModeName } from '../state/types';

export type ModeDef = {
  name: ModeName;
  label: string;
  // Short tagline for the HUD.
  hint: string;
};

export const MODES: Record<ModeName, ModeDef> = {
  zen: {
    name: 'zen',
    label: 'Zen',
    hint: '자유롭게 쌓기',
  },
  tower: {
    name: 'tower',
    label: 'Tower',
    hint: '최대 높이 도전',
  },
};

export const MODE_ORDER: ModeName[] = ['zen', 'tower'];
