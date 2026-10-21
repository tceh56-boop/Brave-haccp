/**
 * Логотип «ЦЕХ»: башни с зубцами, «голова» с глазами и дуга — рисунок прежней системы ЦЕХ.
 * animated — как на экране загрузки прежней версии: маскот подпрыгивает и моргает, «Е» и «Х» въезжают.
 */
export function Logo({ height = 32, eyes = 'var(--bg)', animated = false }: { height?: number; eyes?: string; animated?: boolean }) {
  return (
    <svg viewBox="0 0 780 330" height={height} role="img" aria-label="ЦЕХ" className={animated ? 'ceh-anim' : undefined} style={{ display: 'block', overflow: 'visible' }}>
      <path fill="currentColor" d="M44,48 L66,58 L84,46 L84,84 L90,84 L90,52 L99,44 L100,160 L180,160 L180,48 L203,58 L214,44 L214,82 L221,82 L221,74 L240,68 L246,80 L262,66 L262,268 L198,268 L198,246 L44,246 Z" />
      <g className="ceh-mascot">
        <path fill="currentColor" d="M174,308 A58,50 0 0 1 290,308 L270,308 A38,32 0 0 0 194,308 Z" />
        <circle className="ceh-eye" cx="218" cy="238" r="8" fill={eyes} />
        <circle className="ceh-eye" cx="246" cy="238" r="8" fill={eyes} />
      </g>
      <path className="ceh-letter e" fill="currentColor" d="M314,66 L488,66 L488,118 L372,118 L372,132 L470,132 L470,178 L372,178 L372,194 L490,194 L490,246 L314,246 Z" />
      <path className="ceh-letter h" fill="currentColor" d="M506,66 L578,66 L616,124 L654,66 L724,66 L652,154 L728,246 L656,246 L616,186 L576,246 L504,246 L580,154 Z" />
    </svg>
  );
}
