import type { ElementType, ReactNode } from "react";

/**
 * Marks a block for the scroll-in reveal. The animation itself is driven from
 * one batched ScrollTrigger in <ScrollMotion />, so this stays a plain server
 * component and ships no JavaScript of its own.
 *
 * The `.reveal` class holds the hidden starting state; CSS restores it for
 * reduced motion, and <noscript> restores it when scripts never run.
 */
export function Reveal({
  children,
  as: Tag = "div",
  className = "",
  delay = 0,
  motion,
}: {
  children: ReactNode;
  as?: ElementType;
  className?: string;
  /** Kept for call sites that stagger manually; the batch also staggers. */
  delay?: number;
  /** Names this block for <ScrollMotion /> when it needs its own treatment. */
  motion?: string;
}) {
  return (
    <Tag
      className={`reveal ${className}`}
      data-motion={motion}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}
