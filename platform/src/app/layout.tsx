import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'ЦЕХ', description: 'Единая система управления общепитом' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#3b2a1e' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
