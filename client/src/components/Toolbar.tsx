import { useState } from 'react';
import { SUPPORTED_LANGUAGES } from '../extensions/languageSwitcher';

interface ConnectedUser {
  userId: string;
  username: string;
  avatarUrl: string;
  color: string;
}

interface ToolbarProps {
  roomName: string;
  roomSlug: string;
  language: string;
  onLanguageChange: (lang: string) => void;
  onRoomNameChange?: (name: string) => void;
  connectedUsers: ConnectedUser[];
}

const MAX_VISIBLE_AVATARS = 5;

const s: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.5rem 1rem',
    background: '#181825',
    borderBottom: '1px solid #313244',
    flexWrap: 'wrap',
  },
  roomName: {
    fontWeight: 600,
    color: '#cdd6f4',
    fontSize: '0.95rem',
    flex: '0 0 auto',
    maxWidth: '200px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  select: {
    padding: '0.3rem 0.5rem',
    borderRadius: '6px',
    border: '1px solid #45475a',
    background: '#1e1e2e',
    color: '#cdd6f4',
    fontSize: '0.85rem',
    cursor: 'pointer',
  },
  btn: {
    padding: '0.3rem 0.75rem',
    borderRadius: '6px',
    border: '1px solid #45475a',
    background: '#1e1e2e',
    color: '#a6adc8',
    fontSize: '0.85rem',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
  btnDisabled: {
    opacity: 0.4,
    cursor: 'not-allowed',
  },
  avatarStack: {
    display: 'flex',
    alignItems: 'center',
    marginLeft: 'auto',
  },
  avatar: {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    border: '2px solid #181825',
    marginLeft: '-6px',
    objectFit: 'cover' as const,
  },
  avatarFallback: {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    border: '2px solid #181825',
    marginLeft: '-6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.6rem',
    fontWeight: 700,
    color: '#1e1e2e',
  },
  overflow: {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    border: '2px solid #181825',
    marginLeft: '-6px',
    background: '#45475a',
    color: '#cdd6f4',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.6rem',
    fontWeight: 700,
  },
  countBadge: {
    fontSize: '0.8rem',
    color: '#6c7086',
    marginLeft: '0.5rem',
    whiteSpace: 'nowrap' as const,
  },
  fallbackInput: {
    padding: '0.3rem 0.5rem',
    borderRadius: '6px',
    border: '1px solid #45475a',
    background: '#1e1e2e',
    color: '#cdd6f4',
    fontSize: '0.8rem',
    width: '260px',
  },
};

export function Toolbar({
  roomName,
  roomSlug,
  language,
  onLanguageChange,
  onRoomNameChange,
  connectedUsers,
}: ToolbarProps) {
  const [copyFallback, setCopyFallback] = useState(false);

  const roomUrl = `${window.location.origin}/room/${roomSlug}`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(roomUrl);
      // Brief visual feedback
      setCopyFallback(false);
    } catch {
      setCopyFallback(true);
    }
  };

  const visible = connectedUsers.slice(0, MAX_VISIBLE_AVATARS);
  const overflow = connectedUsers.length - MAX_VISIBLE_AVATARS;

  return (
    <div style={s.bar}>
      {/* Room name */}
      {onRoomNameChange ? (
        <input
          style={s.select}
          defaultValue={roomName}
          onBlur={(e) => { if (e.target.value.trim()) onRoomNameChange(e.target.value.trim()); }}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          title="Room name (click to rename)"
        />
      ) : (
        <span style={s.roomName} title={roomName}>{roomName}</span>
      )}

      {/* Language dropdown */}
      <select
        style={s.select}
        value={language}
        onChange={(e) => onLanguageChange(e.target.value)}
        title="Editor language"
      >
        {Object.entries(SUPPORTED_LANGUAGES).map(([id, { label }]) => (
          <option key={id} value={id}>{label}</option>
        ))}
      </select>

      {/* Copy link */}
      {copyFallback ? (
        <input style={s.fallbackInput} readOnly value={roomUrl} onClick={(e) => e.currentTarget.select()} />
      ) : (
        <button style={s.btn} onClick={handleCopyLink} title="Copy shareable link">
          Copy link
        </button>
      )}

      {/* Stubbed Run button */}
      <button style={{ ...s.btn, ...s.btnDisabled }} disabled title="Code execution — coming soon">
        ▶ Run
      </button>

      {/* Avatar stack + user count */}
      <div style={s.avatarStack}>
        {visible.map((u) =>
          u.avatarUrl ? (
            <img
              key={u.userId}
              src={u.avatarUrl}
              alt={u.username}
              title={u.username}
              style={s.avatar}
            />
          ) : (
            <div
              key={u.userId}
              style={{ ...s.avatarFallback, background: u.color }}
              title={u.username}
            >
              {u.username.slice(0, 2).toUpperCase() || '?'}
            </div>
          ),
        )}
        {overflow > 0 && (
          <div style={s.overflow} title={`${overflow} more user(s)`}>+{overflow}</div>
        )}
      </div>
      <span style={s.countBadge}>{connectedUsers.length} connected</span>
    </div>
  );
}
