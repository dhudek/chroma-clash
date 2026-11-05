import { useState } from 'react';

import { clearSeat, loadSeat } from './game/seat';
import { Admin } from './pages/Admin';
import { ArenaPlay } from './pages/ArenaPlay';
import { Lobby, type PlayIntent } from './pages/Lobby';
import { Play } from './pages/Play';

type View =
  | { id: 'lobby' }
  | { id: 'play'; name: string; intent: PlayIntent }
  | { id: 'admin' };

function openingView(): View {
  const seat = loadSeat();
  if (seat === null) return { id: 'lobby' };
  return { id: 'play', name: seat.name, intent: { kind: 'resume', game: seat.game } };
}

export function App() {
  const [view, setView] = useState<View>(openingView);

  if (view.id === 'admin') {
    return <Admin onBack={() => setView({ id: 'lobby' })} />;
  }
  if (view.id === 'play') {
    const exit = () => {
      clearSeat();
      setView({ id: 'lobby' });
    };
    if (view.intent.game === 'arena') {
      return <ArenaPlay name={view.name} intent={view.intent} onExit={exit} />;
    }
    return <Play name={view.name} intent={view.intent} onExit={exit} />;
  }
  return (
    <Lobby
      onAdmin={() => setView({ id: 'admin' })}
      onPlay={(name, intent) => setView({ id: 'play', name, intent })}
    />
  );
}
