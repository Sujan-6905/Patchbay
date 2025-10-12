const localVideo = document.getElementById('localvideo');
const remoteVideo = document.getElementById('remotevideo');
const roomdetailsElement = document.getElementById('roomDetails');
const messageElement = document.getElementById('message');

let localStream, remoteStream;
let peerConnection = null;
let receivedOffer = null;
let connectedUsers = null;
let roomId = null;
let myId = null;
let RemotePeerOffer = null;
let didIoffer = null;
let callLive = false;
let videoHeight, videoWidth, frameRate, facingMode = 'environment', videoBitrate, audioBitrate, resolution; // facing mode can be changed if we want to access the frontcamera of media devices
let recordingVideoBitrate, recordingAudioBitrate;
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;
let stream = null;
let sharingAudio = false;
let sharingVideo = false;

const socket = io();

const peerConfiguration = {
    iceServers: [
        {
            urls: ["stun:stun.l.google.com:19302"]
        }
    ]
}

function emitWithAck(event, data) {
    return new Promise((resolve, reject) => {
        socket.emit(event, data, (response) => {
            console.log(response);
            resolve(response);
        });
    });
}

socket.on('message', (message) => {
    receivedMessage = JSON.parse(message);
    if (receivedMessage.type === 'room details') {
        connectedUsers = receivedMessage.room;
        console.log(connectedUsers);
    }
    else if (receivedMessage.type === 'new room id') {
        roomId = receivedMessage.newRoomId;
    }
    else if (receivedMessage.type === 'sender offer') {
        receivedOffer = receivedMessage.offer;
        console.log("received offer: ", receivedOffer);
    }
});

function getConstraints() {
    getAudioConstraints();
    return {
        video: getVideoConstraints(),
        audio: getAudioConstraints(),
    };
}

function getVideoConstraints() {
    resolution = document.getElementById('resolution').value;
    frameRate = document.getElementById('framerate').value;
    videoBitrate = document.getElementById('video-bitrate').value;

    if (resolution === '240p') {
        videoHeight = 240;
        videoWidth = 426;
    }
    else if (resolution === '360p') {
        videoHeight = 360;
        videoWidth = 640;
    }
    else if (resolution === '480p') {
        videoHeight = 480;
        videoWidth = 854;
    }
    else if (resolution === '720p') {
        videoHeight = 720;
        videoWidth = 1280;
    }
    else if (resolution === '1080p') {
        videoHeight = 1080;
        videoWidth = 1920;
    }

    return {
        width: { ideal: videoWidth },
        height: { ideal: videoHeight },
        frameRate: { ideal: frameRate },
        facingMode: facingMode,
        aspectRatio: { ideal: 16 / 9 },
    }

    // videoBitrate and audioBitrate are set in a different way from the peerConnection
}

function getAudioConstraints() {
    audioBitrate = document.getElementById('audio-bitrate').value;

    return {
        channelCount: { ideal: 2 },
    }
}

const fetchUserMedia = async () => {
    try {
        const constraints = getConstraints();

        stream = await navigator.mediaDevices.getUserMedia(constraints);
        localStream = stream;
        localVideo.srcObject = localStream;

        sharingAudio = true;
        sharingVideo = true;
    }
    catch (error) {
        console.log("Error accessing media devices.", error);
    }
}

const createConnection = async () => {
    try {
        peerConnection = new RTCPeerConnection(peerConfiguration);

        remoteStream = new MediaStream();
        remoteVideo.srcObject = remoteStream;

        localStream.getTracks().forEach(track => {
            console.log("adding track", track);
            console.log("tracks added to peer connection from local");
            peerConnection.addTrack(track, localStream);
        });

        // setting the max video and audio bitrate. saw other params like network priority in it. might be useful.
        const sender = peerConnection.getSenders().find(s => s.track.kind === 'video');
        if (sender) {
            const parameters = sender.getParameters();
            parameters.encodings[0].maxBitrate = videoBitrate * 1000;
            sender.setParameters(parameters);
        }

        const audioSender = peerConnection.getSenders().find(s => s.track.kind === 'audio');
        if (audioSender) {
            const audioParameters = audioSender.getParameters();
            audioParameters.encodings[0].maxBitrate = audioBitrate * 1000;
            audioSender.setParameters(audioParameters);
        }

        peerConnection.addEventListener('icecandidate', (event) => {
            if (event.candidate) {
                console.log("ice candidate generated");
                if (didIoffer === null) {
                    didIoffer = false;
                    socket.emit('ice-candidate', { roomId: roomId, candidate: event.candidate, whoSent: 'receiver' });
                }
                else {
                    socket.emit('ice-candidate', { roomId: roomId, candidate: event.candidate, whoSent: 'sender' });
                }
            }
        });

        peerConnection.addEventListener('track', (event) => {
            console.log("remote track received");
            if (event.streams && event.streams[0]) {
                remoteStream.addTrack(event.track);
            } else {
                console.error("No streams found in track event");
            }
        });
    }
    catch (error) {
        console.log("Error creating peer connection:", error);
    }
}

