import { useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './useSession';

export type ChannelStatus = 'connecting' | 'open' | 'closed' | 'error';

const COLORS = [
  '#E53E3E', '#3182CE', '#38A169', '#D69E2E',
  '#805AD5', '#DD6B20', '#00B5D8', '#ED64A6',
] as const;

/** Deterministic per-user color so peers agree on a cursor color without a central assigner. */
function colorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return COLORS[hash % COLORS.length];
}

export interface SelfIdentity {
  userId: string;
  username: string;
  avatarUrl: string;
}

interface PresenceMeta extends SelfIdentity {
  color: string;
}

interface UseRealtimeChannelReturn {
  /** Send a JSON-serialisable app message to every peer subscribed to the room (self included). */
  send: (msg: object) => void;
  status: ChannelStatus;
}

/**
 * Replaces the old `useWebSocket` transport: CRDT ops, presence cursors, and
 * exec-* messages all ride a Supabase Realtime `broadcast` channel instead of
 * a persistent WebSocket server (which can't run on Vercel serverless).
 *
 * Peer join/leave is derived from Supabase's built-in Presence tracking and
 * translated into the same `welcome` / `user-joined` / `user-left` message
 * shapes the old WS server sent, so `useCRDT` / `usePresence` need no changes.
 *
 * Broadcast is configured with `self: true` — CRDT ops are idempotent
 * (`remoteInsert`/`remoteDelete` no-op on already-applied ids), so looping a
 * message back to its own sender is harmless and keeps the exec-output flow
 * simple (the room member who clicked Run sees output the same way peers do).
 */
export function useRealtimeChannel(
  roomId: string | null,
  self: SelfIdentity | null,
  onMessage: (msg: Record<string, unknown>) => void,
): UseRealtimeChannelReturn {
  const [status, setStatus] = useState<ChannelStatus>('closed');
  const channelRef = useRef<RealtimeChannel | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!roomId || !self) return;

    setStatus('connecting');
    const meta: PresenceMeta = { ...self, color: colorForUser(self.userId) };

    const channel = supabase.channel(`room:${roomId}`, {
      config: {
        broadcast: { self: true, ack: false },
        presence: { key: self.userId },
      },
    });

    channel.on('broadcast', { event: 'msg' }, ({ payload }) => {
      onMessageRef.current(payload as Record<string, unknown>);
    });

    channel.on('presence', { event: 'join' }, ({ newPresences }) => {
      for (const p of newPresences as unknown as PresenceMeta[]) {
        if (p.userId === self.userId) continue;
        onMessageRef.current({
          type: 'user-joined',
          userId: p.userId,
          roomId,
          color: p.color,
          username: p.username,
          avatarUrl: p.avatarUrl,
        });
      }
    });

    channel.on('presence', { event: 'leave' }, ({ leftPresences }) => {
      for (const p of leftPresences as unknown as PresenceMeta[]) {
        onMessageRef.current({ type: 'user-left', userId: p.userId });
      }
    });

    channel.subscribe((subscribeStatus) => {
      if (subscribeStatus === 'SUBSCRIBED') {
        void channel.track(meta).then(() => {
          setStatus('open');
          onMessageRef.current({
            type: 'welcome',
            userId: self.userId,
            roomId,
            color: meta.color,
            username: self.username,
            avatarUrl: self.avatarUrl,
          });
          // Announce ourselves to peers already in the room (their own presence
          // sync already knows about us via 'join', but this covers usePresence's
          // simpler user-joined handling for symmetry with the old WS protocol).
          const existing = Object.values(channel.presenceState<PresenceMeta>())
            .flat()
            .filter((p) => p.userId !== self.userId);
          for (const p of existing) {
            onMessageRef.current({
              type: 'user-joined',
              userId: p.userId,
              roomId,
              color: p.color,
              username: p.username,
              avatarUrl: p.avatarUrl,
            });
          }
        });
      } else if (subscribeStatus === 'CHANNEL_ERROR' || subscribeStatus === 'TIMED_OUT') {
        setStatus('error');
      } else if (subscribeStatus === 'CLOSED') {
        setStatus('closed');
      }
    });

    channelRef.current = channel;

    return () => {
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [roomId, self?.userId, self?.username, self?.avatarUrl]);

  const send = (msg: object) => {
    void channelRef.current?.send({ type: 'broadcast', event: 'msg', payload: msg });
  };

  return { send, status };
}
