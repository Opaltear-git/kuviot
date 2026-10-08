import './style.css';
import { renderBloom, DNA_LEN, CDNA_LEN, VIEWBOX, type Params, type RenderOpts } from './bloom';
import { renderBush, bushView, BDNA_LEN, type BushParams, type Frame } from './bush';
import { renderTile, TILE } from './tile';
import { PALETTES } from './palettes';
import { mulberry32, randomGenes, mutateGenes } from './rng';

interface Specimen {
  dna: number[];   // flower shape
  cdna: number[];  // flower colors
  bdna: number[];  // bush layout
}
type Mode = 'flower' | 'bush' | 'tile';
const MODES: Mode[] = ['flower', 'bush', 'tile'];
const FRAMES: Frame[] = ['bush', 'panel', 'bookmark'];
const NOUN: Record<Mode, string> = { flower: 'bloom', bush: 'bush', tile: 'wallpaper' };

const rng = mulberry32((Math.random() * 2 ** 32) >>> 0);
const fresh = (): Specimen => ({
  dna: randomGenes(DNA_LEN, rng),
  cdna: randomGenes(CDNA_LEN, rng),
  bdna: randomGenes(BDNA_LEN, rng),
});

const state = {
  mode: 'flower' as Mode,
  current: fresh(),
  params: { lush: 0.55, open: 0.3, shape: 0.45, curl: 0.35 } as Params,
  bush: { density: 0.4, flourish: 0.3, mirror: true, frame: 'bush' } as BushParams,
  mutation: 0.35,
  palette: 0,
  children: [] as Specimen[],
  undo: [] as Specimen[],
};

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const stage = $('#stage');
const grid = $('#grid');
const palettesEl = $('#palettes');
const pal = () => PALETTES[state.palette];

function render(s: Specimen, opts: RenderOpts): string {
  if (state.mode === 'bush') return renderBush(s, state.params, state.bush, pal(), opts);
  if (state.mode === 'tile') return renderTile(s, state.params, state.bush, pal(), opts);
  return renderBloom(s.dna, s.cdna, state.params, pal(), opts);
}

// ---- breeding ---------------------------------------------------------------

function breed() {
  const amt = 0.03 + state.mutation * 0.3;
  const relayout = state.mode === 'flower' ? 0 : 0.2 + state.mutation * 0.6;
  state.children = Array.from({ length: 9 }, () => ({
    dna: mutateGenes(state.current.dna, rng, amt, state.mutation * 0.12),
    cdna: rng() < state.mutation * 0.6 ? mutateGenes(state.current.cdna, rng, 0.35, 0.2) : [...state.current.cdna],
    bdna: rng() < relayout ? randomGenes(BDNA_LEN, rng) : [...state.current.bdna],
  }));
}

function adopt(next: Specimen) {
  state.undo.push(state.current);
  if (state.undo.length > 100) state.undo.shift();
  state.current = next;
  breed();
  renderAll(true);
}

// ---- rendering --------------------------------------------------------------

function renderStage(animate: boolean) {
  stage.innerHTML = render(state.current, { animate });
}

function renderGrid(animate: boolean) {
  // Bushes and wallpapers have thousands of petals; animating each one in nine
  // thumbnails at once is too heavy, so those pop in as whole cards instead.
  const perPetal = animate && state.mode === 'flower';
  grid.replaceChildren(
    ...state.children.map((c, i) => {
      const b = document.createElement('button');
      b.className = 'child';
      b.title = `Pick (${i + 1})`;
      b.style.setProperty('--stagger', `${i * 45}ms`);
      b.innerHTML = render(c, { animate: perPetal, thumb: true });
      if (animate && !perPetal) b.classList.add('fresh');
      b.onclick = () => adopt(state.children[i]);
      return b;
    }),
  );
}

