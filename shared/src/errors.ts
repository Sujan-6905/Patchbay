export type RoomErrorCode =
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'INVALID_PAYLOAD'
  | 'ALREADY_IN_ROOM'
  | 'NOT_IN_ROOM'
  | 'RATE_LIMITED';

export interface RoomError {
  code: RoomErrorCode;
  message: string;
}
