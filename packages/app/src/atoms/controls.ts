import { atom } from 'jotai';
import type { Format, Layout } from '@vr-viewer/player';

export type RenderQuality =
  | 'auto'
  | '720p'
  | '1080p'
  | '2160p';

export const autoPlayAtom = atom(false);
export const autoDetectAtom = atom(true);
export const detectingAtom = atom(false);

export const layoutAtom = atom<Layout>('mono');
export const flipLayoutAtom = atom(false);

export const formatAtom = atom<Format>('screen');

export const renderQualityAtom = atom<RenderQuality>('auto');

export const debugAtom = atom(false);

export const videoUrlAtom = atom<string | null>(null);
