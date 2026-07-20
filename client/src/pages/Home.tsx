import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

function generateRoomId(): string {
  // 8-character alphanumeric slug — no external dependency needed for Week 1
  return Math.random().toString(36).slice(2, 10);
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '2rem',
    padding: '2rem',
    background: '#1e1e2e',
  },
  heading: {
    fontSize: '2rem',
    fontWeight: 700,
    color: '#cdd6f4',
    margin: 0,
  },
  subtitle: {
    fontSize: '1rem',
    color: '#6c7086',
    margin: 0,
    textAlign: 'center',
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
    background: '#181825',
    border: '1px solid #313244',
    borderRadius: '12px',
    padding: '1.5rem 2rem',
    width: '100%',
    maxWidth: '400px',
  },
  label: {
    fontSize: '0.8rem',
    fontWeight: 600,
    color: '#a6adc8',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  input: {
    padding: '0.6rem 0.9rem',
    borderRadius: '8px',
    border: '1px solid #45475a',
    background: '#1e1e2e',
    color: '#cdd6f4',
    fontSize: '1rem',
    outline: 'none',
    width: '100%',
  },
  primaryBtn: {
    padding: '0.65rem 1.2rem',
    borderRadius: '8px',
    border: 'none',
    background: '#89b4fa',
    color: '#1e1e2e',
    fontWeight: 700,
    fontSize: '0.95rem',
    cursor: 'pointer',
  },
  divider: {
    textAlign: 'center' as const,
    color: '#45475a',
    fontSize: '0.85rem',
  },
};

export function Home() {
  const navigate = useNavigate();
  const [roomInput, setRoomInput] = useState('');

  const createRoom = () => navigate(`/room/${generateRoomId()}`);

  const joinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    const id = roomInput.trim();
    if (id) navigate(`/room/${id}`);
  };

  return (
    <div style={styles.root}>
      <h1 style={styles.heading}>CRDT Collaborative Editor</h1>
      <p style={styles.subtitle}>
        Real-time collaborative code editing powered by the RGA CRDT algorithm.
        <br />
        Week 3 — RGA CRDT with live cursors and real-time presence.
      </p>

      <div style={styles.card}>
        <button style={styles.primaryBtn} onClick={createRoom}>
          Create new room
        </button>

        <div style={styles.divider}>— or join existing —</div>

        <form onSubmit={joinRoom} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <label style={styles.label} htmlFor="room-input">Room ID</label>
          <input
            id="room-input"
            style={styles.input}
            type="text"
            placeholder="e.g. abc123"
            value={roomInput}
            onChange={(e) => setRoomInput(e.target.value)}
            autoComplete="off"
          />
          <button style={styles.primaryBtn} type="submit">
            Join room
          </button>
        </form>
      </div>
    </div>
  );
}
