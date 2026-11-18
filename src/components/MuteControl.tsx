import { useSound } from '../app/AudioProvider';

export const ENABLE_SOUND_LABEL = 'Enable sound';
export const MUTE_SOUND_LABEL = 'Mute sound';

export function MuteControl() {
  const { soundOn, toggleSound } = useSound();
  return (
    <button type="button" className="mute-control" aria-pressed={soundOn} onClick={toggleSound}>
      {soundOn ? MUTE_SOUND_LABEL : ENABLE_SOUND_LABEL}
    </button>
  );
}

export default MuteControl;
