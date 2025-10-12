# WebRTC Video Calling Application

A real-time peer-to-peer video calling application built with **WebRTC**, **Socket.IO**, and **Express.js**. This application enables users to create video call rooms, join existing rooms, and communicate with high-quality audio and video streaming capabilities.

## Features

### Core Functionality
- **Room-based Video Calling**: Create or join video call rooms using unique room IDs
- **Real-time Peer-to-Peer Communication**: Direct WebRTC connection between participants
- **Audio & Video Controls**: Toggle audio/video during calls
- **Screen Recording**: Record video calls with customizable quality settings
- **Responsive Design**: Works seamlessly across desktop and mobile devices

### Advanced Features
- **Configurable Video Quality**: Multiple resolution options (240p to 1080p)
- **Frame Rate Control**: Adjustable frame rates (15fps to 60fps)
- **Bitrate Management**: Real-time audio and video bitrate adjustment
- **HTTPS Security**: Secure connections with SSL certificates
- **ICE Candidate Exchange**: Robust NAT traversal using STUN servers

## Architecture

The application follows a client-server architecture with WebRTC for peer-to-peer communication:

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Client A      │    │   Server         │    │   Client B      │
│   (Sender)      │◄──►│   (Signaling)    │◄──►│   (Receiver)    │
│                 │    │                  │    │                 │
│ ┌─────────────┐ │    │ ┌──────────────┐ │    │ ┌─────────────┐ │
│ │ WebRTC      │ │    │ │ Socket.IO    │ │    │ │ WebRTC      │ │
│ │ Connection  │ │    │ │ Server       │ │    │ │ Connection  │ │
│ └─────────────┘ │    │ └──────────────┘ │    │ └─────────────┘ │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                                                │
         └──────────── Direct P2P Connection ────────────┘
```

### Key Components

1. **Server (`server/index.js`)**
   - Express.js web server with HTTPS support
   - Socket.IO for real-time signaling
   - Room management and user coordination
   - SSL certificate handling

2. **Client (`server/public/webRTC-scripts.js`)**
   - WebRTC peer connection management
   - Media stream handling (audio/video)
   - Socket.IO client for signaling
   - Recording functionality with MediaRecorder API

3. **Frontend (`server/public/index.html`)**
   - Responsive user interface
   - Video control panels
   - Quality settings configuration
   - Recording controls

## Getting Started

### Prerequisites

- **Node.js** (v14 or higher)
- **npm** (v6 or higher)
- **SSL certificates** (for HTTPS)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd webrtc
   ```

2. **Install dependencies**
   ```bash
   cd server
   npm install
   ```

3. **SSL Certificate Setup**
   
   The application requires SSL certificates for WebRTC functionality. Place your certificates in the root directory:
   - `localhost.pem` (certificate file)
   - `localhost-key.pem` (private key file)

   **For development**, you can generate self-signed certificates using `mkcert`:
   ```bash
   # Install mkcert (if not already installed)
   # On Windows: choco install mkcert
   # On macOS: brew install mkcert
   # On Linux: sudo apt install libnss3-tools && wget -O mkcert https://github.com/FiloSottile/mkcert/releases/download/v1.4.4/mkcert-v1.4.4-linux-amd64 && chmod +x mkcert && sudo mv mkcert /usr/local/bin/

   # Generate certificates
   mkcert localhost
   ```

4. **Start the server**
   ```bash
   npm run dev
   ```

5. **Access the application**
   
   Open your browser and navigate to: `https://localhost:5000`

### Important Note

**This project is currently set up for local development only and is not deployed to a public server.** For production deployment, you would need to:

