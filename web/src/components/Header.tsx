"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useEffect, useState } from "react";
import { useBlockNumber } from "wagmi";

export function Header() {
  const [dark, setDark] = useState(false);
  const { data: blockNumber } = useBlockNumber({ watch: true });

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.theme = next ? "dark" : "light";
    } catch {
      // Private browsing: the toggle still works for this page view.
    }
  }

  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--color-border)] pb-6">
      <div>
        <h1 className="text-2xl font-800">Ritual Predict</h1>
        <p className="mt-1 text-sm font-500 text-[var(--color-muted)]">
          Binary markets that settle themselves. No resolver, no cron job.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <span className="hidden text-xs font-600 text-[var(--color-muted)] sm:inline">
          {blockNumber ? `block ${blockNumber}` : "connecting"}
        </span>
        <button
          type="button"
          onClick={toggleTheme}
          className="btn-anim rounded-md border border-[var(--color-border)] px-3 py-2 text-xs font-700 hover:border-[var(--color-accent)]"
        >
          {dark ? "Light" : "Dark"}
        </button>
        <ConnectButton showBalance={false} />
      </div>
    </header>
  );
}
