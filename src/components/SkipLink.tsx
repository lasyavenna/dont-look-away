import type { MouseEvent } from 'react';

export interface SkipLinkProps {
  /** id of the element that receives focus (used as href and as default target). */
  targetId: string;
  /** Visible, meaningful link text. */
  label?: string;
  /** Custom activation (e.g. focus the Code_Editor). Replaces the default focus of targetId. */
  onActivate?: () => void;
}

/** First focusable element on every screen; visible only while focused. */
export function SkipLink({ targetId, label = 'Skip to main content', onActivate }: SkipLinkProps) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    if (onActivate) {
      onActivate();
      return;
    }
    document.getElementById(targetId)?.focus();
  };
  return (
    <a href={`#${targetId}`} className="skip-link" onClick={handle}>
      {label}
    </a>
  );
}

export default SkipLink;
