# Privacy notes: AI features

Patchbay's AI features fall into two categories with different privacy properties: on-device
(captions, blur) and server-assisted (meeting summaries).

## Live captions & the call transcript (on-device, free)

Captions run entirely in your browser via the [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition)
(`SpeechRecognition`). Audio is processed by the browser's own speech-recognition service;
in Chrome this is Google's, and it leaves your machine the same way any other Web Speech API
usage does. Patchbay's own server never receives your audio or transcript: finalized captions
are broadcast to other participants only over the peer-to-peer WebRTC DataChannel (see
`docs/SIGNALING.md`), never through the signaling server.

Transcription runs for the whole call while your microphone is live; the captions (CC)
toggle only controls whether the caption overlay is *displayed*, not whether speech is
transcribed. This is what lets "Summarize meeting" cover the entire call even if nobody
turned captions on. The transcript lives only in each participant's browser tab (never on
the server) and is discarded when you leave the room. Muting your microphone pauses your own
transcription entirely.

Captions are only available in browsers that implement `SpeechRecognition`
(Chrome, Edge, Safari); the UI disables the toggle elsewhere.

## Background blur (on-device, free)

Background blur runs a MediaPipe segmentation model locally in your browser (WebAssembly +
optionally WebGL). No video frame is ever sent anywhere for this feature; the blurred
output is produced entirely client-side before being sent to other participants as your
camera track.

## AI meeting summaries (included, free)

Meeting summaries are provided by Patchbay itself, free for every user: there is no
account, no API key to paste, and nothing to configure. The server holds its own Groq key
(`GROQ_API_KEY` in its environment); that key never reaches your browser and is never
included in any response or log line (`server/src/api/ai.ts`).

The transcript sent for summarization is the accumulated **finalized** captions from the
call so far; it leaves your machine only at the moment you click **Summarize meeting**,
travels to Patchbay's server over HTTPS, and is forwarded to Groq for that one request.
Neither the server nor Groq is sent anything automatically; if you never click Summarize,
the transcript never leaves your browser.
