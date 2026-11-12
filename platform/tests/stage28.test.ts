import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { EacMark } from '../src/components/EacMark';

/** Знак ЕАС по масштабной сетке 9×9 (Положение о едином знаке обращения, решение КТС N 711, рис. 3). */
describe('Единый знак обращения ЕАС', () => {
  const svg = renderToStaticMarkup(createElement(EacMark, { sizeMm: 3 }));
  const cells = [...svg.matchAll(/<rect x="(\d)" y="(\d)"/g)].map((m) => [Number(m[2]) + 1, Number(m[1]) + 1]);
  const grid = Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => (cells.some(([y, x]) => y === r + 1 && x === c + 1) ? '█' : '·')).join(''));

  it('совпадает с рис. 3 построчно', () => {
    expect(grid).toEqual([
      '██·███·██',
      '█··█·█·█·',
      '█··█·█·█·',
      '█··█·█·█·',
      '██·███·█·',
      '█··█·█·█·',
      '█··█·█·█·',
      '█··█·█·█·',
      '██·█·█·██',
    ]);
  });

  it('квадрат, не менее 5 мм (п. 3.3), одноцветный (п. 5.2)', () => {
    expect(svg).toContain('viewBox="0 0 9 9"');
    expect(svg).toContain('width="5mm"');
    expect(new Set([...svg.matchAll(/fill="([^"]+)"/g)].map((m) => m[1])).size).toBe(1);
  });
});
