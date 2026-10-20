import { Logo } from './Logo';

export function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="narrow">
      <div className="brandblock"><Logo height={56} /></div>
      <div className="card">
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  );
}
