// Trivial shared component consumed by apps/web + apps/panel (D-12). The real
// design system lands in later phases — this proves the UI package wires into
// the Next apps and type-checks against the shared next.json preset.

export interface AppStatusProps {
  label: string;
}

export function AppStatus({ label }: AppStatusProps): React.JSX.Element {
  return <span data-testid="app-status">{label}</span>;
}
