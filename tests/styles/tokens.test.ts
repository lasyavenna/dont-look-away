import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.cwd(), 'src/styles');
const tokensCss = readFileSync(join(dir, 'tokens.css'), 'utf8');

function rootVars(css: string): Record<string, string> {
  const block = css.match(/:root\s*\{([\s\S]*?)\n\}/)![1];
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const vars = rootVars(tokensCss);

type RGB = [number, number, number];
function hex(h: string): RGB {
  let s = h.replace('#', '');
  if (s.length === 3) s = [...s].map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) as RGB;
}
function lum([r, g, b]: RGB): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
function hue(h: string): { hue: number; sat: number } {
  const [r, g, b] = hex(h).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return { hue: 0, sat: 0 };
  let hh = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  hh = (hh * 60 + 360) % 360;
  const l = (max + min) / 2;
  return { hue: hh, sat: d / (1 - Math.abs(2 * l - 1)) };
}
const isRed = (h: string) => {
  const { hue: hh, sat } = hue(h);
  return sat > 0.25 && (hh <= 20 || hh >= 340);
};
const scale = (c: RGB, k: number): RGB => c.map((v) => v * k) as RGB;

const bg = hex(vars['--bg']);
const editorBg = hex(vars['--editor-bg']);
const fg = hex(vars['--fg']);

describe('design tokens (Req 20.1, 4.2, 18.2, 9.7)', () => {
  it('--bg is near-black (luminance <= 0.02)', () => {
    expect(lum(bg)).toBeLessThanOrEqual(0.02);
  });

  it('--fg and --muted have >= 4.5:1 on --bg', () => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hex(vars['--muted']), bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('every --syntax-* color has >= 4.5:1 on --editor-bg and is not red', () => {
    const keys = Object.keys(vars).filter((k) => k.startsWith('--syntax-'));
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      expect(contrast(hex(vars[k]), editorBg), k).toBeGreaterThanOrEqual(4.5);
      expect(isRed(vars[k]), `${k} is red`).toBe(false);
    }
  });

  it('--focus has >= 3:1 on --bg', () => {
    expect(contrast(hex(vars['--focus']), bg)).toBeGreaterThanOrEqual(3);
  });

  it('--accent has >= 4.5:1 on --bg (covers UI >= 3 and text use)', () => {
    const c = contrast(hex(vars['--accent']), bg);
    expect(c).toBeGreaterThanOrEqual(3);
    expect(c).toBeGreaterThanOrEqual(4.5);
  });

  it('exactly one red hex exists across src/styles/*.css: the --accent value', () => {
    expect(isRed(vars['--accent'])).toBe(true);
    const reds = new Set<string>();
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.css'))) {
      const css = readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of css.matchAll(/#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
        const h = m[0].slice(0, 7).toLowerCase();
        if (isRed(h.length === 7 || h.length === 4 ? h : m[0])) reds.add(h);
      }
    }
    expect([...reds]).toEqual([vars['--accent'].toLowerCase()]);
  });

  describe('per-level tokens', () => {
    const levels = ['calm', 'uneasy', 'distressed', 'critical'];
    const get = (lvl: string, name: string): number => {
      const m = tokensCss.match(new RegExp(`data-level='${lvl}'\\][^{]*\\{([^}]*)\\}`))!;
      return parseFloat(m[1].match(new RegExp(`${name}\\s*:\\s*([\\d.]+)`))![1]);
    };
    const series = (name: string) => levels.map((l) => get(l, name));

    it('scanline alpha is within [0.03, 0.08] with max <= 0.08', () => {
      const s = series('--crt-scanline-alpha');
      for (const v of s) {
        expect(v).toBeGreaterThanOrEqual(0.03);
        expect(v).toBeLessThanOrEqual(0.08);
      }
      expect(Math.max(...s)).toBeLessThanOrEqual(0.08);
    });

    it('worst-case scanline overlay (black @ alpha) keeps code >= 4.5:1', () => {
      for (const a of series('--crt-scanline-alpha').concat(0.08)) {
        expect(contrast(scale(fg, 1 - a), scale(editorBg, 1 - a))).toBeGreaterThanOrEqual(4.5);
        // stripe over fg text against un-striped bg row (worst mismatch)
        expect(contrast(scale(fg, 1 - a), editorBg)).toBeGreaterThanOrEqual(4.5);
        for (const k of Object.keys(vars).filter((x) => x.startsWith('--syntax-'))) {
          expect(contrast(scale(hex(vars[k]), 1 - a), editorBg), k).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    it('watcher opacity strictly increases, critical === 1', () => {
      const s = series('--watcher-opacity');
      for (let i = 1; i < s.length; i++) expect(s[i]).toBeGreaterThan(s[i - 1]);
      expect(s[3]).toBe(1);
    });

    it('vignette alpha strictly increases', () => {
      const s = series('--crt-vignette-alpha');
      for (let i = 1; i < s.length; i++) expect(s[i]).toBeGreaterThan(s[i - 1]);
    });
  });
});
