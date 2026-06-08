"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AppSettings } from "@/lib/settings-types";
import { SETTINGS_DEFAULTS } from "@/lib/settings-types";

type Status = {
  remainingTotal: number;
  remainingMl: number;
  remainingAmazon: number;
  sentCount: number;
  amazonTagConfigured: boolean;
};

type SaveState = "idle" | "saving" | "saved" | "error";

function IconWhatsApp({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

function IconRefresh({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" strokeLinecap="round" />
      <path d="M21 3v6h-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.35)]" : "bg-zinc-300 dark:bg-zinc-600"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{label}</span>
      {hint ? <p className="mt-0.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{hint}</p> : null}
      <div className="mt-2.5">{children}</div>
    </label>
  );
}

const inputClass =
  "w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-sm text-zinc-900 shadow-sm transition-colors placeholder:text-zinc-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-100";

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: "emerald" | "blue" | "amber" | "ml" | "amazon";
}) {
  const ring =
    accent === "emerald"
      ? "from-emerald-500/10 to-transparent"
      : accent === "blue"
        ? "from-blue-500/10 to-transparent"
        : accent === "ml"
          ? "from-[#FFE600]/25 to-transparent"
          : accent === "amazon"
            ? "from-[#FF9900]/25 to-transparent"
            : "from-amber-500/10 to-transparent";

  return (
    <div className={`relative overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card)] p-5 shadow-sm`}>
      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${ring}`} />
      <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{value}</p>
      {sub ? <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{sub}</p> : null}
    </div>
  );
}

function SectionCard({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="animate-fade-in rounded-2xl border border-[var(--card-border)] bg-[var(--card)] shadow-sm">
      <div className="border-b border-[var(--card-border)] px-6 py-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {icon}
          </div>
          <div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
            {description ? (
              <p className="mt-1 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">{description}</p>
            ) : null}
          </div>
        </div>
      </div>
      <div className="space-y-5 p-6">{children}</div>
    </section>
  );
}

function PlatformCard({
  name,
  brand,
  enabled,
  onChange,
  description,
  warning,
  disabled,
}: {
  name: string;
  brand: "ml" | "amazon";
  enabled: boolean;
  onChange: (v: boolean) => void;
  description: string;
  warning?: string;
  disabled?: boolean;
}) {
  const brandStyles =
    brand === "ml"
      ? {
          gradient: "from-[#FFE600]/20 via-[#FFE600]/5 to-transparent",
          badge: "bg-[#FFE600] text-[#1a1a1a]",
          ring: enabled ? "ring-[#FFE600]/40" : "ring-transparent",
        }
      : {
          gradient: "from-[#FF9900]/20 via-[#FF9900]/5 to-transparent",
          badge: "bg-[#FF9900] text-white",
          ring: enabled ? "ring-[#FF9900]/40" : "ring-transparent",
        };

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card)] p-5 shadow-sm ring-2 transition-all duration-200 ${brandStyles.ring} ${
        enabled ? "opacity-100" : "opacity-75"
      }`}
    >
      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${brandStyles.gradient}`} />
      <div className="relative flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className={`rounded-lg px-2.5 py-1 text-xs font-bold tracking-wide ${brandStyles.badge}`}>
              {name}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                enabled
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                  : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
              }`}
            >
              {enabled ? "Ativo" : "Pausado"}
            </span>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{description}</p>
          {warning ? (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
              <span className="mt-0.5 shrink-0">⚠</span>
              {warning}
            </p>
          ) : null}
        </div>
        <Toggle checked={enabled} onChange={onChange} disabled={disabled} />
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="mx-auto max-w-4xl animate-pulse space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="h-16 rounded-2xl bg-zinc-200 dark:bg-zinc-800" />
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="h-28 rounded-2xl bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-28 rounded-2xl bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-28 rounded-2xl bg-zinc-200 dark:bg-zinc-800" />
      </div>
      <div className="h-64 rounded-2xl bg-zinc-200 dark:bg-zinc-800" />
      <div className="h-80 rounded-2xl bg-zinc-200 dark:bg-zinc-800" />
    </div>
  );
}

