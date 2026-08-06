import { useState } from 'react';
import { SUPPORTED_LANGUAGES } from '../extensions/languageSwitcher';
import { THEMES } from '../extensions/themeSwitcher';

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
  theme: string;
  onThemeChange: (themeId: string) => void;
  onRun?: () => void;
  isRunning?: boolean;
}

const MAX_VISIBLE_AVATARS = 5;

const s: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.5rem 1rem',
    background: 'var(--bg-tertiary)',
    borderBottom: '1px solid var(--border-color)',
    flexWrap: 'wrap',
  },
  roomName: {
    fontWeight: 600,
    color: 'var(--text-primary)',
    fontSize: '0.95rem',
    flex: '0 0 auto',
    maxWidth: '200px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
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
    border: '2px solid var(--bg-tertiary)',
    marginLeft: '-6px',
    objectFit: 'cover' as const,
  },
  avatarFallback: {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    border: '2px solid var(--bg-tertiary)',
    marginLeft: '-6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.6rem',
    fontWeight: 700,
    color: 'var(--bg-primary)',
  },
  overflow: {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    border: '2px solid var(--bg-tertiary)',
    marginLeft: '-6px',
    background: 'var(--border-color)',
    color: 'var(--text-primary)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.6rem',
    fontWeight: 700,
  },
  countBadge: {
    fontSize: '0.8rem',
    color: 'var(--text-secondary)',
    marginLeft: '0.5rem',
    whiteSpace: 'nowrap' as const,
  },
};


export function Toolbar({
  roomName,
  roomSlug,
  language,
  onLanguageChange,
  onRoomNameChange,
  connectedUsers,
  theme,
  onThemeChange,
  onRun,
  isRunning = false,
}: ToolbarProps) {
  // Group themes by their group label
  const themeGroups = Object.entries(THEMES).reduce<Record<string, Array<[string, (typeof THEMES)[string]]>>>(
    (acc, entry) => {
      const group = entry[1].group;
      if (!acc[group]) acc[group] = [];
      acc[group].push(entry);
      return acc;
    },
    {},
  );
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
          className="crdt-select"
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
        className="crdt-select"
        value={language}
        onChange={(e) => onLanguageChange(e.target.value)}
        title="Editor language"
      >
        {Object.entries(SUPPORTED_LANGUAGES).map(([id, { label }]) => (
          <option key={id} value={id}>{label}</option>
        ))}
      </select>

      {/* Theme dropdown */}
      <select
        className="crdt-select"
        value={theme}
        onChange={(e) => onThemeChange(e.target.value)}
        title="Editor theme"
      >
        {Object.entries(themeGroups).map(([group, entries]) => (
          <optgroup key={group} label={group}>
            {entries.map(([id, { label }]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </optgroup>
        ))}
      </select>

      {/* Copy link */}
      {copyFallback ? (
        <input className="crdt-input" readOnly value={roomUrl} style={{ width: '260px' }} onClick={(e) => e.currentTarget.select()} />
      ) : (
        <button className="crdt-btn crdt-btn-secondary" onClick={handleCopyLink} title="Copy shareable link">
          Copy link
        </button>
      )}

      {/* Run button */}
      <button
        className="crdt-btn crdt-btn-run"
        disabled={!onRun || isRunning}
        onClick={onRun}
        title={isRunning ? 'Running…' : 'Run code (Ctrl+Enter)'}
      >
        {isRunning ? '⏳ Running…' : '▶ Run'}
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
