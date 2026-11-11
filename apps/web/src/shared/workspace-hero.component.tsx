import type { ReactNode } from 'react';

export interface WorkspaceHeroProps {
  icon: ReactNode;
  subtitle: string;
}

export function WorkspaceHero({ icon, subtitle }: WorkspaceHeroProps) {
  return (
    <header className="workspace-hero">
      <div className="workspace-hero__icon" aria-hidden="true">{icon}</div>
      <p className="workspace-hero__subtitle">{subtitle}</p>
    </header>
  );
}