function renderChrome() {
  palettesEl.replaceChildren(
    ...PALETTES.map((p, i) => {
      const b = document.createElement('button');
      b.className = 'pal' + (i === state.palette ? ' active' : '');
      b.innerHTML =
        `<span class="sw" style="background:${p.bg}">` +
        [p.leaf, ...p.blooms].map((c) => `<span style="background:${c}"></span>`).join('') +
        `</span>${p.name}`;
      b.onclick = () => {
        state.palette = i;
        renderAll(false);
      };
      return b;
    }),
  );
  document.documentElement.style.setProperty('--stage-bg', pal().bg);
  document.body.dataset.mode = state.mode;
  document.body.dataset.frame = state.bush.frame;
  for (const b of document.querySelectorAll<HTMLElement>('[data-frame]')) {
    b.setAttribute('aria-pressed', String(b.dataset.frame === state.bush.frame));
  }
  for (const b of document.querySelectorAll<HTMLElement>('[data-mode]')) {
    b.setAttribute('aria-selected', String(b.dataset.mode === state.mode));
  }
  $('#new').textContent = `${state.mode === 'flower' ? '✿' : '❀'} New ${NOUN[state.mode]}`;
  $('#link').textContent = `Copy link to this ${NOUN[state.mode]}`;
}

function renderAll(animate: boolean) {
  renderChrome();
  renderStage(animate);
  renderGrid(animate);
  saveHash();
}

// Slider drags re-render at most once per frame, without the grow animation.
let raf = 0;
function renderLive() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    renderStage(false);
    renderGrid(false);
    saveHash();
  });
}

// ---- URL sharing --------------------------------------------------------------

// Byte layout: version, palette, mode, mirror, frame, then 0..1 values as bytes.
const HASH_VERSION = 3;
const HEADER = 12;

function encode(): string {
  const { lush, open, shape, curl } = state.params;
  const { dna, cdna, bdna } = state.current;
  const bytes = [
    HASH_VERSION,
    state.palette,
    MODES.indexOf(state.mode),
    state.bush.mirror ? 1 : 0,
    FRAMES.indexOf(state.bush.frame),
    ...[lush, open, shape, curl, state.mutation, state.bush.density, state.bush.flourish, ...dna, ...cdna, ...bdna].map((v) => Math.round(v * 255)),
  ];
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decode(s: string): boolean {
  try {
    let b = Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    // Upgrade older links: v1 had no layout bytes, v2 had no frame or flourish.
    if (b[0] === 1 && b.length === 7 + DNA_LEN + CDNA_LEN) {
      b = [3, b[1], 0, 1, 0, ...b.slice(2, 7), 102, 77, ...b.slice(7), ...randomGenes(BDNA_LEN, rng).map((v) => v * 255)];
    } else if (b[0] === 2 && b.length === 10 + DNA_LEN + CDNA_LEN + BDNA_LEN) {
      b = [3, b[1], b[2], b[3], 0, ...b.slice(4, 10), 77, ...b.slice(10)];
    }
    if (b[0] !== HASH_VERSION || b.length !== HEADER + DNA_LEN + CDNA_LEN + BDNA_LEN) return false;
    const f = b.map((v) => v / 255);
    state.palette = Math.min(b[1], PALETTES.length - 1);
    state.mode = MODES[b[2]] ?? 'flower';
    state.params = { lush: f[5], open: f[6], shape: f[7], curl: f[8] };
    state.mutation = f[9];
    state.bush = { mirror: !!b[3], frame: FRAMES[b[4]] ?? 'bush', density: f[10], flourish: f[11] };
    const c0 = HEADER + DNA_LEN, b0 = c0 + CDNA_LEN;
    state.current = { dna: f.slice(HEADER, c0), cdna: f.slice(c0, b0), bdna: f.slice(b0) };
    return true;
  } catch {
    return false;
  }
}

function saveHash() {
  history.replaceState(null, '', '#' + encode());
}

// ---- export -----------------------------------------------------------------

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const exportSvg = () => render(state.current, { background: true });

function savePng() {
  const box = state.mode === 'bush' ? bushView(state.bush) : state.mode === 'tile' ? { w: TILE, h: TILE } : VIEWBOX;
  const scale = 2000 / box.w;
  const img = new Image();
  const url = URL.createObjectURL(new Blob([exportSvg()], { type: 'image/svg+xml' }));
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(box.w * scale);
    canvas.height = Math.round(box.h * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    canvas.toBlob((b) => b && download(b, `kuviot-${Date.now()}.png`));
  };
  img.src = url;
}

let toastTimer = 0;
function toast(msg: string) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove('show'), 1600);
}

