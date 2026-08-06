/**
 * useVoiceChat — peer-to-peer mic audio between everyone in a room, so users can
 * talk in real time while coding. Reuses the existing Supabase Realtime broadcast
 * channel (the same transport CRDT ops/presence ride) purely as a WebRTC signaling
 * bus: 'voice-join'/'voice-leave' announce mic state, 'voice-offer'/'voice-answer'/
 * 'voice-ice' carry per-peer SDP/ICE messages addressed via a `to` field.
 *
 * Mesh topology (every mic-on peer connects directly to every other mic-on peer).
 * Only a public STUN server is configured (no TURN) — connections may fail across
 * restrictive/symmetric NATs, which is an accepted limitation for this project.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

interface UseVoiceChatOptions {
  userId: string;
  send: (msg: object) => void;
}

export interface UseVoiceChatReturn {
  /** Whether our own mic is currently live. */
  micOn: boolean;
  /** Toggle the local mic on/off, establishing or tearing down peer connections. */
  toggleMic: () => void;
  /** userId -> remote MediaStream, for rendering <audio> elements. */
  remoteStreams: Record<string, MediaStream>;
  /** Number of other participants currently broadcasting mic audio. */
  voicePeerCount: number;
  /** Feed every incoming realtime message here (ignores anything that isn't voice-*). */
  handleSignal: (msg: Record<string, unknown>) => void;
  /** Call when a peer leaves the room (presence 'user-left') to close their connection. */
  handlePeerLeft: (peerId: string) => void;
}

export function useVoiceChat({ userId, send }: UseVoiceChatOptions): UseVoiceChatReturn {
  const [micOn, setMicOn] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [voicePeerCount, setVoicePeerCount] = useState(0);

  const sendRef = useRef(send);
  sendRef.current = send;

  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const voicePeersRef = useRef<Set<string>>(new Set());

  const closePeer = useCallback((peerId: string) => {
    peersRef.current.get(peerId)?.close();
    peersRef.current.delete(peerId);
    setRemoteStreams((prev) => {
      if (!(peerId in prev)) return prev;
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
  }, []);

  const getOrCreatePeer = useCallback((peerId: string): RTCPeerConnection => {
    const existing = peersRef.current.get(peerId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const localStream = localStreamRef.current;
    if (localStream) {
      for (const track of localStream.getTracks()) pc.addTrack(track, localStream);
    }
    pc.ontrack = (e) => {
      const [stream] = e.streams;
      if (stream) setRemoteStreams((prev) => ({ ...prev, [peerId]: stream }));
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        sendRef.current({ type: 'voice-ice', from: userId, to: peerId, candidate: e.candidate.toJSON() });
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'closed' || pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        closePeer(peerId);
      }
    };
    peersRef.current.set(peerId, pc);
    return pc;
  }, [userId, closePeer]);

  const initiateOffer = useCallback(async (peerId: string) => {
    const pc = getOrCreatePeer(peerId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendRef.current({ type: 'voice-offer', from: userId, to: peerId, sdp: offer });
  }, [userId, getOrCreatePeer]);

  const toggleMic = useCallback(() => {
    if (micOn) {
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      for (const peerId of Array.from(peersRef.current.keys())) closePeer(peerId);
      setMicOn(false);
      sendRef.current({ type: 'voice-leave', from: userId });
      return;
    }

    void navigator.mediaDevices.getUserMedia({ audio: true })
      .then((stream) => {
        localStreamRef.current = stream;
        setMicOn(true);
        sendRef.current({ type: 'voice-join', from: userId });
        // Avoid offer/answer glare: only the lexicographically-smaller id initiates.
        for (const peerId of voicePeersRef.current) {
          if (peerId !== userId && userId < peerId) void initiateOffer(peerId);
        }
      })
      .catch((err: unknown) => {
        console.error('[voice] microphone unavailable:', (err as Error).message);
      });
  }, [micOn, userId, closePeer, initiateOffer]);

  const handleSignal = useCallback((msg: Record<string, unknown>) => {
    const type = msg['type'];
    if (typeof type !== 'string' || !type.startsWith('voice-')) return;

    const from = msg['from'] as string | undefined;
    if (!from || from === userId) return; // ignore our own broadcast echo (channel uses self:true)

    if (type === 'voice-join') {
      voicePeersRef.current.add(from);
      setVoicePeerCount(voicePeersRef.current.size);
      if (localStreamRef.current && userId < from) void initiateOffer(from);
      return;
    }
    if (type === 'voice-leave') {
      voicePeersRef.current.delete(from);
      setVoicePeerCount(voicePeersRef.current.size);
      closePeer(from);
      return;
    }

    const to = msg['to'] as string | undefined;
    if (to !== userId) return; // voice-offer/answer/ice are point-to-point

    if (type === 'voice-offer') {
      const pc = getOrCreatePeer(from);
      void pc.setRemoteDescription(new RTCSessionDescription(msg['sdp'] as RTCSessionDescriptionInit))
        .then(() => pc.createAnswer())
        .then((answer) => pc.setLocalDescription(answer).then(() => answer))
        .then((answer) => sendRef.current({ type: 'voice-answer', from: userId, to: from, sdp: answer }))
        .catch((err: unknown) => console.error('[voice] failed to answer offer:', (err as Error).message));
      return;
    }
    if (type === 'voice-answer') {
      const pc = peersRef.current.get(from);
      if (pc) void pc.setRemoteDescription(new RTCSessionDescription(msg['sdp'] as RTCSessionDescriptionInit));
      return;
    }
    if (type === 'voice-ice') {
      const pc = peersRef.current.get(from);
      if (pc) void pc.addIceCandidate(new RTCIceCandidate(msg['candidate'] as RTCIceCandidateInit));
    }
  }, [userId, getOrCreatePeer, initiateOffer, closePeer]);

  const handlePeerLeft = useCallback((peerId: string) => {
    voicePeersRef.current.delete(peerId);
    setVoicePeerCount(voicePeersRef.current.size);
    closePeer(peerId);
  }, [closePeer]);

  // Tear everything down on unmount (e.g. navigating away from the room).
  useEffect(() => {
    return () => {
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      for (const pc of peersRef.current.values()) pc.close();
      peersRef.current.clear();
    };
  }, []);

  return { micOn, toggleMic, remoteStreams, voicePeerCount, handleSignal, handlePeerLeft };
}
