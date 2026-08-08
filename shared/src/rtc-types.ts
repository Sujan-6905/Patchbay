// Structural mirrors of lib.dom.d.ts's RTCSessionDescriptionInit / RTCIceCandidateInit.
// Defined locally (rather than imported) so the server package, which has no "DOM" lib,
// can still type-check payloads that flow through it without ever touching a real
// RTCPeerConnection. Structurally identical, so client code can pass real DOM values here.

export type SdpType = 'offer' | 'answer' | 'pranswer' | 'rollback';

export interface SessionDescriptionInit {
  type: SdpType;
  sdp?: string;
}

export interface IceCandidateInit {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}
