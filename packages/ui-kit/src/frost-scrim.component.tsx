/** Progressive CSS blur behind floating chrome. The host supplies its height. */
export function FrostScrim({ className = '' }: { className?: string }) {
  return <div className={`ui-frost-scrim ${className}`} aria-hidden="true">
    <span/>
    <span/>
    <span/>
  </div>;
}
