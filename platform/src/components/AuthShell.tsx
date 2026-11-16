import { Logo } from './Logo';

/** Экран входа и регистрации в оформлении прежнего ЦЕХ: логотип на белой плашке, форма по центру. */
export function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="narrow auth">
      <div className="brandblock"><div className="plate"><Logo height={88} eyes="#fff" animated /></div></div>
      <div className="card">
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  );
}
