export interface Palette {
  name: string;
  bg: string;
  stem: string;
  leaf: string;
  /** Lighter/darker leaf tone for leaf veins and insets. */
  leaf2: string;
  /** High-contrast accent for flower centers. */
  ink: string;
  /** Bloom colors; layers cycle through these so neighbours never match. */
  blooms: string[];
}

export const PALETTES: Palette[] = [
  {
    name: 'Łowicz',
    bg: '#fbf6ec', stem: '#2f7d3a', leaf: '#2f8f3a', leaf2: '#8ccf5a', ink: '#1d1a3a',
    blooms: ['#e8262b', '#f7a21b', '#1f4fb3', '#ec5aa0', '#ffd33d'],
  },
  {
    name: 'Peacock',
    bg: '#ffffff', stem: '#1e8e46', leaf: '#1e9e48', leaf2: '#7fd36b', ink: '#141a5c',
    blooms: ['#1b2a8f', '#e01e5a', '#2fa4e7', '#7b2d9b', '#ffcc00', '#f8a8c4'],
  },
  {
    name: 'Folk Night',
    bg: '#13202e', stem: '#1f8a8a', leaf: '#1f8a8a', leaf2: '#59c3b8', ink: '#fff1d0',
    blooms: ['#f2545b', '#ffb03b', '#ffd166', '#ef6f9a', '#3db2c4'],
  },
  {
    name: 'Marigold',
    bg: '#fffaf0', stem: '#2d2340', leaf: '#2d2340', leaf2: '#5a4a78', ink: '#2d2340',
    blooms: ['#ff6a00', '#ffb000', '#d7261e', '#ffd84a'],
  },
  {
    name: 'Lavender',
    bg: '#fbf9ff', stem: '#4e9a34', leaf: '#5aa83a', leaf2: '#a6d96a', ink: '#2a1c78',
    blooms: ['#7b5cf0', '#3c2a9e', '#ff3fa4', '#ffd23f', '#a98bff'],
  },
  {
    name: 'Fuchsia',
    bg: '#fff7fb', stem: '#3c9e3c', leaf: '#3c9e3c', leaf2: '#9be07a', ink: '#5a0f3c',
    blooms: ['#ff5fc8', '#e8264f', '#ff9ad5', '#2fb9e0', '#b0186e'],
  },
  {
    name: 'Nordic',
    bg: '#f3efe6', stem: '#3b6b4c', leaf: '#3b6b4c', leaf2: '#7ea88a', ink: '#1d2b3f',
    blooms: ['#c8102e', '#1d3f6e', '#e9b949', '#7fa7c9'],
  },
  {
    name: 'Otomí',
    bg: '#fffdf8', stem: '#00994d', leaf: '#00994d', leaf2: '#7ac143', ink: '#2b1145',
    blooms: ['#e6007e', '#00a1e4', '#ff8c00', '#6a2c91', '#ffd400'],
  },
  {
    name: 'Khokhloma',
    bg: '#141010', stem: '#c99a2e', leaf: '#3e7d32', leaf2: '#c99a2e', ink: '#fff3c4',
    blooms: ['#d62a1f', '#f4b400', '#ff6f3c', '#ffe08a'],
  },
  {
    name: 'Spring',
    bg: '#fff8f0', stem: '#7fb377', leaf: '#8cc084', leaf2: '#c5e3b5', ink: '#5b4a6b',
    blooms: ['#f7a8b8', '#a8d8ea', '#ffc98b', '#c3aed6', '#fd8a8a'],
  },
  {
    name: 'Ochre',
    bg: '#f1e4cc', stem: '#5b7240', leaf: '#5b7240', leaf2: '#97a86a', ink: '#2e2418',
    blooms: ['#b5432a', '#d98e32', '#3d5a80', '#e6c36a', '#8a3b52'],
  },
  {
    name: 'Jewel',
    bg: '#1a1033', stem: '#22c55e', leaf: '#16a34a', leaf2: '#86efac', ink: '#fff4e0',
    blooms: ['#ff4d8d', '#ffb347', '#7ee8fa', '#c084fc', '#fde047'],
  },
];
