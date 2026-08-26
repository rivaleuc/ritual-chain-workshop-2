"use client";

import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={`card p-6 sm:p-8 ${className}`}>{children}</section>;
}

export function Label({ children }: { children: ReactNode }) {
  return (
    <span className="text-xs font-700 uppercase tracking-[0.08em] text-[var(--color-muted)]">
      {children}
    </span>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint ? (
        <span className="text-xs font-500 text-[var(--color-muted)]">{hint}</span>
      ) : null}
    </label>
  );
}

const inputBase =
  "w-full rounded-md border border-[var(--color-border)] bg-[var(--color-canvas)] px-3 py-2 text-sm font-600 text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputBase} ${props.className ?? ""}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputBase} ${props.className ?? ""}`} />;
}

type ButtonTone = "accent" | "yes" | "no" | "quiet";

const tones: Record<ButtonTone, string> = {
  accent:
    "bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-strong)] border-transparent",
  yes: "bg-[var(--color-yes)] text-white border-transparent",
  no: "bg-[var(--color-no)] text-white border-transparent",
  quiet:
    "bg-transparent text-[var(--color-ink)] border-[var(--color-border)] hover:border-[var(--color-accent)]",
};

export function Button({
  tone = "accent",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: ButtonTone }) {
  return (
    <button
      {...props}
      className={`btn-anim inline-flex items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-700 disabled:cursor-not-allowed disabled:opacity-50 ${tones[tone]} ${className}`}
    />
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "yes" | "no";
}) {
  const styles = {
    neutral:
      "bg-[var(--color-canvas)] text-[var(--color-muted)] border-[var(--color-border)]",
    accent: "bg-[var(--color-accent-soft)] text-[var(--color-accent)] border-transparent",
    yes: "bg-[var(--color-yes-soft)] text-[var(--color-yes)] border-transparent",
    no: "bg-[var(--color-no-soft)] text-[var(--color-no)] border-transparent",
  }[tone];

  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-700 ${styles}`}
    >
      {children}
    </span>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      <span className="text-sm font-700 text-[var(--color-ink)]">{value}</span>
    </div>
  );
}
