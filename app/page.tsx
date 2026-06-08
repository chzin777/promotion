import SettingsPanel from "./components/SettingsPanel";

export default function Home() {
  return (
    <div className="min-h-full bg-[var(--background)]">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(16,185,129,0.08),_transparent_55%)] dark:bg-[radial-gradient(ellipse_at_top,_rgba(52,211,153,0.06),_transparent_55%)]" />
      <SettingsPanel />
    </div>
  );
}
