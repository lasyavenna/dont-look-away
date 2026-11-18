import { useGame } from '../app/GameProvider';
import '../styles/watcher.css';

/**
 * The Watcher: decorative inline SVG (no network, no text alternative).
 * `watcher--noticed` is applied only while phase === 'playing' and the
 * round's noticedActive flag is set, derived in the same render as the phase.
 */
export function Watcher() {
  const { state } = useGame();
  const noticed = state.phase === 'playing' && state.round?.noticedActive === true;
  const className = `play-screen__watcher watcher${noticed ? ' watcher--noticed' : ''}`;

  return (
    <div className={className}>
      <svg viewBox="0 0 120 240" aria-hidden="true" focusable="false" role="presentation">
        <defs>
          <radialGradient id="watcher-glow" cx="50%" cy="38%" r="60%">
            <stop offset="0" stopColor="#d9d9d4" stopOpacity="0.9" />
            <stop offset="0.7" stopColor="#8d8d89" stopOpacity="0.55" />
            <stop offset="1" stopColor="#141416" stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* gaunt, too-long head and neck emerging from darkness */}
        <path
          className="watcher__head"
          d="M60 6 C84 6 94 34 92 66 C91 92 84 112 78 136 C76 160 72 190 70 240 L50 240 C48 190 44 160 42 136 C36 112 29 92 28 66 C26 34 36 6 60 6 Z"
          fill="url(#watcher-glow)"
        />
        {/* hollow cheeks */}
        <path d="M38 104 C44 118 46 130 50 142" className="watcher__hollow" fill="none" />
        <path d="M82 104 C76 118 74 130 70 142" className="watcher__hollow" fill="none" />
        {/* secondary eyes: almost invisible, fade in and out */}
        <g className="watcher__ghost-eyes">
          <ellipse cx="44" cy="52" rx="5" ry="2" />
          <ellipse cx="76" cy="52" rx="5" ry="2" />
        </g>
        {/* the one large eye */}
        <g className="watcher__eye">
          <ellipse className="watcher__socket" cx="60" cy="88" rx="26" ry="14" />
          <ellipse className="watcher__sclera" cx="60" cy="88" rx="23" ry="11" />
          <g className="watcher__gaze">
            <circle className="watcher__iris" cx="60" cy="88" r="10" />
            <ellipse className="watcher__pupil" cx="60" cy="88" rx="1.8" ry="9" />
          </g>
          <path className="watcher__lid" d="M34 88 C44 74 76 74 86 88" fill="none" />
        </g>
        {/* too-long stitched smile, faint */}
        <path className="watcher__smile" d="M36 170 C48 182 72 182 84 170" fill="none" />
        <path className="watcher__stitches" d="M42 175 v6 M50 179 v6 M58 181 v6 M66 181 v6 M74 179 v6 M82 175 v6" fill="none" />
        {/* open-mouth slit, only visible when noticed */}
        <ellipse className="watcher__mouth" cx="60" cy="176" rx="14" ry="5" />
      </svg>
    </div>
  );
}
