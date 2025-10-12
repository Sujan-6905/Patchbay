const https = require('https');
const express = require('express');
const fs = require('fs');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();

const options = {
    key: fs.readFileSync('../localhost-key.pem'),
    cert: fs.readFileSync('../localhost.pem')
    //key: fs.readFileSync('../172.16.99.140-key.pem'),
    //cert: fs.readFileSync("../172.16.99.140.pem")
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, './public/index.html'));
});

const server = https.createServer(options, app);

const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    }
});

const Rooms = { // this is just sample data
    12 /* room id */: {
        'senderId': 'sender\'s id',
        'receiverId': 'receiver\'s id',
    }
}

io.on('connect', (socket) => {
    console.log("new client connected " + socket.id);

    socket.on('answer', ({ roomId, answer }) => {
        const senderId = Rooms[roomId].senderId;
        io.to(senderId).emit('answer', answer);
        Rooms[roomId].receiverAnswer = answer;
    });

    socket.on('offer', ({ roomId, offer }) => {
        Rooms[roomId].senderOffer = offer;
    });

    socket.on('ice-candidate', ({ roomId, candidate, whoSent }) => {
        if (whoSent === 'sender') {
            // if the ice candidate event occurs before the room is created
            if (Rooms[roomId] === undefined) {
                Rooms[roomId] = { senderIce: candidate };
            }
            else {
                Rooms[roomId].senderICE = candidate;
            }
        }
        else if (whoSent === 'receiver') {
            Rooms[roomId].receiverICE = candidate;

            io.to(Rooms[roomId].senderId).emit('ice-candidate', candidate);
            io.to(Rooms[roomId].receiverId).emit('ice-candidate', Rooms[roomId].senderICE);
        }
    });

    socket.on('stop', (roomId) => {
        if (roomId && Rooms[roomId] && Rooms[roomId].senderId) {
            io.to(Rooms[roomId].senderId).emit('stop');
        }
        if (roomId && Rooms[roomId] && Rooms[roomId].receiverId) {
            io.to(Rooms[roomId].receiverId).emit('stop');
        }
        if (roomId && Rooms[roomId]) {
            delete Rooms[roomId];
        }
    });

    socket.on('get-room', (roomId, callback) => {
        const sendData = {
            "type": "room details",
            "room": Rooms[roomId],
        }

        socket.send(JSON.stringify(sendData));
        callback({ "status": "ok" });
    })

    socket.on('get-sender-offer', (roomId, callback) => {
        const sendData = {
            "type": "sender offer",
            "offer": Rooms[roomId].senderOffer,
        }

        socket.send(JSON.stringify(sendData));
        callback({ "status": "ok" });
    })

    socket.on('create-new-room', (senderId, callback) => {
        const newRoomId = uuidv4();
        const sendData = {
            "type": "new room id",
            "newRoomId": newRoomId,
        }

        // the ice candidate event may occur before the room is created
        if (Rooms[newRoomId] !== undefined) {
            Rooms[newRoomId].senderId = senderId;
        }
        else {
            Rooms[newRoomId] = { senderId: senderId };
        }
        socket.send(JSON.stringify(sendData));
        callback({ "status": "ok" })
    })

    socket.on('add-receiver', ({ roomId, receiverId }, callback) => {
        Rooms[roomId].receiverId = receiverId;
        callback({ "status": "ok" });
    })
});

const PORT = 5000;

server.listen(PORT, () => {
    console.log(`server is running on https://localhost:${PORT}`);
})
