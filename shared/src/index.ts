// Shared message types for client ↔ server communication.
// Week 1: raw op payloads. Week 2 will replace OpPayload with CRDTChar.

export type MessageType =
  | 'op'
  | 'presence'
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

export type AppMessage =
  | OpMessage
  | PresenceMessage
  | UserJoinedMessage
  | UserLeftMessage;