- Purchase a domain name from a domain registrar
- Obtain valid SSL certificates for your domain (e.g., from Let's Encrypt or a certificate authority)
- Configure the server with your domain's SSL certificates
- Deploy to a hosting service (AWS, DigitalOcean, Heroku, etc.)

The current setup uses localhost SSL certificates that only work for local development.

## Usage Guide### Development Mode

For development with auto-restart:
```bash
npm run dev  # Uses nodemon for automatic restarts
```

## 📋 Usage Guide

### Creating a Video Call

1. **Start a new room**
   - Click the "Create Room" button
   - Share the generated Room ID with participants
   - Wait for participants to join

2. **Join an existing room**
   - Enter the Room ID in the input field
   - Click "Join Room"
   - Accept camera/microphone permissions when prompted

### During a Call

- **Toggle Audio**: Click "Toggle Audio" to mute/unmute
- **Toggle Video**: Click "Toggle Video" to enable/disable camera
- **Adjust Quality**: Use the options panel to change resolution, frame rate, and bitrate
- **Record Call**: Click "Start Recording" to save the session locally
- **End Call**: Click "Disconnect" to leave the room

### Quality Settings

#### Video Options
- **Resolutions**: 240p, 360p, 480p, 720p, 1080p
- **Frame Rates**: 15fps, 24fps, 30fps, 60fps
- **Video Bitrate**: 1000-10000 kbps

#### Audio Options
- **Audio Bitrate**: 64-256 kbps
- **Channels**: Stereo (2 channels)

#### Recording Options
- **Video Bitrate**: 1000-10000 kbps (independent of live stream)
- **Audio Bitrate**: 64-256 kbps (independent of live stream)
- **Format**: WebM video format

## Technical Implementation

### WebRTC Flow

1. **Offer/Answer Exchange**
   ```javascript
   // Caller creates offer
   const offer = await peerConnection.createOffer();
   await peerConnection.setLocalDescription(offer);
   
   // Callee receives offer and creates answer
   await peerConnection.setRemoteDescription(offer);
   const answer = await peerConnection.createAnswer();
   ```

2. **ICE Candidate Exchange**
   ```javascript
   peerConnection.addEventListener('icecandidate', (event) => {
     if (event.candidate) {
       socket.emit('ice-candidate', { roomId, candidate: event.candidate });
     }
   });
   ```

3. **Media Stream Management**
   ```javascript
   // Add local stream to peer connection
   localStream.getTracks().forEach(track => {
     peerConnection.addTrack(track, localStream);
   });
   
   // Receive remote stream
   peerConnection.addEventListener('track', (event) => {
     remoteStream.addTrack(event.track);
   });
   ```

### Socket.IO Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `create-new-room` | Client → Server | Request new room creation |
| `offer` | Client → Server | Send WebRTC offer |
| `answer` | Client → Server | Send WebRTC answer |
| `ice-candidate` | Client ↔ Server | Exchange ICE candidates |
| `add-receiver` | Client → Server | Add participant to room |
| `stop` | Client → Server | End call and cleanup |

### Room Management

The server maintains active rooms in memory:
```javascript
const Rooms = {
  [roomId]: {
    senderId: 'socket-id-1',
    receiverId: 'socket-id-2',
    senderOffer: { /* WebRTC offer */ },
    senderICE: { /* ICE candidate */ },
    receiverICE: { /* ICE candidate */ }
  }
};
```

## Project Structure

```
webrtc/
├── localhost.pem              # SSL certificate
├── localhost-key.pem          # SSL private key
├── server/
│   ├── index.js              # Express server & Socket.IO
│   ├── package.json          # Dependencies & scripts
│   └── public/
│       ├── index.html        # Frontend interface
│       ├── index.css         # Styling & responsive design
│       └── webRTC-scripts.js # WebRTC client logic
└── README.md                 # Documentation
```

## API Reference

### Server Endpoints

- **GET /** - Serves the main application interface
- **Static Files** - Serves files from `/server/public/`

### Socket.IO Events

#### Client Events (Emitted by Client)

- `create-new-room(senderId)` - Creates a new video call room
- `add-receiver({ roomId, receiverId })` - Adds receiver to existing room
- `offer({ roomId, offer })` - Sends WebRTC offer to room
- `answer({ roomId, answer })` - Sends WebRTC answer to room
- `ice-candidate({ roomId, candidate, whoSent })` - Exchanges ICE candidates
- `get-room(roomId)` - Retrieves room details
- `get-sender-offer(roomId)` - Retrieves sender's offer
- `stop(roomId)` - Terminates call and cleans up room

#### Server Events (Emitted by Server)

- `answer(answer)` - Forwards WebRTC answer to caller
- `ice-candidate(candidate)` - Forwards ICE candidate to peer
- `stop()` - Notifies client of call termination

## Security Considerations

- **HTTPS Required**: WebRTC requires secure contexts (HTTPS/localhost)
- **SSL Certificates**: Production deployments need valid SSL certificates
- **CORS Configuration**: Configured for development (`origin: '*'`)
- **Media Permissions**: Requires user consent for camera/microphone access

## Deployment

**Note: This application is currently not deployed and runs only in local development mode.**

### Requirements for Production Deployment

To deploy this application to a public server, you will need:

1. **Domain Name**: Purchase a domain from a registrar (GoDaddy, Namecheap, etc.)
2. **SSL Certificates**: Obtain valid SSL certificates for your domain
3. **Hosting Service**: Choose a hosting provider (AWS, DigitalOcean, Heroku, etc.)
4. **Server Configuration**: Update server settings for production environment

### Production Deployment Steps

1. **Obtain SSL Certificates**
   ```bash
   # Use Let's Encrypt or your certificate authority
   certbot certonly --standalone -d yourdomain.com
   ```

2. **Update Certificate Paths**
   ```javascript
   const options = {
     key: fs.readFileSync('/path/to/privkey.pem'),
     cert: fs.readFileSync('/path/to/fullchain.pem')
   };
   ```

3. **Configure CORS**
   ```javascript
   const io = new Server(server, {
     cors: {
       origin: "https://yourdomain.com",
       methods: ['GET', 'POST'],
     }
   });
   ```

4. **Environment Variables**
   ```bash
   PORT=443
   NODE_ENV=production
   ```

### Docker Deployment

```dockerfile
FROM node:16-alpine
WORKDIR /app
COPY server/package*.json ./
RUN npm ci --only=production
COPY server/ .
COPY *.pem ./
EXPOSE 5000
CMD ["node", "index.js"]
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the ISC License - see the package.json file for details.

## Troubleshooting

### Common Issues

1. **"Camera/Microphone not accessible"**
   - Ensure HTTPS is used (WebRTC requirement)
   - Check browser permissions
   - Verify SSL certificates are valid

2. **"No members in the room"**
   - Verify the Room ID is correct
   - Ensure the room creator is still connected
   - Check network connectivity

3. **Poor Video Quality**
   - Adjust bitrate settings in the options panel
   - Check network bandwidth
   - Try lower resolution settings

4. **Connection Failed**
   - Verify STUN server accessibility
   - Check firewall settings
   - Ensure both participants have stable internet

### Browser Compatibility

- **Chrome**: Full support (recommended)
- **Firefox**: Full support
- **Safari**: Supported (iOS 11+)
- **Edge**: Supported (Chromium-based)

## Support

For issues and questions:
1. Check the troubleshooting section above
2. Review browser console for error messages
3. Ensure all prerequisites are met
4. Verify SSL certificate configuration

---

**Built using WebRTC, Socket.IO, and Express.js**