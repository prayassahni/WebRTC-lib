
 class SplitterDBS {

    static get MAX_LOST_CHUNK() {
        return 32;
    }

    constructor() {
        this.id = "S";
        this.alive = true;
        this.peerList = [];
        this.chunkNumber = 0;
        this.chunkBuffer = [];
        this.losses = {};
        this.chunkDestination = [];
        this.bufferSize = Common.BUFFER_SIZE;
        this.peerNumber = 0;
        this.maxNumberOfChunkLoss = SplitterDBS.MAX_LOST_CHUNK;
        this.totalMonitors = 0;
        this.outgoingPeerList = [];
        this.newChunk = 0;
        this.signalServer = "";
        this.peerConnection = {}; 
        this.peerChannel = {};
    }
    
    preinitialise() {
        this.signalServer = new WebSocket(Common.URL);
        this.signalServer.binaryType = "arraybuffer";
        this.signalServer.onopen = () => {
            const sendObj = {
                "addSplitter": true,
                "splitterId": this.id
            }
            this.signalServer.send(JSON.stringify(sendObj));
            this.signalServer.onmessage = (event) => {
                console.log('message recieved');
                const msg = JSON.parse(event.data);
                this.handleSignallingMessage(msg);
            }
        }
    }

    //Splitter acts as a passive signaller
    handleSignallingMessage(message) {
        let currentPeer = message.peerId; 
        if(!this.peerConnection[currentPeer]) {
            this.peerConnection[currentPeer] = new RTCPeerConnection(Common.SERVER_CONFIG);
            this.peerConnection[currentPeer].ondatachannel = (event) => {
                //sctp negotiated with remote peer
                console.log(event.channel);
               /* let channel = event.channel;
                let id = channel.id*/
                this.setupchannelHandlers(currentPeer,event.channel);
            } 
        }
        if(message.sessionDescriptionProtocol) {
            this.peerConnection[currentPeer].setRemoteDescription(message.sessionDescriptionProtocol).then(() => {
                    console.log(this.peerConnection[currentPeer].remoteDescription);
                    return navigator.mediaDevices.getUserMedia({audio: true, video: true});
                })
                .then((stream) => {
                    return this.peerConnection[currentPeer].addStream(stream);
                })
                .then(() => {
                    return this.peerConnection[currentPeer].createAnswer();
                })
                .then((answer) => {
                    return this.peerConnection[currentPeer].setLocalDescription(answer);
                })
                .then(() => {
                    const sendObj = {
                         senderId: this.id,
                         sessionDescriptionProtocol: this.peerConnection[currentPeer].localDescription,
                         receiverId: currentPeer
                    }
                    console.log(sendObj);
                    this.signalServer.send(JSON.stringify(sendObj));
                })
                .catch(e => {
                     console.log(e);
                });
        } else {
            if(message.candidate) {
                this.peerConnection[currentPeer].addIceCandidate(message.candidate).then(() => {
                console.log('succesfully added candidate' + message.candidate);j
                })
                .catch(e => {
                    console.log(e + 'Could not add ice candidate');
                });
            }
        }
        this.peerConnection[currentPeer].onicecandidate = (event) => {
            let message = {
                senderId: this.id,
                receiverId: currentPeer,
                candidate: event.candidate
            }
            this.signalServer.send(JSON.stringify(message));
        };
        //this.createDataChannels(currentPeer);
    }
    /*createDataChannels(currentPeer) {
        console.log('ye hai' + currentPeer);
        this.peerChannel[currentPeer] = [];
        //Ice candidates will start firing after this 
        this.peerChannel[currentPeer][0] = this.peerConnection[currentPeer].createDataChannel("tcpLike " + currentPeer, Common.TCP_CONFIG);
        this.peerChannel[currentPeer][1] = this.peerConnection[currentPeer].createDataChannel("udpLike " + currentPeer, Common.UDP_CONFIG);
        this.setupchannel(currentPeer);
    }*/

    setupchannelHandlers(currentPeer,channel) {
        //id used to distinguish reliable and unreliable channels
        let id = channel.id;
        this.peerChannel[currentPeer] = [];
        this.peerChannel[currentPeer][id] = channel ;
        this.peerChannel[currentPeer][id].onopen = (event) => {console.log('channel open');}
        this.peerChannel[currentPeer][id].onmessage = (event) => {
            //console.log('bhen chode' + event.data);
            const message = JSON.parse(event.data);
            if(id == 0) {
                console.log(currentPeer);
                this.handlePeerArrival(message,currentPeer);
            }
            else {
                this.moderateTheTeam(message);
            }
        }
        
    }

    handlePeerArrival(message,peer) {
        let peerId = peer;
        let newPeer = [];
        if (message.monitor) {
            this.totalMonitors += 1;
            newPeer[0] = "M";
        } else {
            newPeer[0] = "P";
        }
        newPeer[1] = peerId;
        this.sendBufferSize(peerId);
        this.sendNumberOfPeers(peerId);
        this.sendListOfPeers(peerId);
        this.insertPeer(newPeer);
        //finally close the reliable channel with the peer
        this.peerChannel[peerId][0].close();
    }

    //Simulating chunk as fixed bytes
    //To be Modified to handle stream from source and breaking it into chunks
    receiveChunk(chunk) {
        const peer = this.peerList[this.peerNumber][1];
        //16 bits suffice for chunkNum
        //Currently let peer and chunkData be identified by a single unicode
        let chunkNumber = new Uint16Array(1); 
        let message = new Uint16Array(chunkNumber.length + chunk.length + peer.length);
        message[0] = this.chunkNumber;
        message[1] = this.id;
        message[2] = chunk;
        this.chunkDestination[message[0] % this.bufferSize] =  message[1];
        this.sendChunk(message, peer);
        this.chunkNumber +=1;        
    }

    //sends chunk to peer on based on round-roubin scheme
    sendChunk(chunkMessage, peer) {
        try {
            this.peerChannel[peer][1].send(chunkMessage);
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

    //Helper used by splitter to communicate team details to incoming peer
    sendTeamInfo(message,peer) {
        try {
           this.peerChannel[peer][0].send(JSON.stringify(message));
        } catch {
            console.log('Issue sending chunk');
        }
    }

    sendBufferSize(peer) {
        const message = {
            bufferSize: this.bufferSize
        }
        //this.peerChannel[peer][0].send(JSON.stringify(message));
        sendTeamInfo(message,peer);
    }

    sendNumberOfPeers(peer) {
        const message = {
            numMonitors: this.totalMonitors,
            numPeers: this.peerList.length
        }
        //this.peerChannel[peer][0].send(JSON.stringify(message));
        this.sendTeamInfo(message,peer);
    }

    sendListOfPeers(peer) {
        const message = {
            peerList: this.peerList
        } 
        this.sendTeamInfo(message,peer);
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
                this.removePeer(peer);
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
        const peerIndex = this.peerList.indexOf(peer);
        if (peerIndex != -1) {
            this.peerList.splice(peerIndex, 1);
            if (peer[0] == "M")
                this.totalMonitors -= 1;
        }
        const peerLossIndex = this.losses.indexOf(peer);
        if (peerLossIndex != -1) {
            this.losses.splice(peerLossIndex, 1);
        }
    }

    processGoodBye(peer) {
        if (this.outgoingPeerList.indexOf(peer) == -1 && this.peerList.indexOf(peer) != -1) {
            this.outgoingPeerList.push(peer);
        }
    }

    sayGoodBye(peer) {
        const message = {
            controlMessage: Common.GOODBYE
        };
        try {
            this.peerChannel[peer][1].send(message);
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
        const sender = message.senderId;
        if (message.controlMessage == Common.GOODBYE) {
            this.processGoodBye(sender);
        } else {
            const lostChunkNumber = message.lostChunk;
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