// ---- actions & wiring -----------------------------------------------------------

function setMode(mode: Mode) {
  if (mode === state.mode) return;
  state.mode = mode;
  breed();
  renderAll(true);
}

const actions = {
  new: () => adopt(fresh()),
  colors: () => adopt({ ...state.current, cdna: randomGenes(CDNA_LEN, rng) }),
  layout: () => adopt({ ...state.current, bdna: randomGenes(BDNA_LEN, rng) }),
  undo: () => {
    const prev = state.undo.pop();
    if (!prev) return toast('Nothing to undo');
    state.current = prev;
    breed();
    renderAll(true);
  },
  svg: () => download(new Blob([exportSvg()], { type: 'image/svg+xml' }), `kuviot-${Date.now()}.svg`),
  png: savePng,
  link: () => navigator.clipboard.writeText(location.href).then(() => toast('Link copied ✿')),
  rebreed: () => {
    breed();
    renderGrid(true);
  },
};

for (const [id, fn] of Object.entries(actions)) {
  $(`#${id}`).addEventListener('click', (e) => {
    fn();
    (e.currentTarget as HTMLElement).blur(); // so Space doesn't re-trigger the button
  });
}

for (const b of document.querySelectorAll<HTMLElement>('[data-mode]')) {
  b.addEventListener('click', () => {
    setMode(b.dataset.mode as Mode);
    b.blur();
  });
}

const paramInputs = document.querySelectorAll<HTMLInputElement>('input[data-param]');
for (const input of paramInputs) {
  const key = input.dataset.param as keyof Params;
  input.addEventListener('input', () => {
    state.params[key] = Number(input.value);
    renderLive();
  });
}

const mutationInput = $<HTMLInputElement>('#mutation');
mutationInput.addEventListener('input', () => {
  state.mutation = Number(mutationInput.value);
});
mutationInput.addEventListener('change', () => {
  breed();
  renderGrid(true);
  saveHash();
});

const densityInput = $<HTMLInputElement>('#density');
densityInput.addEventListener('input', () => {
  state.bush.density = Number(densityInput.value);
  renderLive();
});

const flourishInput = $<HTMLInputElement>('#flourish');
flourishInput.addEventListener('input', () => {
  state.bush.flourish = Number(flourishInput.value);
  renderLive();
});

for (const b of document.querySelectorAll<HTMLElement>('[data-frame]')) {
  b.addEventListener('click', () => {
    state.bush.frame = b.dataset.frame as Frame;
    renderAll(true);
    b.blur();
  });
}

const mirrorInput = $<HTMLInputElement>('#mirror');
mirrorInput.addEventListener('change', () => {
  state.bush.mirror = mirrorInput.checked;
  renderAll(true);
});

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === ' ') {
    e.preventDefault();
    actions.new();
  } else if (k === 'c') actions.colors();
  else if (k === 'z') actions.undo();
  else if (k === 'b') setMode(MODES[(MODES.indexOf(state.mode) + 1) % MODES.length]);
  else if (k === 'l' && state.mode !== 'flower') actions.layout();
  else if (/^[1-9]$/.test(k)) adopt(state.children[Number(k) - 1]);
});

// ---- boot -------------------------------------------------------------------

decode(location.hash.slice(1));
for (const input of paramInputs) input.value = String(state.params[input.dataset.param as keyof Params]);
mutationInput.value = String(state.mutation);
densityInput.value = String(state.bush.density);
flourishInput.value = String(state.bush.flourish);
mirrorInput.checked = state.bush.mirror;
breed();
renderAll(true);
