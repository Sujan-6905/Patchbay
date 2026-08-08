import type { MemberState, RoomErrorCode, RoomMember } from '@patchbay/shared';
import { create } from 'zustand';

export interface PeerInfo extends MemberState {
  peerId: string;
  displayName: string;
}

interface RoomState {
  roomId: string | null;
  selfId: string | null;
  peers: Record<string, PeerInfo>;
  remoteStreams: Record<string, MediaStream>;
  remoteScreenStreams: Record<string, MediaStream>;
  connectionStates: Record<string, RTCPeerConnectionState>;
  micEnabled: boolean;
  camEnabled: boolean;
  sharingScreen: boolean;
  joinError: { code: RoomErrorCode; message: string } | null;

  setJoined: (roomId: string, selfId: string, members: RoomMember[]) => void;
  addPeer: (member: RoomMember) => void;
  removePeer: (peerId: string) => void;
  setRemoteStream: (peerId: string, stream: MediaStream) => void;
  setRemoteScreenStream: (peerId: string, stream: MediaStream) => void;
  setConnectionState: (peerId: string, state: RTCPeerConnectionState) => void;
  setPeerState: (peerId: string, state: MemberState) => void;
  setMicEnabled: (enabled: boolean) => void;
  setCamEnabled: (enabled: boolean) => void;
  setSharingScreen: (sharing: boolean) => void;
  setJoinError: (error: { code: RoomErrorCode; message: string } | null) => void;
  reset: () => void;
}

const DEFAULT_MEMBER_STATE: MemberState = {
  micEnabled: true,
  camEnabled: true,
  sharingScreen: false,
};

const initialState = {
  roomId: null,
  selfId: null,
  peers: {},
  remoteStreams: {},
  remoteScreenStreams: {},
  connectionStates: {},
  micEnabled: true,
  camEnabled: true,
  sharingScreen: false,
  joinError: null,
} satisfies Omit<
  RoomState,
  | 'setJoined'
  | 'addPeer'
  | 'removePeer'
  | 'setRemoteStream'
  | 'setRemoteScreenStream'
  | 'setConnectionState'
  | 'setPeerState'
  | 'setMicEnabled'
  | 'setCamEnabled'
  | 'setSharingScreen'
  | 'setJoinError'
  | 'reset'
>;

export const useRoomStore = create<RoomState>((set) => ({
  ...initialState,

  setJoined: (roomId, selfId, members) =>
    set({
      roomId,
      selfId,
      peers: Object.fromEntries(
        members.map((member) => [member.peerId, { ...member, ...DEFAULT_MEMBER_STATE }]),
      ),
      joinError: null,
    }),

  addPeer: (member) =>
    set((state) =>
      state.peers[member.peerId]
        ? state
        : {
            peers: {
              ...state.peers,
              [member.peerId]: { ...member, ...DEFAULT_MEMBER_STATE },
            },
          },
    ),

  removePeer: (peerId) =>
    set((state) => {
      const { [peerId]: _removedPeer, ...peers } = state.peers;
      const { [peerId]: _removedStream, ...remoteStreams } = state.remoteStreams;
      const { [peerId]: _removedScreenStream, ...remoteScreenStreams } = state.remoteScreenStreams;
      const { [peerId]: _removedState, ...connectionStates } = state.connectionStates;
      return { peers, remoteStreams, remoteScreenStreams, connectionStates };
    }),

  setRemoteStream: (peerId, stream) =>
    set((state) => ({ remoteStreams: { ...state.remoteStreams, [peerId]: stream } })),

  setRemoteScreenStream: (peerId, stream) =>
    set((state) => ({ remoteScreenStreams: { ...state.remoteScreenStreams, [peerId]: stream } })),

  setConnectionState: (peerId, connState) =>
    set((state) => ({ connectionStates: { ...state.connectionStates, [peerId]: connState } })),

  setPeerState: (peerId, memberState) =>
    set((state) => {
      const peer = state.peers[peerId];
      if (!peer) return state;
      // A peer that stopped sharing has no more screen track coming; drop the stale stream
      // rather than waiting on the (never-firing) removal event to tell us.
      if (peer.sharingScreen && !memberState.sharingScreen && state.remoteScreenStreams[peerId]) {
        const { [peerId]: _removedScreenStream, ...remoteScreenStreams } =
          state.remoteScreenStreams;
        return {
          peers: { ...state.peers, [peerId]: { ...peer, ...memberState } },
          remoteScreenStreams,
        };
      }
      return { peers: { ...state.peers, [peerId]: { ...peer, ...memberState } } };
    }),

  setMicEnabled: (enabled) => set({ micEnabled: enabled }),
  setCamEnabled: (enabled) => set({ camEnabled: enabled }),
  setSharingScreen: (sharing) => set({ sharingScreen: sharing }),
  setJoinError: (joinError) => set({ joinError }),

  reset: () => set(initialState),
}));
