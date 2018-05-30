import Common from './common.js'
export default class Splitter_DBS {
    static get UDP_CONFIG() {
        return {
            //Subject to change
            maxPacketLifeTime: 3000,
            maxRetransmits: 3,
            ordered: false
        }
    }
    static get TCP_CONFIG() {
        return {
            ordered: true
        }
    }
    static get URL() {
        return 'ws://localhost:9030';
    }
    static get MAX_LOST_CHUNK() {
        return 32;
    }
    constructor() {
        this.id = 0;
        this.alive = true;
        this.peerList = [];
        this.chunkBuffer = [];
        this.losses = {};
        this.chunkDestination = [];
        this.bufferSize = Common.BUFFER_SIZE;
        this.peerNumber = 0;
        this.maxNumberOfChunkLoss = Splitter_DBS.MAX_LOST_CHUNK;
        this.totalMonitors = 0;
        this.outgoingPeerList = [];
        this.newChunk = 0;
        this.signalServer = "";
        this.pc = [];
        this.peerChannel = [];
    }


    preinitialise() {
        this.signalServer = new WebSocket(Splitter_DBS.url);
        this.signalServer.binaryType = "arraybuffer";
        this.signalServer.onopen = () => {
            console.log(this + 'check');
            this.signalServer.send(JSON.stringify({
                "addSplitter": true
            }));
            this.signalServer.onMessage = (event) => {
                console.log('message recieved')
                let msg = JSON.parse(event.data);
                this.handleSignallingMessage(msg);
            }
        }
    }
    //Splitter acts as passive signaller
    handleSignallingMessage(message) {
        let currentPeer = message.peerId;
        if (message.sdp) {
            this.pc[currentPeer] = new RTCPeerConnection(Common.SERVERCONFIG);
            this.pc[currentPeer].setRemoteDescription(message.sdp).then(() => {
                    return navigator.mediaDevices.getUserMedia(mediaConstraints);
                })
                .then((stream) => {
                    return this.pc[currentPeer].addStream(stream);
                })
                .then(() => {
                    return this.pc[currentPeer].createAnswer();
                })
                .then((answer) => {
                    return this.pc[currentPeer].setLocalDescription(answer);
                })
                .then(() => {
                    this.signalserver.send(JSON.stringify({
                         senderId: this.id,
                         sdp: this.pc[currentPeer].localDescription,
                         recieverId: currentPeer
                    }));
                })
                .catch(e => {
                     console.log(e + 'Could not add ice candidate');
                });
        } else {
            this.pc[currentPeer].addIceCandidate(message.candidate).then(() => {
                console.log('succesfully added candidate');
            }).catch(e => {
                console.log(e + 'Could not add ice candidate');
            });
        }
        this.pc[currentPeer].onicecandidate.then(() => {
            let message = {
                senderId: this.id,
                recieverId: currentPeer,
                candidate: event.candidate
            }
            this.signalserver.send(JSON.stringify(message));
        });
        this.createDataChannels(currentPeer);
    }
    createDataChannels(currentPeer) {
        this.peerChannel[currentPeer][0] = this.pc[currentPeer].createDataChannel("tcpLike " + currentPeer, Splitter_DBS.TCP_CONFIG);
        this.peerChannel[currentPeer][1] = this.pc[currentPeer].createDataChannel("udpLike " + currentPeer, SPlitter_DBS.UDP_CONFIG);
        this.setupChannel(currentPeer);
    }

    setupChannel(currentPeer) {
        this.peerChannel[currentPeer][0].onMessage = (event) => {
            let message = JSON.parse(event.data);
            this.handlePeerArrival(message);
        }
        this.peerChannel[currentPeer][1].onMessage = (event) => {
            let message = JSON.parse(event.data);
            this.moderateTheTeam(message);
        }
    }

