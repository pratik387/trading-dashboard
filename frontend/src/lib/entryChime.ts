"use client";

import { useEffect, useRef, useState, useCallback } from "react";

/**
 * Plays a short chime when a NEW intraday position appears on the Live tab.
 *
 * The daemon runs headless on the VM, so the only place a sound can come from
 * is the dashboard in the user's browser. Browsers refuse to start audio
 * without a user gesture, so the AudioContext is created on the toggle click
 * and the preference is remembered per browser in localStorage.
 *
 * The chime is synthesised (two sine notes, a rising fifth) so there is no
 * asset to load and nothing to block. Positions are diffed by symbol against
 * the previous render: the first load after opening the page sets the
 * baseline silently, so opening the dashboard on an already-open book is quiet.
 */
const STORAGE_KEY = "intraday_entry_chime";

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function note(c: AudioContext, freq: number, at: number, dur: number, gain: number) {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(c.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

/** Two-note rising chime: A5 then E6, ~350 ms total. */
export function playEntryChime(): void {
  const c = getCtx();
  if (!c) return;
  const t = c.currentTime;
  note(c, 880, t, 0.18, 0.25);
  note(c, 1318.5, t + 0.14, 0.26, 0.25);
}

export function useEntryChime(symbols: string[], ready: boolean) {
  const [enabled, setEnabled] = useState(false);
  // Every symbol seen since the page opened. Chime only for a symbol never
  // seen this session, so a transient empty list (instance offline for a
  // poll, switching instances) does not re-announce the whole book.
  const seen = useRef<Set<string> | null>(null);
  const key = symbols.slice().sort().join("|");

  // Load the saved preference once on the client.
  useEffect(() => {
    try {
      setEnabled(window.localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      /* storage unavailable: stay off */
    }
  }, []);

  useEffect(() => {
    // Until the page has completed its first real load the list is just the
    // initial empty state; baselining on that would announce the whole open
    // book a moment later. Wait for `ready`.
    if (!ready) return;
    const now = key ? key.split("|") : [];
    if (seen.current === null) {
      seen.current = new Set(now);     // first real load: silent baseline
      return;
    }
    let added = 0;
    for (const s of now) {
      if (!seen.current.has(s)) {
        seen.current.add(s);
        added += 1;
      }
    }
    if (added > 0 && enabled) playEntryChime();
  }, [key, enabled, ready]);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      if (next) playEntryChime();      // inside the click: unlocks audio + confirms it works
      return next;
    });
  }, []);

  return { enabled, toggle };
}
