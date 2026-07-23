// Shared message types for client ↔ server communication.
// Week 1: raw op payloads. Week 2: CRDT insert/delete messages added.
// Week 3: presence (live cursors), welcome, user-joined/left added.
// Week 5: auth identity fields, language switching, room-meta broadcast.

export type { CRDTChar } from './crdt.js';

export type MessageType =
  | 'op'
  | 'crdt-insert'
  | 'crdt-delete'
  | 'presence'
  | 'welcome'
  | 'user-joined'
  | 'user-left'
  | 'catchup'
  | 'language'
  | 'room-meta';

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
  username: string;   // Week 5: GitHub username
  avatarUrl: string;  // Week 5: GitHub avatar URL
}

export interface UserLeftMessage extends BaseMessage {
  type: 'user-left';
}

/**
 * Sent by the server to the connecting client only (not broadcast to peers).
 * Week 5: carries real GitHub identity instead of anonymous UUID.
 */
export interface WelcomeMessage extends BaseMessage {
  type: 'welcome';
  color: string;
  username: string;   // GitHub username
  avatarUrl: string;  // GitHub avatar URL
}

export interface CRDTInsertMessage extends BaseMessage {
  type: 'crdt-insert';
  char: import('./crdt.js').CRDTChar;
}

export interface CRDTDeleteMessage extends BaseMessage {
  type: 'crdt-delete';
  charId: string;
}

export interface LanguageChangeMessage {
  type: 'language';
  lang: string;       // One of the 8 supported language IDs
  changedBy?: string; // userId of the sender (server adds this on broadcast)
}

export interface RoomMetaMessage {
  type: 'room-meta';
  name: string;       // Updated room name
}

export interface CatchupMessage {
  type: 'catchup';
  roomId: string;
  userId: string;
  currentLanguage: string;  // Week 5: active language for this room
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
  | CatchupMessage
  | LanguageChangeMessage
  | RoomMetaMessage;
