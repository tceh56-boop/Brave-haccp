'use client';
import { Suspense, use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useOrg } from '@/lib/org';
import { api } from '@/lib/api';
import { dmy, fx, orgTitle, type DocLine, type TtkDoc } from '@/lib/ttkdoc';

/**
 * Обоснование расчётов пищевой и энергетической ценности, физико-химических и микробиологических показателей
 * (методика Методических указаний по лабораторному контролю качества продукции общественного питания, 1997;
 * по образцу Шеф Эксперта): таблица 1 по ингредиентам и пошаговые расчёты 1–6.
 */
export default function BasisPage({ params }: { params: Promise<{ dishId: string }> }) {
  return <Suspense fallback={<p className="muted">Загрузка…</p>}><Doc params={params} /></Suspense>;
}

const M = 'Методических указаниях по лабораторному контролю качества продукции общественного питания, М., 1997 (Письмо № 1-40/3805 от 11.11.91)';

function Doc({ params }: { params: Promise<{ dishId: string }> }) {
  const { dishId } = use(params);
  const v = useSearchParams().get('v');
  const { org } = useOrg();
  const [d, setD] = useState<TtkDoc | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api<TtkDoc>(`/orgs/${org.id}/dishes/${dishId}/ttk-doc${v ? `?versionId=${v}` : ''}`).then(setD).catch((e) => setErr(e.message)); }, [org.id, dishId, v]);
  if (err) return <div className="err">{err}</div>;
  if (!d) return <p className="muted">Загрузка…</p>;
  const items = d.lines.filter((l) => l.kind === 'item');
  const first = items.find((l) => l.in_yield && l.per100) as DocLine | undefined;
  const ph = d.physico, out = fx(d.out_g, 0), nt = d.nutrition;
  const firstDry = items.find((l) => l.in_yield && l.dry_100 !== null);
  const firstFat = items.find((l) => l.in_yield && l.fat_mass_100 !== null);
  const firstSugar = items.find((l) => l.in_yield && l.sucrose_100 !== null);
  const yn = (b: boolean) => (b ? 'Да' : 'Нет');
  return (
    <>
      <div className="noprint">
        <p className="small"><Link href={`/app/${org.id}/menu/${dishId}/ttk-docs?v=${d.version.id}`}>← Документы ТТК</Link></p>
        <button className="btn block" onClick={() => window.print()}>Печать / сохранить PDF</button>
      </div>
      <article className="tu-doc">
        <table style={{ border: 0 }}><tbody><tr>
          <td style={{ border: 0, width: '55%' }}><div style={{ borderBottom: '1px solid #111' }}>{orgTitle(d.org)}</div>{d.sites[0] && <div>{d.sites.join(', ')}</div>}</td>
          <td style={{ border: 0, textAlign: 'right' }}>Утверждаю<br />Руководитель ____________<br /><br />Расчёт произвёл<br />Заведующий производством (шеф-повар) ____________</td>
        </tr></tbody></table>
        <h1>Обоснование проведённых расчётов пищевой и энергетической ценности, физико-химических и микробиологических показателей блюда «{d.dish.name}», ТТК № {d.dish.card_no || '—'} от {dmy(d.version.card_date)}</h1>

        <h2 className="tu-center" style={{ border: 0 }}>1. Расчёт пищевой и энергетической ценности блюда</h2>
        <p>Расчёт пищевой и энергетической ценности блюда ведём на основании методики, приведённой в {M}.</p>
        {first && first.per100 && first.in_dish && first.with_losses && <>
          <p>1.1. Определяем содержание белка в первом ингредиенте рецептуры — «{first.name}». Содержание белка в 100 г ингредиента — {fx(first.per100.protein)} г ({first.source}).
            Масса нетто ингредиента по рецептуре — {fx(first.netto_g, 1)} г, следовательно, количество белка в ингредиенте = {fx(first.netto_g, 1)} / 100 × {fx(first.per100.protein)} = {fx(first.in_dish.protein)} г (ст. 7 табл. 1).
            {first.nutr_loss && first.nutr_loss.protein > 0 ? ` Потери белка при тепловой обработке — ${fx(first.nutr_loss.protein, 1)} % (ст. 10 табл. 1).` : ' Потери белка при тепловой обработке — 0 % (ст. 10 табл. 1).'}</p>
          <p>1.2. Потери продукта после тепловой обработки — {fx(first.after_loss, 1)} % (ст. 13 табл. 1), поэтому итоговое количество белка в ингредиенте = {fx(first.with_losses.protein)} г (ст. 14 табл. 1).</p>
          <p>1.3. Ингредиент «{first.name}» {first.in_yield ? 'УЧИТЫВАЕТСЯ' : 'НЕ УЧИТЫВАЕТСЯ'} в выходе блюда (ст. 17 табл. 1), поэтому содержание белка {first.in_yield ? 'УЧИТЫВАЕТСЯ' : 'НЕ УЧИТЫВАЕТСЯ'} в общем содержании белка в блюде.</p>
          <p>1.4. Аналогично определяем содержание углеводов и жиров в ингредиенте.</p>
          <p>1.5. Таким же способом определяем содержание белков, жиров и углеводов по всем ингредиентам в блюде и заносим полученные данные в таблицу 1.</p>
        </>}
        <h3 className="tu-center">Таблица 1. Расчёт пищевой ценности блюда «{d.dish.name}»</h3>
        <div className="scroll"><table style={{ fontSize: '8pt' }}>
          <thead>
            <tr><th rowSpan={2}>№</th><th rowSpan={2}>Наименование ингредиента</th><th rowSpan={2}>Вес нетто, г</th><th colSpan={3}>Содерж. пищ. в-в на 100 г продукта</th><th colSpan={3}>Содерж. пищ. в-в в блюде, г</th>
              <th colSpan={3}>Потери пищ. в-в при тепл. обраб., %</th><th rowSpan={2}>Потери продукта после тепл. обраб., %</th><th colSpan={3}>Содерж. в блюде с учётом потерь, г</th><th rowSpan={2}>Учит. в расчёте</th></tr>
            <tr>{['Б', 'Ж', 'У', 'Б', 'Ж', 'У', 'Б', 'Ж', 'У', 'Б', 'Ж', 'У'].map((h, i) => <th key={i}>{h}</th>)}</tr>
            <tr>{Array.from({ length: 17 }, (_, i) => <th key={i} className="tu-center">{i + 1}</th>)}</tr>
          </thead>
          <tbody>{items.map((l, i) => (
            <tr key={i}><td>{i + 1}</td><td>{l.name}</td><td>{fx(l.netto_g, 1)}</td>
              <td>{fx(l.per100?.protein)}</td><td>{fx(l.per100?.fat)}</td><td>{fx(l.per100?.carbs)}</td>
              <td>{fx(l.in_dish?.protein)}</td><td>{fx(l.in_dish?.fat)}</td><td>{fx(l.in_dish?.carbs)}</td>
              <td>{l.nutr_loss ? fx(l.nutr_loss.protein, 1) : '?'}</td><td>{l.nutr_loss ? fx(l.nutr_loss.fat, 1) : '?'}</td><td>{l.nutr_loss ? fx(l.nutr_loss.carbs, 1) : '?'}</td>
              <td>{fx(l.after_loss, 1)}</td>
              <td>{l.in_yield ? fx(l.with_losses?.protein) : '-'}</td><td>{l.in_yield ? fx(l.with_losses?.fat) : '-'}</td><td>{l.in_yield ? fx(l.with_losses?.carbs) : '-'}</td><td>{yn(l.in_yield)}</td></tr>))}
            {nt && <tr><td colSpan={13} style={{ textAlign: 'right', border: 0 }}>Итого:</td><td>{fx(nt.total.protein)}</td><td>{fx(nt.total.fat)}</td><td>{fx(nt.total.carbs)}</td><td style={{ border: 0 }} /></tr>}
          </tbody>
        </table></div>
        {nt ? <>
          <p>1.6. Суммируем общее количество белков, жиров и углеводов в блюде.</p>
          <p>1.7. Умножаем соответствующие значения на коэффициенты калорийности (ТР ТС 022/2011): белки × 4, жиры × 9, углеводы × 4, получаем калорийность блюда = {fx(nt.total.protein)} × 4 + {fx(nt.total.fat)} × 9 + {fx(nt.total.carbs)} × 4 = {fx(nt.total.kcal)} ккал ({fx(nt.total.kj, 0)} кДж).</p>
          <p>1.8. Суммарный выход блюда составляет {out} г. Калорийность 100 г блюда = {fx(nt.total.kcal)} / {out} × 100 = {fx(nt.per100.kcal)} ккал.</p>
        </> : <p className="tu-warn">Пищевая ценность не рассчитана — нет данных о пищевой ценности сырья.</p>}
        {d.missing.nutrition.length > 0 && <p className="tu-warn">Неполные данные: {d.missing.nutrition.join('; ')}.</p>}

        <h2 className="tu-center" style={{ border: 0 }}>2. Расчёт массовой доли сухих веществ</h2>
        {!ph.dry.normed ? <p>В соответствии с приложением 2 {M.replace('Методических указаниях', 'Методических указаний')}, в данной категории блюд массовая доля сухих веществ НЕ ОПРЕДЕЛЯЕТСЯ.</p>
          : ph.dry.missing.length ? <p className="tu-warn">Не рассчитано: {ph.dry.missing.join('; ')}.</p> : <>
            {firstDry && <p>2.1. Содержание сухих веществ в 100 г ингредиента «{firstDry.name}» — {fx(firstDry.dry_100)} г. Масса нетто — {fx(firstDry.netto_g, 1)} г; с учётом потерь продукта после тепловой обработки ({fx(firstDry.after_loss, 1)} %) количество сухих веществ = {fx(firstDry.dry_g)} г.</p>}
            <p>2.2. Аналогично определяем содержание сухих веществ по всем ингредиентам, учитываемым в выходе, и суммируем.</p>
            <p>2.3. Процентное содержание сухих веществ = сумма × 100 / выход ({out} г) = {fx(ph.dry.theoretical_pct)} %.</p>
            <p>2.4. Суммируем с максимально допустимым содержанием соли в блюде ({fx(d.params.saltMaxPct)} %): максимальное (теоретическое) содержание сухих веществ = {fx(ph.dry.max)} %.</p>
            <p>2.5. Минимально допустимое содержание сухих веществ = {fx(d.params.dryCoef)} × {fx(ph.dry.max)} = {fx(ph.dry.min)} %.</p>
          </>}

        <h2 className="tu-center" style={{ border: 0 }}>3. Расчёт массовой доли жира</h2>
        {!ph.fat.normed ? <p>В данной категории блюд массовая доля жира НЕ ОПРЕДЕЛЯЕТСЯ.</p>
          : ph.fat.missing.length ? <p className="tu-warn">Не рассчитано: {ph.fat.missing.join('; ')}.</p> : <>
            <p>3.1. Количество чистого жира учитывается только в основных жиросодержащих ингредиентах ({ph.fat.ingredients.join(', ')}): масса нетто × массовая доля жира / 100. Природным жиром в крупах, мясных продуктах и т. п. пренебрегаем.</p>
            {firstFat && <p>3.2. «{firstFat.name}»: {fx(firstFat.netto_g, 1)} × {fx(firstFat.fat_mass_100)} / 100 с учётом потерь продукта после тепловой обработки ({fx(firstFat.after_loss, 1)} %) = {fx(firstFat.fat_mass_g)} г.</p>}
            <p>3.3. Максимальное содержание жира в блюде = сумма × 100 / выход ({out} г) = {fx(ph.fat.max)} %.</p>
            <p>3.4. Минимально допустимое содержание жира рассчитываем с учётом погрешности метода его лабораторного определения (метод Гербера, {fx(d.params.gerberPct, 0)} %): {fx(ph.fat.min)} %.</p>
          </>}

        <h2 className="tu-center" style={{ border: 0 }}>4. Расчёт массовой доли сахара</h2>
        {!ph.sugar.normed ? <p>В данной категории блюд массовая доля сахара НЕ ОПРЕДЕЛЯЕТСЯ.</p>
          : ph.sugar.missing.length ? <p className="tu-warn">Не рассчитано: {ph.sugar.missing.join('; ')}.</p> : <>
            <p>4.1. Количество сахара учитывается только в ингредиентах с сахарозой ({ph.sugar.ingredients.join(', ')}): масса нетто × содержание сахарозы / 100.</p>
            {firstSugar && <p>4.2. «{firstSugar.name}»: {fx(firstSugar.netto_g, 1)} × {fx(firstSugar.sucrose_100)} / 100 = {fx(firstSugar.sugar_g)} г.</p>}
            <p>4.3. Сумма умножается на коэффициент, учитывающий потери сахарозы ({fx(d.params.sugarCoef)}); массовая доля сахара = {fx(ph.sugar.value)} %.</p>
          </>}

        <h2 className="tu-center" style={{ border: 0 }}>5. Расчёт массовой доли соли</h2>
        {!ph.salt.normed ? <p>В данной категории блюд массовая доля соли НЕ ОПРЕДЕЛЯЕТСЯ.</p>
          : ph.salt.missing.length ? <p className="tu-warn">Не рассчитано: {ph.salt.missing.join('; ')}.</p>
            : <p>5.1. Содержание соли в блюде принимаем по нормам {M.replace('Методических указаниях', 'Методических указаний')}, равное {fx(ph.salt.value)} %.</p>}
        {ph.basis && <p className="tu-small">Основание параметров: {ph.basis}.</p>}

        <h2 className="tu-center" style={{ border: 0 }}>6. Микробиологические показатели</h2>
        <p>6.1. Для определения микробиологических показателей качества руководствуемся {d.micro_index || 'ТР ТС 021/2011 «О безопасности пищевой продукции» (группа продукции не указана)'}.</p>
        {d.micro.some((m) => !m.norm) && <p className="tu-warn">Не заполнены нормативы: {d.micro.filter((m) => !m.norm).map((m) => m.code).join(', ')}.</p>}
      </article>
    </>
  );
}
