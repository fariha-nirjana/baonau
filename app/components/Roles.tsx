"use client";

import { useEffect } from "react";
import { BRAND } from "@/lib/brand";
import { fill, strings } from "./i18n";
import { Icon } from "./icons";
import type { Role, Settings } from "./types";

/** The avatar for each role: the owner's initial on mint, the trusted contact's shield on blue. */
export function RoleAvatar({ role, settings, size = 36 }: { role: Role; settings: Settings; size?: number }) {
  const name = settings.language === "bn" ? BRAND.ownerBn : BRAND.owner;
  return role === "owner" ? (
    <span className="flex shrink-0 items-center justify-center rounded-full bg-mint text-sm font-semibold text-forest" style={{ width: size, height: size }}>
      {name.slice(0, 1)}
    </span>
  ) : (
    <span className="flex shrink-0 items-center justify-center rounded-full bg-sky-soft text-sky" style={{ width: size, height: size }}>
      <Icon name="shieldCheck" size={Math.round(size * 0.5)} />
    </span>
  );
}

/** Two rows, one per role. The one not in use opens the switch dialog. */
export function RolePicker({ settings, onPick }: { settings: Settings; onPick: (role: Role) => void }) {
  const t = strings(settings.language, settings.role);
  const name = settings.language === "bn" ? BRAND.ownerBn : BRAND.owner;
  const rows: { role: Role; title: string; note: string }[] = [
    { role: "owner", title: `${name} · ${t.roles.owner}`, note: t.roles.ownerNote },
    { role: "guardian", title: t.roles.contact, note: t.roles.contactNote },
  ];
  return (
    <div className="space-y-1">
      {rows.map((r) => {
        const active = settings.role === r.role;
        return (
          <button
            key={r.role}
            onClick={() => (active ? undefined : onPick(r.role))}
            aria-pressed={active}
            className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors ${active ? (r.role === "owner" ? "bg-mint/70" : "bg-sky-soft") : "hover:bg-cream"}`}
          >
            <RoleAvatar role={r.role} settings={settings} size={30} />
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-sm font-semibold ${active ? "" : "text-muted"}`}>{r.title}</span>
              <span className="block truncate text-xs text-faint">{r.note}</span>
            </span>
            <span className={`flex size-4 shrink-0 items-center justify-center rounded-full border-2 ${active ? (r.role === "owner" ? "border-leaf" : "border-sky") : "border-line"}`}>
              {active ? <span className={`size-1.5 rounded-full ${r.role === "owner" ? "bg-leaf" : "bg-sky"}`} /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Explains the role before switching to it. In a real app this would be signing in with a different key. */
export function RoleDialog({ to, settings, onCancel, onConfirm }: { to: Role; settings: Settings; onCancel: () => void; onConfirm: () => void }) {
  const t = strings(settings.language, settings.role);
  const owner = to === "owner";
  const role = owner ? t.roles.ownerLower : t.roles.contactLower;
  const can = (owner ? t.roles.ownerCan : t.roles.contactCan).split("\n");
  const cant = (owner ? t.roles.ownerCant : t.roles.contactCant).split("\n");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4 backdrop-blur-sm" onClick={onCancel}>
      <div role="dialog" aria-modal="true" aria-label={t.roles.switchEyebrow} className="slide-in w-full max-w-lg rounded-(--radius-card) bg-card p-8 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <p className="eyebrow">{t.roles.switchEyebrow}</p>
          <button onClick={onCancel} aria-label={t.roles.stay} className="-mt-2 -mr-2 rounded-lg p-2 text-muted hover:bg-cream hover:text-ink">
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <RoleAvatar role={to} settings={settings} size={44} />
          <h2 className="font-serif text-[1.9rem] leading-tight">{fill(t.roles.switchTitle, { role })}</h2>
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold tracking-wide text-leaf uppercase">{t.roles.can}</p>
            <ul className="mt-2 space-y-2 text-sm">
              {can.map((x) => (
                <li key={x} className="flex items-start gap-2">
                  <Icon name="check" size={15} strokeWidth={2.4} className="mt-0.5 shrink-0 text-leaf" />
                  {x}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold tracking-wide text-muted uppercase">{t.roles.cant}</p>
            <ul className="mt-2 space-y-2 text-sm text-muted">
              {cant.map((x) => (
                <li key={x} className="flex items-start gap-2">
                  <Icon name="x" size={15} strokeWidth={2.4} className="mt-0.5 shrink-0" />
                  {x}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p className="mt-6 rounded-xl bg-paper px-4 py-3 text-xs text-muted">{fill(t.roles.realNote, { role })}</p>
        <div className="mt-6 flex justify-end gap-2.5">
          <button onClick={onCancel} className="rounded-xl border border-line px-4 py-2.5 text-sm font-semibold hover:bg-paper">
            {t.roles.stay}
          </button>
          <button onClick={onConfirm} className={`rounded-xl px-4 py-2.5 text-sm font-semibold text-white ${owner ? "bg-forest hover:bg-forest-soft" : "bg-sky hover:brightness-110"}`}>
            {fill(t.roles.confirm, { role })}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Asks before pausing or unpausing, and says what happens. A mis-tap should not stop or start the AI. */
export function PauseDialog({ action, settings, onCancel, onConfirm }: { action: "pause" | "unpause"; settings: Settings; onCancel: () => void; onConfirm: () => void }) {
  const t = strings(settings.language, settings.role);
  const pausing = action === "pause";
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4 backdrop-blur-sm" onClick={onCancel}>
      <div role="dialog" aria-modal="true" aria-label={pausing ? t.pause.pauseTitle : t.pause.unpauseTitle} className="slide-in w-full max-w-md rounded-(--radius-card) bg-card p-8 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <span className="flex size-11 items-center justify-center rounded-xl bg-mint text-forest">
          <Icon name={pausing ? "pause" : "play"} size={20} />
        </span>
        <h2 className="mt-4 font-serif text-[1.8rem] leading-tight">{fill(pausing ? t.pause.pauseTitle : t.pause.unpauseTitle, { agent: BRAND.agent })}</h2>
        <p className="mt-2 text-[0.95rem] text-muted">{fill(pausing ? t.pause.pauseBody : t.pause.unpauseBody, { agent: BRAND.agent })}</p>
        {pausing ? <p className="mt-3 rounded-xl bg-paper px-4 py-3 text-xs text-muted">{settings.role === "guardian" ? t.pause.pauseContactNote : t.pause.pauseOwnerNote}</p> : null}
        <div className="mt-6 flex justify-end gap-2.5">
          <button onClick={onCancel} className="rounded-xl border border-line px-4 py-2.5 text-sm font-semibold hover:bg-paper">
            {t.pause.cancel}
          </button>
          <button onClick={onConfirm} className="flex items-center gap-2 rounded-xl bg-forest px-4 py-2.5 text-sm font-semibold text-white hover:bg-forest-soft">
            <Icon name={pausing ? "pause" : "play"} size={15} />
            {pausing ? t.pause.pauseConfirm : t.pause.unpauseConfirm}
          </button>
        </div>
      </div>
    </div>
  );
}