    handlePeerArrival(message) {
        let peer = [];
        if (message.monitor) {
            this.totalMonitors += 1;
            peer[0] = "Monitor";
        } else {
            peer[0] = "Peer";
        }
        peer[1] = message.senderId;
        this.sendBufferSize(peer);
        this.sendNumberOfPeers(peer);
        this.sendListOfPeers(peer);
        this.insertPeer(peer);
        //finally closw the tcp channel with the peer
        this.peerChannel[peer[1]][0].close();
    }
    //source feeds the splitter with chunks 
    receiveChunk(chunk) {
        let peer = this.peerList[this.peerNumber];
        let message = new Uint8Array(chunkNumber.length + chunk.length + peer.length);
        message[0] = chunk[0];
        message[1] = this.id;
        message[2] = chunk;
        this.chunkDestination[message[0] % this.bufferSize] =  message[1];
        this.sendChunk(message, peer);        
    }
    //sends chunk to peer based on round-roubin scheme
    sendChunk(chunkMessage, peer) {
        try {
            this.peerChannel[peer[1]].send(chunkMessage);
        } catch {
            console.log(peer + 'left the team');
        }
        //update state details after succesully sending chunk
        this.updateState();
    }
    updateState() {
        if (this.peerNumber == 0)
            this.onRoundBeginning();
        this.chunkNumber = (this.chunkNumber + 1) % Common.MAX_CHUNK_NUMBER;
        this.computeNextPeer();
        if (this.peerNumber == 0)
            this.currentRound += 1;
    }

    sendBufferSize(peer) {
        let message = {
            bufferSize: this.bufferSize
        }
        this.peerChannel[peer[1]][0].send(JSON.stringify(message));
    }
    sendNumberOfPeers(peer) {
        let message = {
            numMonitors: this.totalMonitors,
            numPeers: this.peerList.length
        }
        this.peerChannel[peer[1]][0].send(JSON.stringify(message));
    }
    sendListOfPeers(peer) {
        let message = {
            peerList: this.peerList
        }
        try {
            this.peerChannel[peer[1]][0].send(JSON.stringify(message));
        } catch {
            console.log(peer + ' ' + 'has left');
        }
    }
    insertPeer(peer) {
        if (this.peerList.indexOf(peer) > -1) {
            this.peerList.push(peer);
        }
        this.losses[peer] = 0;
    }
    incrementUnsupportivePeer(peer) {
        try {
            this.losses[peer] += 1;
            if (this.losses[peer] > Common.MAX_CHUNK_LOSS) {
                this.remove_peer(peer);
            }
        } catch {
            console.log('Unsupportive peer does not exist');
        }
    }
    processLostMessage(lostChunkNumber, sender) {
        let destination = this.getLosser(lostChunkNumber);
        this.incrementUnsupportivePeer(destination);
    }
    getLosser(lostChunkNumber) {
        return this.chunkDestination[lostChunkNumber % this.bufferSize];
    }
    removePeer(peer) {
        let peerIndex = this.peerList.indexOf(peer);
        if (peerIndex != -1) {
            this.peerList.splice(peerIndex, 1);
            if (peer[0] === "Monitor")
                this.totalMonitors -= 1;
        }
        let peerLossIndex = this.losses.indexOf(peer);
        if (peerLossIndex != -1) {
            this.losses.splice(peerLossIndex, 1);
        }
    }
    processGoodBye(peer) {
        if (this.outgoingPeerList.indexOf(peer) === -1 && this.peerList.indexOf(peer) != -1) {
            this.outgoingPeerList.push(peer);
        }
    }
    sayGoodBye(peer) {
        let message = {
            goodBye: true
        };
        try {
            this.peerChannel[peer[1]].send(message);
        } catch {
            console.log(peer + 'has already left');
        }
    }
    removeOutgoingPeers() {
        for (let i = 0; i < this.outgoingPeerList.length; i++) {
            this.sayGoodBye(this.outgoingPeerList[i]);
            this.removePeer(this.outgoingPeerList[i]);
        }
        this.outgoingPeerList = [];
    }
    onRoundBeginning() {
        this.removeOutgoingPeers();
    }
    moderateTheTeam(message) {
        let sender = message.senderId;
        let lostChunkNumber = message.lostChunk;
        if (message.goodBye) {
            this.processGoodBye(sender);
        } else {
            this.processLostMessage(lostChunkNumber, sender);
        }
    }
    resetCounter() {
        for (let i = 0; i < this.losses.length; i++) {
            this.losses[i] /= 2;
        }
    }
    resetWrapper() {
        this.resetCounter();
        setTimeout(function() {
            this.resetWrapper, Common.COUNTER_TIMING
        });
    }
    computeNextPeer() {
        this.peerNumber = (this.peerNumber + 1) % this.peerList.length;
    }
}

