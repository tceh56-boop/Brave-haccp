import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation } from '../src/server/org/organizations';
import { createProduct } from '../src/server/ops/catalog';
import { sbornikMatches, adoptSbornik } from '../src/server/ops/sbornik';
import { listNorms, normFor } from '../src/server/ops/processing';
import book from '../data/reference/sbornik2022.json';
import { makeUser, lastLinkToken } from './helpers';

/** Нормы отходов и потерь из Сборника рецептур (2022): подбор к товарам, внесение с основанием, сезонность. */

afterAll(() => closePool());

type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, cook: U, orgId: string;
const P: Record<string, string> = {};

beforeAll(async () => {
  owner = await makeUser();
  orgId = (await createOrganization(owner, { name: 'Кафе «Сборник»' })).organization.id;
  cook = await makeUser();
  await inviteMember(owner.id, orgId, { email: cook.email, role: 'line_staff' });
  await acceptInvitation(cook, await lastLinkToken(cook.email, 'invitation'));
  for (const name of ['Картофель', 'Огурцы свежие', 'Говядина бескостная охлажденная', 'Сливки 33%', 'Соус сливочный', 'Яблоки'])
    P[name] = (await createProduct(owner.id, orgId, { name, unit: 'кг' })).id;
});

describe('Справочник Сборника рецептур', () => {
  it('таблица с. 669–671 — дословные проценты; расхождения источника помечены', () => {
    const t = book.table;
    expect(t.length).toBe(80);
    const potato = t.filter((r) => r.name.startsWith('Картофель') && r.season);
    expect(potato.map((r) => r.pct)).toEqual([25, 30, 35, 40]);
    expect(t.find((r) => r.name === 'Лук, репчатый свежий сырой очищенный')!.pct).toBe(16);
    expect(t.find((r) => r.name.startsWith('Яблоко свежее с удаленным'))!.note).toMatch(/18 %/);
    expect(book.thermal.some((x) => x.name.startsWith('Говядина') && x.method === 'boil')).toBe(true);
  });

  it('подбор по товарам: картофель — таблица, говядина — холодная и тепловая по рецептурам; ложных совпадений нет', async () => {
    const r = await sbornikMatches(owner.id, orgId);
    const by = (n: string) => r.items.find((i) => i.product_name === n);
    expect(by('Картофель')!.candidates[0].kind).toBe('table');
    expect(by('Огурцы свежие')!.candidates.some((c) => c.name.includes('Огурцы, свежие'))).toBe(true);
    const beef = by('Говядина бескостная охлажденная')!.candidates;
    expect(beef.some((c) => c.kind === 'thermal' && c.method === 'boil')).toBe(true);
    expect(by('Сливки 33%')).toBeUndefined();          // не «слива»
    expect(by('Соус сливочный')).toBeUndefined();      // не «соус тар-тар»
  });

  it('повар вносить нормы не может; процент не из справочника — отказ', async () => {
    const key = (await sbornikMatches(owner.id, orgId)).items.find((i) => i.product_name === 'Говядина бескостная охлажденная')!.candidates.find((c) => c.kind === 'thermal')!.key;
    await expect(adoptSbornik(cook.id, orgId, { items: [{ productId: P['Картофель'], key: 'T02' }] })).rejects.toThrow();
    await expect(adoptSbornik(owner.id, orgId, { items: [{ productId: P['Говядина бескостная охлажденная'], key, pct: 12.345 }] })).rejects.toThrow(/не встречается/);
  });

  it('картофель: сезонная строка вносится со всеми сезонами и утверждается; на дату — своя норма', async () => {
    const r = await adoptSbornik(owner.id, orgId, { items: [{ productId: P['Картофель'], key: 'T03' }], approve: true });
    expect(r).toMatchObject({ created: 4, approved: 4 });
    const norms = (await listNorms(owner.id, orgId, { productId: P['Картофель'] })).norms as unknown as { status: string; basis: string }[];
    expect(norms.every((x) => x.status === 'approved' && /с\. 669/.test(x.basis))).toBe(true);
    const at = (d: string) => withSystem((tx) => normFor(tx, orgId, P['Картофель'], 'clean', d)).then((x) => Number(x.loss_pct));
    expect(await at('2026-10-15')).toBe(25);
    expect(await at('2026-12-01')).toBe(30);
    expect(await at('2027-02-10')).toBe(35);
    expect(await at('2027-05-01')).toBe(40);
  });

  it('тепловая норма по рецептурам — с номерами рецептур в основании; черновик без права утверждения', async () => {
    const c = (await sbornikMatches(owner.id, orgId)).items.find((i) => i.product_name === 'Говядина бескостная охлажденная')!.candidates.find((x) => x.kind === 'thermal' && x.method === 'boil')!;
    const alt = c.alternatives![c.alternatives!.length - 1];
    const r = await adoptSbornik(owner.id, orgId, { items: [{ productId: P['Говядина бескостная охлажденная'], key: c.key, pct: alt.pct }] });
    expect(r).toMatchObject({ created: 1, approved: 0 });
    const x = (await listNorms(owner.id, orgId, { productId: P['Говядина бескостная охлажденная'] })).norms[0] as unknown as { basis: string; method_code: string };
    expect(x).toMatchObject({ method_code: 'boil', status: 'draft', loss_pct: alt.pct });
    expect(x.basis).toContain(`№ ${alt.recipes[0]}`);
  });
});
