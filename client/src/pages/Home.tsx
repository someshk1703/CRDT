import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../hooks/useSession';
import { createRoom, listRooms, type RoomInfo } from '../hooks/useRooms';

const s: Record<string, React.CSSProperties> = {
  root: { minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2rem', padding: '2rem' },
  heading: { fontSize: '2rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0, fontFamily: 'var(--font-sans)' },
  headingRow: { display: 'flex', alignItems: 'center', gap: '0.9rem' },
  card: { display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%', maxWidth: '440px', padding: '1.5rem 2rem' },
  label: { fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' },
  avatar: { width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover' as const },
  header: { display: 'flex', alignItems: 'center', gap: '0.75rem', justifyContent: 'flex-end', padding: '0.75rem 1.5rem', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)' },
  roomRow: { display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0', borderBottom: '1px solid var(--border-color)' },
  langBadge: { fontSize: '0.72rem', padding: '2px 7px', borderRadius: '999px', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' },
  roomName: { flex: 1, color: 'var(--text-primary)', fontSize: '0.9rem' },
};

export function Home() {
  const navigate = useNavigate();
  const { session, user, loading, signIn, signOut } = useSession();
  const [recentRooms, setRecentRooms] = useState<RoomInfo[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!session) return;
    listRooms().then(setRecentRooms).catch(console.error);
  }, [session]);

  const handleCreateRoom = async () => {
    setCreating(true);
    try {
      const room = await createRoom();
      navigate(`/room/${room.id}`);
    } catch (err) {
      console.error('Failed to create room:', err);
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return <div className="crdt-page" style={{ ...s.root }}><span style={{ color: 'var(--text-secondary)' }}>Loading…</span></div>;
  }

  if (!session) {
    const inIframe = window.self !== window.top;
    return (
      <div className="crdt-page" style={s.root}>
        <div style={s.headingRow}>
          <img src="/ex-crdt-logo.jpg" alt="EX-CRDT logo" className="crdt-logo" />
          <h1 style={s.heading}>CRDT Collaborative Editor</h1>
        </div>
        <p style={{ color: 'var(--text-secondary)', textAlign: 'center', margin: 0 }}>
          Real-time collaborative code editing powered by the RGA CRDT algorithm.
        </p>
        <div className="crdt-box" style={s.card}>
          <button className="crdt-btn crdt-btn-run" onClick={() => void signIn()}>
            Sign in with GitHub
          </button>
          {inIframe && (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', textAlign: 'center', margin: '0.5rem 0 0' }}>
              A new tab will open for sign-in — come back here when done.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="crdt-page" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={s.header}>
        {user?.user_metadata?.['avatar_url'] && (
          <img src={user.user_metadata['avatar_url'] as string} alt="avatar" style={s.avatar} />
        )}
        <span style={{ color: 'var(--text-primary)', fontSize: '0.9rem' }}>{user?.user_metadata?.['user_name'] as string ?? user?.email}</span>
        <button className="crdt-btn crdt-btn-secondary" onClick={() => void signOut()}>Sign out</button>
      </div>

      {/* Main */}
      <div style={{ ...s.root, justifyContent: 'flex-start', paddingTop: '3rem' }}>
        <div style={s.headingRow}>
          <img src="/ex-crdt-logo.jpg" alt="EX-CRDT logo" className="crdt-logo" />
          <h1 style={s.heading}>CRDT Collaborative Editor</h1>
        </div>

        <div className="crdt-box" style={s.card}>
          <button className="crdt-btn crdt-btn-run" onClick={() => void handleCreateRoom()} disabled={creating}>
            {creating ? 'Creating…' : '+ New room'}
          </button>
        </div>

        {recentRooms.length > 0 && (
          <div className="crdt-box" style={{ ...s.card, gap: '0' }}>
            <span style={{ ...s.label, marginBottom: '0.75rem' }}>Recent rooms</span>
            {recentRooms.map((room) => (
              <div key={room.id} style={s.roomRow}>
                <span style={s.roomName}>{room.name}</span>
                <span style={s.langBadge}>{room.language}</span>
                <button className="crdt-btn crdt-btn-secondary" onClick={() => navigate(`/room/${room.id}`)}>Open</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

