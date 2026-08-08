import { useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Home } from './pages/Home';
import { PreCall } from './pages/PreCall';
import { Room } from './pages/Room';
import { startBackendWake } from './store/backendStatusStore';

export default function App() {
  // Starts as soon as the app loads, regardless of which route. A direct link to /room/:id
  // should get the same head start on waking the server as landing on the home page.
  useEffect(() => {
    startBackendWake();
  }, []);

  return (
    <div className="min-h-screen bg-neutral-950">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/start" element={<PreCall mode="create" />} />
        <Route path="/join" element={<PreCall mode="join" />} />
        <Route path="/room/:roomId" element={<Room />} />
      </Routes>
    </div>
  );
}