export default function SettingsPanel() {
  const [settings, setSettings] = useState<AppSettings>(SETTINGS_DEFAULTS);
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [toast, setToast] = useState<string | null>(null);
  const [poolText, setPoolText] = useState("11, 7, 15");
  const [amazonTagText, setAmazonTagText] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      setSettings(data.settings);
      setStatus(data.status);
      setPoolText(data.settings.sendIntervalPool.join(", "));
      setAmazonTagText(data.settings.amazonTag ?? "");
    } catch {
      showToast("Não foi possível carregar as configurações.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(true), 30_000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  async function save(partial: Partial<AppSettings>, toastMsg?: string) {
    setSaveState("saving");
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(partial),
      });
      const data = await res.json();
      if (res.status === 423) {
        showToast(data.error ?? "Pare a automação para editar.");
        await load(true);
        setSaveState("idle");
        return;
      }
      if (!res.ok) throw new Error("falha");
      setSettings(data.settings);
      setStatus(data.status);
      setPoolText(data.settings.sendIntervalPool.join(", "));
      setAmazonTagText(data.settings.amazonTag ?? "");
      setSaveState("saved");
      showToast(toastMsg ?? "Configuração salva — o worker aplica na próxima ação.");
      setTimeout(() => setSaveState("idle"), 2500);
    } catch {
      setSaveState("error");
      showToast("Erro ao salvar. Tente novamente.");
      setTimeout(() => setSaveState("idle"), 3000);
    }
  }

  function patch<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    if (settings.automationRunning) return;
    setSettings((prev) => ({ ...prev, [key]: value }));
    void save({ [key]: value });
  }

  function toggleAutomation() {
    const next = !settings.automationRunning;
    setSettings((prev) => ({ ...prev, automationRunning: next }));
    void save(
      { automationRunning: next },
      next
        ? "Automação iniciada — envios e coleta de links ativos."
        : "Automação pausada — nenhuma mensagem será enviada.",
    );
  }

  if (loading) return <Skeleton />;

  const locked = settings.automationRunning;

  return (
    <div className="relative mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
      {/* Header */}
      <header className="animate-fade-in mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500 text-white shadow-lg shadow-emerald-500/25">
            <IconWhatsApp className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-2xl">
              Promotion
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Painel de controle do bot de afiliados</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div
            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm ${
              settings.automationRunning
                ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300"
                : "border-[var(--card-border)] bg-[var(--card)] text-zinc-600 dark:text-zinc-300"
            }`}
          >
            <span className="relative flex h-2 w-2">
              {settings.automationRunning ? (
                <>
                  <span className="absolute inline-flex h-full w-full animate-pulse-dot rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </>
              ) : (
                <span className="relative inline-flex h-2 w-2 rounded-full bg-zinc-400" />
              )}
            </span>
            {settings.automationRunning ? "Rodando" : "Pausada"}
          </div>
          <div className="hidden rounded-full border border-[var(--card-border)] bg-[var(--card)] px-3 py-1.5 text-xs font-medium text-zinc-500 shadow-sm sm:block dark:text-zinc-400">
            {saveState === "saving"
              ? "Salvando…"
              : saveState === "saved"
                ? "Sincronizado"
                : saveState === "error"
                  ? "Erro"
                  : "Pronto"}
          </div>
          <button
            type="button"
            onClick={() => void load(true)}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--card-border)] bg-[var(--card)] text-zinc-500 shadow-sm transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
            title="Atualizar status"
          >
            <IconRefresh className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Automação */}
      <section
        className={`animate-fade-in mb-8 overflow-hidden rounded-2xl border shadow-sm ${
          settings.automationRunning
            ? "border-emerald-200 dark:border-emerald-900/60"
            : "border-[var(--card-border)]"
        }`}
      >
        <div
          className={`p-6 ${
            settings.automationRunning
              ? "bg-gradient-to-r from-emerald-50/80 to-transparent dark:from-emerald-950/30"
              : "bg-[var(--card)]"
          }`}
        >
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                {settings.automationRunning ? "Automação em execução" : "Automação aguardando início"}
              </h2>
              <p className="mt-2 max-w-lg text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                {settings.automationRunning
                  ? "O bot está enviando mensagens no WhatsApp e coletando novos links conforme as regras abaixo."
                  : "O worker fica conectado, mas só envia mensagens e busca links depois que você clicar em Iniciar."}
              </p>
            </div>
            <button
              type="button"
              onClick={toggleAutomation}
              disabled={saveState === "saving"}
              className={`shrink-0 rounded-xl px-6 py-3 text-sm font-semibold transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60 ${
                settings.automationRunning
                  ? "bg-zinc-900 text-white hover:bg-zinc-800 focus-visible:outline-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                  : "bg-emerald-500 text-white shadow-lg shadow-emerald-500/25 hover:bg-emerald-600 focus-visible:outline-emerald-500"
              }`}
            >
              {settings.automationRunning ? "Parar automação" : "Iniciar automação"}
            </button>
          </div>
        </div>
      </section>

      {/* Stats */}
      {status ? (
        <div className="animate-fade-in mb-8 grid gap-4 sm:grid-cols-3" style={{ animationDelay: "50ms" }}>
          <StatCard
            label="Links restantes"
            value={status.remainingTotal}
            sub={`${status.sentCount} já enviados`}
            accent="blue"
          />
          <StatCard
            label="Mercado Livre"
            value={status.remainingMl}
            sub="links ML na fila"
            accent="ml"
          />
          <StatCard
            label="Amazon"
            value={status.remainingAmazon}
            sub="links Amazon na fila"
            accent="amazon"
          />
        </div>
      ) : null}

      {locked ? (
        <p className="animate-fade-in mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          Automação em execução — pare para editar plataformas, tag Amazon e demais configurações.
        </p>
      ) : null}

      <div className={`space-y-6 ${locked ? "pointer-events-none opacity-55" : ""}`}>
        {/* Platforms */}
        <div className="animate-fade-in space-y-4" style={{ animationDelay: "100ms" }}>
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Plataformas
            </h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Ative ou pause cada loja independentemente.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <PlatformCard
              name="ML"
              brand="ml"
              enabled={settings.mlEnabled}
              onChange={(v) => patch("mlEnabled", v)}
              description="Descobre ofertas e gera links de afiliado via Portal do Mercado Livre."
              disabled={locked}
            />
            <PlatformCard
              name="Amazon"
              brand="amazon"
              enabled={settings.amazonEnabled}
              onChange={(v) => patch("amazonEnabled", v)}
              description="Busca produtos e monta links com sua tag de afiliado."
              warning={
                settings.amazonEnabled && !amazonTagText.trim()
                  ? "Informe sua tag de afiliado abaixo para gerar os links."
                  : undefined
              }
              disabled={locked}
            />
          </div>
          <Field
            label="Tag de afiliado Amazon"
            hint="Vai no parâmetro ?tag= dos links. Ex: sualoja-20"
          >
            <input
              className={inputClass}
              value={amazonTagText}
              disabled={locked}
              placeholder="xxxxx-20"
              onChange={(e) => setAmazonTagText(e.target.value)}
              onBlur={() => {
                if (locked) return;
                void save({ amazonTag: amazonTagText.trim() });
              }}
            />
          </Field>
        </div>

        {/* WhatsApp */}
        <div className="animate-fade-in" style={{ animationDelay: "150ms" }}>
          <SectionCard
            icon={<IconWhatsApp className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />}
            title="Envio no WhatsApp"
            description="Define o ritmo e a janela de horário em que as mensagens são postadas."
          >
            <div className="flex items-center justify-between gap-4 rounded-xl border border-zinc-100 bg-zinc-50/80 px-4 py-3.5 dark:border-zinc-800 dark:bg-zinc-900/40">
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Intervalo variável</p>
                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  Sorteia entre vários intervalos — parece mais natural.
                </p>
              </div>
              <Toggle
                checked={settings.useIntervalPool}
                onChange={(v) => patch("useIntervalPool", v)}
                disabled={locked}
              />
            </div>

            {settings.useIntervalPool ? (
              <Field label="Pool de intervalos" hint="Minutos separados por vírgula. Ex: 11, 7, 15">
                <input
                  className={inputClass}
                  value={poolText}
                  disabled={locked}
                  onChange={(e) => setPoolText(e.target.value)}
                  onBlur={() => {
                    if (locked) return;
                    const pool = poolText
                      .split(",")
                      .map((s) => Number(s.trim()))
                      .filter((n) => Number.isFinite(n) && n > 0);
                    if (pool.length) void save({ sendIntervalPool: pool });
                  }}
                />
              </Field>
            ) : (
              <Field label="Intervalo fixo" hint="Minutos entre cada envio.">
                <input
                  type="number"
                  min={1}
                  max={1440}
                  className={inputClass}
                  disabled={locked}
                  value={settings.sendIntervalMinutes}
                  onChange={(e) =>
                    setSettings({ ...settings, sendIntervalMinutes: Number(e.target.value) })
                  }
                  onBlur={() => {
                    if (locked) return;
                    void save({ sendIntervalMinutes: settings.sendIntervalMinutes });
                  }}
                />
              </Field>
            )}

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Início do horário" hint="Hora (0–23). Envios só depois deste horário.">
                <input
                  type="number"
                  min={0}
                  max={23}
                  className={inputClass}
                  value={settings.activeHoursStart}
                  onChange={(e) =>
                    setSettings({ ...settings, activeHoursStart: Number(e.target.value) })
                  }
                  onBlur={() => void save({ activeHoursStart: settings.activeHoursStart })}
                />
              </Field>
              <Field label="Fim do horário" hint="Hora (1–24). Para de enviar antes desta hora.">
                <input
                  type="number"
                  min={1}
                  max={24}
                  className={inputClass}
                  value={settings.activeHoursEnd}
                  onChange={(e) =>
                    setSettings({ ...settings, activeHoursEnd: Number(e.target.value) })
                  }
                  onBlur={() => void save({ activeHoursEnd: settings.activeHoursEnd })}
                />
              </Field>
            </div>
          </SectionCard>
        </div>

        {/* Feed */}
        <div className="animate-fade-in" style={{ animationDelay: "200ms" }}>
          <SectionCard
            icon={
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" strokeLinecap="round" />
              </svg>
            }
            title="Busca de novos links"
            description="Regras para descobrir produtos automaticamente e manter a fila abastecida."
          >
            <div className="flex items-center justify-between gap-4 rounded-xl border border-zinc-100 bg-zinc-50/80 px-4 py-3.5 dark:border-zinc-800 dark:bg-zinc-900/40">
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Coleta agendada</p>
                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  Busca automática 2× por dia (manhã e tarde).
                </p>
              </div>
              <Toggle
                checked={settings.autoFeedEnabled}
                onChange={(v) => patch("autoFeedEnabled", v)}
              />
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Horário da manhã" hint="Primeiro slot (0–23).">
                <input
                  type="number"
                  min={0}
                  max={23}
                  className={inputClass}
                  value={settings.feedAmHour}
                  onChange={(e) => setSettings({ ...settings, feedAmHour: Number(e.target.value) })}
                  onBlur={() => void save({ feedAmHour: settings.feedAmHour })}
                />
              </Field>
              <Field label="Horário da tarde" hint="Segundo slot (0–23).">
                <input
                  type="number"
                  min={0}
                  max={23}
                  className={inputClass}
                  value={settings.feedPmHour}
                  onChange={(e) => setSettings({ ...settings, feedPmHour: Number(e.target.value) })}
                  onBlur={() => void save({ feedPmHour: settings.feedPmHour })}
                />
              </Field>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Produtos ML por coleta" hint="Quantidade quando o ML estiver ativo.">
                <input
                  type="number"
                  min={0}
                  max={100}
                  className={inputClass}
                  value={settings.feedCount}
                  onChange={(e) => setSettings({ ...settings, feedCount: Number(e.target.value) })}
                  onBlur={() => void save({ feedCount: settings.feedCount })}
                />
              </Field>
              <Field label="Produtos Amazon por coleta" hint="Quantidade quando a Amazon estiver ativa.">
                <input
                  type="number"
                  min={0}
                  max={100}
                  className={inputClass}
                  value={settings.amazonFeedCount}
                  onChange={(e) =>
                    setSettings({ ...settings, amazonFeedCount: Number(e.target.value) })
                  }
                  onBlur={() => void save({ amazonFeedCount: settings.amazonFeedCount })}
                />
              </Field>
            </div>

            <Field
              label="Coleta reativa"
              hint="Quando a fila tiver esta quantidade ou menos, busca mais links na hora. Use 0 para desativar."
            >
              <input
                type="number"
                min={0}
                max={50}
                className={inputClass}
                value={settings.feedReactiveThreshold}
                onChange={(e) =>
                  setSettings({ ...settings, feedReactiveThreshold: Number(e.target.value) })
                }
                onBlur={() => void save({ feedReactiveThreshold: settings.feedReactiveThreshold })}
              />
            </Field>
          </SectionCard>
        </div>
      </div>

      <footer className="mt-10 pb-6 text-center text-xs text-zinc-400 dark:text-zinc-500">
        Inicie a automação pelo botão acima. Configurações são salvas automaticamente.
      </footer>

      {/* Toast */}
      {toast ? (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-fade-in rounded-xl border border-[var(--card-border)] bg-[var(--card)] px-4 py-3 text-sm font-medium text-zinc-800 shadow-lg dark:text-zinc-100"
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}