const makeCall = async () => {
    try {
        if (callLive) {
            disconnect(); // just to make sure that the previous connections are closed
        }
        roomdetailsElement.innerText = "";
        messageElement.innerText = "";

        didIoffer = true;
        await fetchUserMedia();

        await createConnection();

        myId = socket.id;

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        await emitWithAck('create-new-room', myId);
        console.log(roomId);

        roomdetailsElement.innerText = "room id: " + roomId;
        callLive = true;

        socket.emit('offer', { roomId: roomId, offer: offer });
    }
    catch (error) {
        console.log("Error creating offer:", error);
    }
}

const answerCall = async () => {
    try {
        if (callLive) {
            disconnect(); // just to make sure that the previous connections are closed
        }
        roomId = document.getElementById('roomId').value;

        if (!roomId) {
            console.log("no room id has been entered");
            messageElement.innerText = "Please enter a valid room ID.";
            return;
        }

        await emitWithAck('get-room', roomId);

        if (!connectedUsers || connectedUsers.senderId == null) {
            console.log("No members in the room. Please check if the room exists");
            messageElement.innerText = "No members in the room. Please check if the room exists.";
            return;
        }

        document.getElementById('roomId').value = "";
        messageElement.innerText = "";

        callLive = true;

        console.log(connectedUsers);

        await emitWithAck('get-sender-offer', roomId);

        await fetchUserMedia();

        await createConnection();

        myId = socket.id;

        await emitWithAck('add-receiver', { roomId: roomId, receiverId: myId });
        roomdetailsElement.innerText = "room id: " + roomId;

        await peerConnection.setRemoteDescription(receivedOffer);

        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        socket.emit('answer', { roomId: roomId, answer: answer });
    }
    catch (error) {
        console.log("Error answering call:", error);
    }
}

const addIceCandidate = async (candidate) => {
    try {
        console.log("adding received icecandidate");
        console.log(candidate);
        await peerConnection.addIceCandidate(candidate);
    }
    catch (error) {
        console.log("Error adding ICE candidate:", error);
    }
}

const addAnswer = async (answer) => {
    try {
        await peerConnection.setRemoteDescription(answer);
    }
    catch (error) {
        console.log("Error setting remote description:", error);
    }
}

function toggleAudio() {
    if (!callLive) {
        const audiomsgElement = document.getElementById('audio-msg');
        audiomsgElement.innerText = "Please start the call first.";
        return;
    }

    if (sharingAudio) {
        localStream.getAudioTracks().forEach(track => track.enabled = false);
        sharingAudio = false;
        const audiomsgElement = document.getElementById('audio-msg');
        audiomsgElement.innerText = "Audio sharing stopped.";
    }
    else {
        localStream.getAudioTracks().forEach(track => track.enabled = true);
        sharingAudio = true;
        const audiomsgElement = document.getElementById('audio-msg');
        audiomsgElement.innerText = "Audio sharing started.";
    }
}

function toggleVideo() {
    if (!callLive) {
        const videomsgElement = document.getElementById('video-msg');
        videomsgElement.innerText = "Please start the call first.";
        return;
    }

    if (sharingVideo) {
        localStream.getVideoTracks().forEach(track => track.enabled = false);
        sharingVideo = false;
        const videomsgElement = document.getElementById('video-msg');
        videomsgElement.innerText = "Video sharing stopped.";
    }
    else {
        localStream.getVideoTracks().forEach(track => track.enabled = true);
        sharingVideo = true;
        const videomsgElement = document.getElementById('video-msg');
        videomsgElement.innerText = "Video sharing started.";
    }
}

