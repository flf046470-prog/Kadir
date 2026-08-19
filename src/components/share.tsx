"use client";

import { useEffect, useState } from "react";
import { useNativeShare } from "./capabilities";

export type ShareLabels = { title: string; copy: string; copied: string; email: string };

/**
 * Uses the native share sheet where the device has one (phones), and falls back
 * to per-network links plus copy-to-clipboard everywhere else.
 */
export function ShareRow({
  url,
  text,
  labels,
  className = "",
}: {
  url: string;
  text: string;
  labels: ShareLabels;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const canNativeShare = useNativeShare();

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2200);
    return () => clearTimeout(timer);
  }, [copied]);

  const encodedUrl = encodeURIComponent(url);
  const encodedText = encodeURIComponent(text);

  const targets = [
    {
      key: "whatsapp",
      label: "WhatsApp",
      href: `https://wa.me/?text=${encodedText}%20${encodedUrl}`,
      path: "M12 2a10 10 0 0 0-8.5 15.2L2 22l4.9-1.4A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-2.9.8.8-2.8-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.6-6.1c-.3-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1-.2.3-.6.8-.8 1-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.6-1.2.1-.1 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3c-.3.3-.9.9-.9 2.1s.9 2.4 1 2.6c.1.2 1.8 2.8 4.4 3.9 1.6.7 2.3.8 3.1.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2 0-.1-.2-.2-.5-.3Z",
    },
    {
      key: "facebook",
      label: "Facebook",
      href: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
      path: "M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.4v7A10 10 0 0 0 22 12Z",
    },
    {
      key: "x",
      label: "X",
      href: `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedText}`,
      path: "M17.5 3h3.1l-6.8 7.8L21.8 21h-6.2l-4.9-6.4L5 21H1.9l7.3-8.3L2.2 3h6.3l4.4 5.8Zm-1.1 16h1.7L7.7 4.8H5.9Z",
    },
    {
      key: "email",
      label: labels.email,
      href: `mailto:?subject=${encodedText}&body=${encodedUrl}`,
      path: "M3 5.5h18v13H3v-13Zm1.8 1.8L12 12.4l7.2-5.1v-.1H4.8Zm14.4 9.4V9.5L12 14.6 4.8 9.5v7.2h14.4Z",
    },
  ];

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  async function nativeShare() {
    try {
      await navigator.share({ title: text, text, url });
    } catch {
      // The visitor dismissed the sheet — nothing to report.
    }
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <span className="label me-1 text-fog/60">{labels.title}</span>

      {canNativeShare ? (
        <button
          type="button"
          onClick={nativeShare}
          className="flex h-10 items-center gap-2 rounded-full border border-fog/20 px-4 text-xs tracking-wide text-snow transition-colors hover:border-ember hover:text-ember"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <path d="M12 16V4m0 0L8 8m4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M5 14v5h14v-5" strokeLinecap="round" />
          </svg>
          {labels.title}
        </button>
      ) : null}

      {targets.map((target) => (
        <a
          key={target.key}
          href={target.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={target.label}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-fog/20 text-fog transition-colors hover:border-ember hover:text-ember"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
            <path d={target.path} />
          </svg>
        </a>
      ))}

      <button
        type="button"
        onClick={copy}
        className="flex h-10 items-center gap-2 rounded-full border border-fog/20 px-4 text-xs tracking-wide text-fog transition-colors hover:border-ember hover:text-ember"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          {copied ? (
            <path d="m5 12.5 4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
          ) : (
            <>
              <rect x="9" y="9" width="11" height="11" rx="2" />
              <path d="M5 15V5h10" strokeLinecap="round" />
            </>
          )}
        </svg>
        <span aria-live="polite">{copied ? labels.copied : labels.copy}</span>
      </button>
    </div>
  );
}
