import { useGame } from './GameProvider';
import { PlayScreen } from './screens/PlayScreen';
import { ResultsScreen } from './screens/ResultsScreen';
import { StartScreen } from './screens/StartScreen';

/** Renders exactly one screen for the current phase, so a phase change is one commit (Req 1.11, 2.9). */
export function ScreenSwitch() {
  const { state } = useGame();
  switch (state.phase) {
    case 'ready':
      return <StartScreen />;
    case 'playing':
      return <PlayScreen />;
    case 'won':
    case 'lost':
      return <ResultsScreen />;
  }
}
