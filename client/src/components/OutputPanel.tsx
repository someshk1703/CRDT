import { useEffect, useRef } from 'react';

export interface OutputLine {
  id: number;
  text: string;
  stream: 'stdout' | 'stderr' | 'system';
}

interface OutputPanelProps {
  lines: OutputLine[];
  isRunning: boolean;
  onClear: () => void;
}

const s: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '200px',
    background: 'var(--bg-primary)',
    borderTop: '1px solid var(--border-color)',
    fontFamily: 'var(--font-mono)',
    fontSize: '13px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.3rem 0.75rem',
    background: 'var(--bg-tertiary)',
    borderBottom: '1px solid var(--border-color)',
    flexShrink: 0,
  },
  title: {
    color: 'var(--text-secondary)',
    fontSize: '0.8rem',
    fontFamily: 'var(--font-sans)',
    fontWeight: 600,
    flex: 1,
  },
  dot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
  },
  clearBtn: {
    padding: '0.15rem 0.5rem',
    fontSize: '0.75rem',
    fontFamily: 'var(--font-sans)',
  },
  body: {
    flex: 1,
    overflow: 'auto',
    padding: '0.5rem 0.75rem',
  },
  line: {
    margin: 0,
    padding: 0,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    lineHeight: '1.5',
  },
  empty: {
    color: 'var(--text-muted)',
    fontStyle: 'italic',
    fontFamily: 'var(--font-sans)',
    fontSize: '0.8rem',
    padding: '0.5rem 0',
  },
};

const STREAM_COLORS: Record<OutputLine['stream'], string> = {
  stdout: 'var(--text-primary)',
  stderr: 'var(--accent-red)',
  system: 'var(--accent-green)',
};


export function OutputPanel({ lines, isRunning, onClear }: OutputPanelProps) {
  const bodyRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new lines arrive
  useEffect(() => {
    const el = bodyRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [lines]);

  return (
    <div style={s.container}>
      <div style={s.header}>
        {isRunning && (
          <span
            style={{
              ...s.dot,
              background: 'var(--accent-green)',
              animation: 'crdt-pulse 1s ease-in-out infinite',
            }}
            title="Running…"
          />
        )}
        <span style={s.title}>Output</span>
        <button style={s.clearBtn} className="crdt-btn crdt-btn-secondary" onClick={onClear} title="Clear output">
          Clear
        </button>
      </div>
      <div style={s.body} ref={bodyRef}>
        {lines.length === 0 ? (
          <p style={s.empty}>No output yet — click Run ▶ to execute the editor code.</p>
        ) : (
          lines.map((line) => (
            <pre
              key={line.id}
              style={{ ...s.line, color: STREAM_COLORS[line.stream] }}
            >
              {line.text}
            </pre>
          ))
        )}
      </div>
      {/* Keyframe animation injected once */}
      <style>{`
        @keyframes crdt-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
