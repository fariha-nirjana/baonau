"use client";

import { useState } from "react";
import { fill, LOCALE, strings } from "./i18n";
import { Icon } from "./icons";
import type { Act, AppState, Settings } from "./types";
import { Card } from "./ui";

type Letter = NonNullable<AppState["letter"]>;

const day = (iso: string, settings: Settings) => new Date(iso).toLocaleDateString(LOCALE[settings.language], { day: "numeric", month: "long", year: "numeric" });

/** The owner's note, quoted back to them when they ask for more risk. Never shown to the trusted contact. */
export function LetterQuote({ letter, settings, moment }: { letter: Letter; settings: Settings; moment: "beforeSign" | "whileWaiting" }) {
  const t = strings(settings.language, settings.role);
  return (
    <figure className="rounded-xl border border-sage/30 bg-mint/50 px-5 py-4">
      <figcaption className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-sage uppercase">
        <Icon name="mandate" size={13} />
        {fill(t.letter.fromYou, { date: day(letter.writtenAt, settings) })}
      </figcaption>
      <blockquote className="mt-2 font-serif text-[1.15rem] leading-snug whitespace-pre-wrap text-ink">“{letter.text}”</blockquote>
      <p className="mt-2 text-xs text-muted">{moment === "beforeSign" ? t.letter.beforeSign : t.letter.whileWaiting}</p>
    </figure>
  );
}

/** A text box for the note, used on the mandate page and when signing a first mandate. */
export function LetterField({ value, onChange, settings, rows = 3 }: { value: string; onChange: (v: string) => void; settings: Settings; rows?: number }) {
  const t = strings(settings.language, settings.role);
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      maxLength={600}
      placeholder={t.letter.placeholder}
      className="block w-full resize-none rounded-xl border border-line bg-paper px-4 py-3 font-serif text-[1.05rem] leading-snug outline-none placeholder:font-sans placeholder:text-sm placeholder:text-faint focus:border-sage"
    />
  );
}

/** The mandate page's card: write, read and edit the note. Owner only. */
export function LetterCard({ state, settings, act }: { state: AppState; settings: Settings; act: Act }) {
  const t = strings(settings.language, settings.role);
  const letter = state.letter;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(letter?.text ?? "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await act("owner", "letter", draft);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };
  const writing = editing || !letter;
  return (
    <Card className="p-7!">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-lg font-semibold">{t.letter.title}</h3>
        {letter && !editing ? (
          <button
            onClick={() => {
              setDraft(letter.text);
              setEditing(true);
            }}
            className="text-sm font-semibold text-leaf hover:underline"
          >
            {t.letter.edit}
          </button>
        ) : null}
      </div>
      {writing ? (
        <>
          <p className="mt-1 text-sm text-muted">{t.letter.intro}</p>
          <div className="mt-4">
            <LetterField value={draft} onChange={setDraft} settings={settings} />
          </div>
          <p className="mt-2 text-xs text-faint">{t.letter.example}</p>
          <div className="mt-4 flex justify-end gap-2.5">
            {editing ? (
              <button onClick={() => setEditing(false)} className="rounded-xl border border-line px-4 py-2 text-sm font-semibold hover:bg-paper">
                {t.letter.cancel}
              </button>
            ) : null}
            <button onClick={save} disabled={busy || !draft.trim()} className="rounded-xl bg-forest px-4 py-2 text-sm font-semibold text-white hover:bg-forest-soft disabled:opacity-50">
              {t.letter.save}
            </button>
          </div>
        </>
      ) : (
        <>
          <blockquote className="mt-4 border-l-2 border-sage pl-4 font-serif text-[1.2rem] leading-snug whitespace-pre-wrap">“{letter.text}”</blockquote>
          <p className="mt-2 pl-4 text-xs text-faint">{fill(t.letter.written, { date: day(letter.writtenAt, settings) })}</p>
        </>
      )}
      <p className="mt-4 flex items-start gap-2 text-xs text-faint">
        <Icon name="lock" size={13} className="mt-px shrink-0" />
        {t.letter.private}
      </p>
    </Card>
  );
}
