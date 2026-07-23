import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../hooks/useSession';
import { createRoom, listRooms, type RoomInfo } from '../hooks/useRooms';

const s: Record<string, React.CSSProperties> = {
  root: { minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2rem', padding: '2rem', background: '#1e1e2e' },
  heading: { fontSize: '2rem', fontWeight: 700, color: '#cdd6f4', margin: 0 },
  card: { display: 'flex', flexDirection: 'column', gap: '1rem', background: '#181825', border: '1px solid #313244', borderRadius: '12px', padding: '1.5rem 2rem', width: '100%', maxWidth: '440px' },
  primaryBtn: { padding: '0.65rem 1.2rem', borderRadius: '8px', border: 'none', background: '#89b4fa', color: '#1e1e2e', fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer' },
  secondaryBtn: { padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid #45475a', background: 'transparent', color: '#a6adc8', fontSize: '0.85rem', cursor: 'pointer' },
  label: { fontSize: '0.8rem', fontWeight: 600, color: '#a6adc8', textTransform: 'uppercase', letterSpacing: '0.06em' },
  avatar: { width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover' as const },
  header: { display: 'flex', alignItems: 'center', gap: '0.75rem', justifyContent: 'flex-end', padding: '0.75rem 1.5rem', background: '#181825', borderBottom: '1px solid #313244' },
  roomRow: { display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0', borderBottom: '1px solid #313244' },
  langBadge: { fontSize: '0.72rem', padding: '2px 7px', borderRadius: '999px', background: '#313244', color: '#a6adc8' },
  roomName: { flex: 1, color: '#cdd6f4', fontSize: '0.9rem' },
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
    return <div style={{ ...s.root }}><span style={{ color: '#6c7086' }}>Loading…</span></div>;
  }

  if (!session) {
    return (
      <div style={s.root}>
        <h1 style={s.heading}>CRDT Collaborative Editor</h1>
        <p style={{ color: '#6c7086', textAlign: 'center', margin: 0 }}>
          Real-time collaborative code editing powered by the RGA CRDT algorithm.
        </p>
        <div style={s.card}>
          <button style={s.primaryBtn} onClick={() => void signIn()}>
            Sign in with GitHub
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: '#1e1e2e', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={s.header}>
        {user?.user_metadata?.['avatar_url'] && (
          <img src={user.user_metadata['avatar_url'] as string} alt="avatar" style={s.avatar} />
        )}
        <span style={{ color: '#cdd6f4', fontSize: '0.9rem' }}>{user?.user_metadata?.['user_name'] as string ?? user?.email}</span>
        <button style={s.secondaryBtn} onClick={() => void signOut()}>Sign out</button>
      </div>

      {/* Main */}
      <div style={{ ...s.root, justifyContent: 'flex-start', paddingTop: '3rem' }}>
        <h1 style={s.heading}>CRDT Collaborative Editor</h1>

        <div style={s.card}>
          <button style={s.primaryBtn} onClick={() => void handleCreateRoom()} disabled={creating}>
            {creating ? 'Creating…' : '+ New room'}
          </button>
        </div>

        {recentRooms.length > 0 && (
          <div style={{ ...s.card, gap: '0' }}>
            <span style={{ ...s.label, marginBottom: '0.75rem' }}>Recent rooms</span>
            {recentRooms.map((room) => (
              <div key={room.id} style={s.roomRow}>
                <span style={s.roomName}>{room.name}</span>
                <span style={s.langBadge}>{room.language}</span>
                <button style={s.secondaryBtn} onClick={() => navigate(`/room/${room.id}`)}>Open</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

