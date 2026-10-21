import type { NextConfig } from 'next';

/**
 * Заголовки безопасности (ТЗ v2 §9): запрет встраивания в чужие страницы, запрет угадывания типа, строгая
 * политика Referer, ограничение возможностей браузера (камера — только для фото-доказательств), HSTS в эксплуатации.
 */
const security = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=()' },
  ...(process.env.NODE_ENV === 'production' && process.env.APP_URL?.startsWith('https://')
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }] : []),
];

const config: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: security }];
  },
};

export default config;