const handleVideoBitrateChange = () => {
    videoBitrate = document.getElementById('video-bitrate').value;

    if (peerConnection) {
        const sender = peerConnection.getSenders().find(s => s.track.kind === 'video');
        if (sender) {
            const parameters = sender.getParameters();
            parameters.encodings[0].maxBitrate = videoBitrate * 1000;
            sender.setParameters(parameters);
            console.log("Video bitrate changed to:", videoBitrate);
        }
    }
}

const handleAudioBitrateChange = () => {
    audioBitrate = document.getElementById('audio-bitrate').value;

    if (peerConnection) {
        const sender = peerConnection.getSenders().find(s => s.track.kind === 'audio');
        if (sender) {
            const parameters = sender.getParameters();
            parameters.encodings[0].maxBitrate = audioBitrate * 1000;
            sender.setParameters(parameters);
            console.log("Audio bitrate changed to:", audioBitrate);
        }
    }
}

const handleConstraintsChange = async () => {
    const constraints = getConstraints();

    localStream.getTracks().forEach(track => track.stop()); // stop existing tracks before getting new media

    stream = await navigator.mediaDevices.getUserMedia(constraints);
    localStream = stream;
    localVideo.srcObject = localStream;

    localStream.getTracks().forEach(track => {
        if (peerConnection) {
            const sender = peerConnection.getSenders().find(s => s.track.kind === track.kind);
            if (sender) {
                console.log('replacing track')
                sender.replaceTrack(track);
            } else {
                console.log('adding new track');
                peerConnection.addTrack(track, localStream);
            }
        }
    });
}

const startRecording = async () => {
    if (!stream) {
        const recorderElement = document.getElementById('recorder-message');
        recorderElement.innerText = "Please start the call first.";
        return;
    }
    const recorderElement = document.getElementById('recorder-message');
    recorderElement.innerText = "Recording started...";

    recordingAudioBitrate = document.getElementById('recording-audio-bitrate').value;
    recordingVideoBitrate = document.getElementById('recording-video-bitrate').value;
    console.log(recordingAudioBitrate, recordingVideoBitrate);

    mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'video/webm',
        videoBitsPerSecond: recordingVideoBitrate * 1000,
        audioBitsPerSecond: recordingAudioBitrate * 1000
    });

    mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
            recordedChunks.push(event.data);
        }
    };

    mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const downloadLink = document.createElement('a');
        downloadLink.href = url;
        downloadLink.download = 'recording.webm';
        downloadLink.click();
        recorderElement.innerText = "Recording stopped. Downloading the file...";
    };

    mediaRecorder.start();

    isRecording = true;
}

const stopRecording = async () => {
    if (!isRecording) {
        const recorderElement = document.getElementById('recorder-message');
        recorderElement.innerText = "Recording is not in progress.";
        return;
    }

    isRecording = false;
    mediaRecorder.stop();
    mediaRecorder = null;
    recordedChunks = [];
}

const disconnect = () => {
    socket.emit('stop', roomId);
}

const closeConnections = () => {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    receivedOffer = null;
    connectedUsers = null;
    roomId = null;
    myId = null;
    RemotePeerOffer = null;
    didIoffer = null;
    callLive = false;
    sharingAudio = false;
    sharingVideo = false;
    messageElement.innerText = "";
    roomdetailsElement.innerText = "";
    stream = null;

    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    if (remoteStream) {
        remoteStream.getTracks().forEach(track => track.stop());
    }

    localStream = null;
    remoteStream = null;
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    roomdetailsElement.innerText = "";

    if (isRecording) {
        isRecording = false;
        mediaRecorder.stop();
        mediaRecorder = null;
        recordedChunks = [];
    }
}

socket.on('answer', (answer) => {
    addAnswer(answer);
    console.log("answer has been received");
});

socket.on('offer', (offer) => {
    receivedOffer = offer;
    console.log("offer has been received");
});

socket.on('ice-candidate', (candidate) => {
    addIceCandidate(candidate);
    console.log("ice candidate received");
});

socket.on('stop', () => {
    closeConnections();
    console.log("call disconnected");
});
