// Shared message types for client ↔ server communication.
// Week 1: raw op payloads. Week 2: CRDT insert/delete messages added.
// Week 3: presence (live cursors), welcome, user-joined/left added.

export type { CRDTChar } from './crdt.js';

export type MessageType =
  | 'op'
  | 'crdt-insert'
  | 'crdt-delete'
  | 'presence'
  | 'welcome'
  | 'user-joined'
  | 'user-left'
  | 'catchup';

interface BaseMessage {
  type: MessageType;
  userId: string;
  roomId: string;
}

/** Week 1: raw text change. Week 2: replaced by CRDT insert/delete. */
export interface OpMessage extends BaseMessage {
  type: 'op';
  payload: {
    from: number;
    to: number;
    insert: string;
  };
}

export interface PresenceMessage extends BaseMessage {
  type: 'presence';
  cursor: { from: number; to: number };
  name: string;
  color: string;
}

export interface UserJoinedMessage extends BaseMessage {
  type: 'user-joined';
  color: string;
}

export interface UserLeftMessage extends BaseMessage {
  type: 'user-left';
}

/**
 * Sent by the server to the connecting client only (not broadcast to peers).
 * Communicates the server-assigned colour so the client can include it in
 * outgoing presence messages.
 */
export interface WelcomeMessage extends BaseMessage {
  type: 'welcome';
  color: string;
}

export interface CRDTInsertMessage extends BaseMessage {
  type: 'crdt-insert';
  char: import('./crdt.js').CRDTChar;
}

export interface CRDTDeleteMessage extends BaseMessage {
  type: 'crdt-delete';
  charId: string;
}

export interface CatchupMessage {
  type: 'catchup';
  roomId: string;
  userId: string;
  snapshot: {
    chars: import('./crdt.js').CRDTChar[];
    lastClock: number;
  } | null;
  ops: Array<{
    op_type: 'insert' | 'delete';
    payload: import('./crdt.js').CRDTChar | { charId: string };
    clock: number;
  }>;
}

export type AppMessage =
  | OpMessage
  | CRDTInsertMessage
  | CRDTDeleteMessage
  | PresenceMessage
  | WelcomeMessage
  | UserJoinedMessage
  | UserLeftMessage
  | CatchupMessage;
