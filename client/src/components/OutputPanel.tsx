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
    background: '#11111b',
    borderTop: '1px solid #313244',
    fontFamily: '"JetBrains Mono", "Fira Mono", "Cascadia Code", monospace',
    fontSize: '13px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.3rem 0.75rem',
    background: '#181825',
    borderBottom: '1px solid #313244',
    flexShrink: 0,
  },
  title: {
    color: '#a6adc8',
    fontSize: '0.8rem',
    fontFamily: 'system-ui, sans-serif',
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
    borderRadius: '4px',
    border: '1px solid #45475a',
    background: 'transparent',
    color: '#6c7086',
    fontSize: '0.75rem',
    cursor: 'pointer',
    fontFamily: 'system-ui, sans-serif',
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
    color: '#45475a',
    fontStyle: 'italic',
    fontFamily: 'system-ui, sans-serif',
    fontSize: '0.8rem',
    padding: '0.5rem 0',
  },
};

const STREAM_COLORS: Record<OutputLine['stream'], string> = {
  stdout: '#cdd6f4',
  stderr: '#f38ba8',
  system: '#a6e3a1',
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
              background: '#a6e3a1',
              animation: 'crdt-pulse 1s ease-in-out infinite',
            }}
            title="Running…"
          />
        )}
        <span style={s.title}>Output</span>
        <button style={s.clearBtn} onClick={onClear} title="Clear output">
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
