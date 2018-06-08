class PeerDBS {
    static get MAX_CHUNK_DEBT() {
        return 16;
    }
    
    static get BUFFER_SIZE() {
        return 32;
    }
    
    constructor(id) {
        this.debt = {}; //keeps track of unsupportive peers maintaing differnce between total chunks sent and recieved
        this.forwarding = {}; //table indexed by chunk's source peer,having entries for peerID's to whom the source peer's chunk to be forwarded
        this.pending = {}; //chunks buffered but not sent to required neighbour
        this.chunks = []; //buffer of chunks to be played by the peer 
        this.chunkToPlay = 0; //Keeps track of the chunkNumber required to be played
        this.lastRecievedChunk; //Useful to ensure that current chunk recieved is not to far away from previous chunk
        this.neighbours;
        this.totalMonitorPeers = 0;
        this.totalPeers = 0;
        this.peerId = id; //Unique identifier for peer of a team 
        this.waitingForGoodbye = true; //Peer can only leave when splitter has no more chunks to send
        this.leavingTeam = false; //flag that fires the leaving process
        this.sentChunks = 0;
        this.recievedChunks = 0;
        this.consumedChunks = 0;
        this.playedChunks = 0;
        this.lostChunks = 0;
        this.chunksBeforeLeaving = 0;
        this.pc = {};
        this.peerChannel = {};
        this.splitterId = "S";
        this.playerALive = true; // A flag which is evaluated after playing each chunk,to check the status of player
        this.peerList = [];
        this.signalSever = "";
        this.currentChunk = 0; //Current chunk to be played
    }
    
    preinitialise() {
        console.log(this + 'hey');
        this.signalServer = new WebSocket(Common.URL);
        this.signalServer.binaryType = "arraybuffer";
        this.signalServer.onopen = () => {
            const sendObject = {
                "addPeer": true,
                "peerId": this.peerId
            }
            this.signalServer.send(JSON.stringify(sendObject));
        }
        this.signalServer.onmessage = (event) => {
            console.log('message recieved from splitter/peer');
            const msg = JSON.parse(event.data);
            const senderId = msg.senderId;
            if (msg.sessionDescriptionProtocol) {
                console.log("got remote description");
                //console.log(senderId + 'lassan');
                this.pc[senderId].setRemoteDescription(msg.sessionDescriptionProtocol);
            }
            //check for null candidates
            if (msg.candidate) {
                this.pc[senderId].addIceCandidate(msg.candidate);
            }
        }
    }
    
    connectToSplitter() {
        //initiate signalling with splitter
        this.inititateConnection(true, this.splitterId);
        this.forwarding[this.peerId] = [];
    }
    //Peer act as active signallers to the splitter and existing peer when they're new to the team
    //Existing peers use it on arrival of new peer(Passive)
    //Active signallers createDatachannel and other exististing peers/splitter register handlers on them
    
    inititateConnection(isInitiator, currentPeer) {
        this.pc[currentPeer] = new RTCPeerConnection(Common.SERVER_CONFIG);
        if (isInitiator) {
            console.log('koo');
            this.createDataChannel(currentPeer);
        } else {
            this.listenforDataChannels(currentPeer);
            console.log('ook');
        }
        navigator.mediaDevices.getUserMedia({
            audio: true,
            video: true
        }, function(stream) {
            const localStream = stream;
            console.log(localStream);
            this.pc[currentPeer].addStream(stream);
            //gotLocalStream(localStream, currentPeer);
        }, function() {
            console.log('streaming error')
        });
        //Ice candidates fired when data channel created after setting local description(Works both with chrome and firefox)
        this.pc[currentPeer].onicecandidate = (event) => {
            console.log("ice candidate" + event.candidate);
            const sendObj = {
                "candidate": event.candidate,
                "peerId": this.peerId,
                "receiverId": currentPeer
            }
            this.signalServer.send(JSON.stringify(sendObj));
        };
        //Makes sure that createOffer called after creating data channels
        this.pc[currentPeer].onnegotiationneeded = () => {
            this.pc[currentPeer].createOffer()
                .then((offer) => {
                    console.log(offer);
                    this.pc[currentPeer].setLocalDescription(offer);
                })
                .then(() => {
                    console.log(this.pc[currentPeer].localDescription + currentPeer);
                    const sendObj = {
                        "sessionDescriptionProtocol": this.pc[currentPeer].localDescription,
                        "receiverId": currentPeer,
                        "peerId": this.peerId
                    };
                    this.signalServer.send(JSON.stringify(sendObj));
                })
                .catch(e => {
                    console.log(e);
                })
        };
    }
    //Used only by new peers to establish connection with existing peers and splitter
    createDataChannel(currentPeer) {
        this.peerChannel[currentPeer] = [];
        if (currentPeer == this.splitterId) {
            //Reliable channel only with the splitter
            this.peerChannel[currentPeer][0] = this.pc[currentPeer].createDataChannel("tcpLike ", Common.TCP_CONFIG);
            this.setupChannel(currentPeer, 0);
        }
        this.peerChannel[currentPeer][1] = this.pc[currentPeer].createDataChannel("udpLike ", Common.UDP_CONFIG);
        this.setupChannel(currentPeer, 1);
    }

    handleIncomingDataChannels(currentPeer) {
        this.pc[currentPeer].ondataChannel = (event) => {
            console.log('Data channel recieved');
            const type = event.channel.id;
            this.peerChannel[currentPeer] = [];
            this.peerChannel[currentpeer][type] = event.channel;
            this.setupChannel(currentpeer, type);
        }
    }
    // type == 0 => reliable
    // type == 1 => unreliable
    setupChannel(currentPeer, type) {
        this.peerChannel[currentPeer][type].onopen = (event) => {
            this.sayHello(currentPeer);
        }
        this.peerChannel[currentPeer][type].onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (currentPeer == this.splitterId) {
                if (type == 0) {
                    //receive meta-information about team
                    this.receiveTeamInformation(msg);
                } else {
                    //recieve source chunks
                    this.handleChunk(msg, currentPeer);
                }
            } else {
                if (msg.controlMessage) {
                    ///messages send by other peers that require specific action
                    this.handleControlMessage(msg, currentPeer);
                } else {
                    this.handleChunk(msg, currentPeer);
                }
            }
        }
    }
    
    receiveTeamInformation(message) {
        if (message.peerList) {
            for (let i = 0; i < this.totalPeers; i++) {
                //new peer act as active signallers
                this.inititateConnection(true, peerList[i]);
                this.addPeer(peerList[i]);
                this.sayHello(peerList[i]);
            }
        } else if (message.numPeers) {
            this.totalMonitorPeers = message.numMonitors;
            this.totalPeers = message.numPeers;
        } else {
            this.bufferSize = message.bufferSize;
        }
    }

    handleControlMessage(message, sender) {
        //chunk number = 0
        //chunk = 1;
        //origin peer = 2;
        const type = message.controlMessage;
        switch (type) {
            case Common.PRUNE:
                {
                    const origin = message.chunkNum;
                    //Remove sender from forwarding table entries indexed by origin
                    if (origin in this.forwarding) {
                        const senderIndex = this.forwarding[origin].indexOf(sender);
                        if (senderIndex !== -1) {
                            this.forwarding[origin].splice(senderIndex, 1);
                        }
                    }
                }
            case Common.GOODBYE:
                {
                    if (sender != this.splitterId) {
                        //Remove sender from all forwarding table entries
                        for (let listIndex in this.forwarding) {
                            const senderIndex = listIndex.indexOf(sender);
                            if (senderIndex != -1) {
                                listIndex.splice(senderIndex, 1);
                            }
                        }
                        delete this.debt[sender];
                    } else {
                        this.waitingForGoodbye = false;
                    }
                }
            case Common.HELLO:
                {
                    const senderIndex = this.forwarding[this.id].indexOf(sender);
                    if (senderIndex == -1) {
                        this.forwarding[this.id].push(sender);
                        this.debt[sender] = 0;
                        this.neighbour = sender;
                    }
                }
            case Common.REQUEST:
                {
                    const chunkRequested = message.chunkNum;
                    //position in buffer maps to appropriate source
                    const origin = this.chunks[chunkRequested % this.bufferSize][2];
                    if (origin in this.forwarding) {
                        const senderIndex = this.forwarding[origin].indexOf(sender);
                        if (senderIndex != -1) {
                            this.forwarding[origin].push(sender);
                        }
                        this.debt[sender] = 0;
                    } else {
                        if (origin) {
                            this.forwarding[origin] = [sender];
                        }
                    }

                }
        }
    }
    
    //When message received is an actual chunk
    handleChunk(chunkMessage, sender) {
        const chunkNumber = chunkMessage[0];
        //Duplicate chunk received,ask the sending peer to remove entry from origin of the forwarding table
        if (this.chunks[chunkNumber % this.bufferSize][0] == chunkNumber) {
            this.pruneOrigin(chunkNumber, sender)
        } else {
            const chunk = chunkMessage[1];
            const origin = chunkMessage[2];
            this.recievedChunks += 1;
            if (sender != this.splitterId) {
                if (sender in this.debt) {
                    //Initialise debt 
                    this.debt[sender] -= 1;
                } else {
                    this.debt[sender] = -1;
                }
                //The sender becomes the neigbour if no neighbour yet
                if (!this.neighbour) {
                    this.neighbour = sender;
                }
                //the reciever creates entry of it in its own forwarding table
                if (this.forwarding[this.id].indexOf(sender) == -1) {
                    this.forwarding[this.id].push(sender);
                }

            }
            //Iterate over the peers who want chunks from the current origin
            //Buffer the chunks for those peers
            if (this.forwarding[origin]) {
                let peerList = this.forwarding[origin];
                for (let peerIndex = 0; peerIndex < peerList.length; peerIndex++) {
                    const peer = peerList[peerIndex];
                    if (this.pending.indexOf(peer) !== -1) {
                        //Add peers to front rather than back
                        this.pending[peer].unshift(chunkNumber);
                    } else {
                        this.pending[peer] = [];
                        this.pending[peer].unshift(chunkNumber);
                    }
                }
            }
            //send chunks in burst mode to the current neighbour
            if (this.neighbour in this.pending) {
                let peerList = this.pending[this.neighbour];
                //Delete pending chunks while iterating in reverse
                for (let peerIndex = peerList.length - 1; peerIndex >= 0; peerIndex--) {
                    this.sendChunk(peerList[peerIndex], this.neighbour);
                    //Have to remove the chunkNumber from pending array
                    peerList.remove(peerList[peerIndex]);
                    if (this.neighbour in this.debt) {
                        //Selfish peer can't be our neighbour
                        //Delete entry for all source origin peers
                        this.debt[this.neighbour] += 1
                        if (this.debt[this.neighbour] > Peer_DBS.MAX_CHUNK_DEBT) {
                            delete this.debt[this.neighbour];
                            for (let peer in this.forwarding) {
                                const neighbourIndex = peer.indexOf(this.neighbour)
                                if (neighbourIndex != -1) {
                                    delete peer[this.neighbour];
                                }
                            }
                        }
                    }
                    //
                    else {
                        this.debt[this.neighbour] = 1;
                    }
                }
            }
            //update neighbour in a round roubin fashion
            if (this.neighbour in this.pending) {
                const neighbourIndex = Object.keys(this.pending).indexOf(this.neighbour);
                const nextIndex = (neighbourIndex + 1) % (this.pending.length);
                this.neighbour = Object.keys(this.pending)[nextIndex];
                this.neighbour = (this.neighbour + 1) % (this.pending.length);
            }

        }
        this.playChunk();
    }
   
    sendChunk(message, peer) {
        try {
            this.peerChannel[peer][1].send(JSON.stringify(message));
        } catch {
            console.log(peer + 'not in the team');
        }
    }
    
    // request to remove entry of source origin of chunk from forwarding table of peer
    // Done when peer has alternative peers to provide chunks from same origin
    pruneOrigin(chunkNumber, peer) {
        const msg = {
            controlMessage: Common.PRUNE,
            chunkNum: chunkNumber
        }
        //add logic for hello message
        this.sendControlMessage(peer, message);
    }
    
    //Initiate starting message to existing peer of team
    sayHello(peer) {
        const message = {
            controlMessage: Common.HELLO
        }
        console.log(peer + 'bahn');
        //add logic for splitter seperately
        this.sendControlMessage(peer, message);
    }
    
    sayGoodbye(peer) {
        const message = {
            controlMessage: Common.GOODBYE
        }
        this.sendControlMessage(peer, message);
    }
    
    sayGoodbyeToTeam() {
        for (let peerIndex = 0; peerIndex < peerList.length; peerIndex++) {
            this.sayGoodbye(peerList[peerIndex]);
        }
    }
    
    //explicit request to a peer when chunk to play isn't present
    requestChunk(chunkNumber, peer) {
        const msg = {
            controlMessage: Common.REQUEST,
            chunkNum: chunkNumber
        }
        this.sendControlMessage(peer, message);
    }
    
    //Peers send control messages to other peer over unreliable channel during their lifetime
    sendControlMessage(message, peer) {
        try {
            this.peerChannel[peer][1].send(JSON.stringify(message));
        } catch {
            console.log(peer + 'might have left');
        }
    }
    
    initBuffer() {
        //Inititalise the buffer with sentinal values
        const defaultChunk = [-1, "Empty", undefined];
        for (let index = 0; index < this.bufferSize.length; index++) {
            this.chunks.push(defaultChunk);
        }
    }
    
    //called every time after a recieved chunk has been processed
    playChunk() {
        const chunk = this.chunks[this.chunkToPlay % this.bufferSize][0];
        if (chunk[1] != -1) {
            this.played += 1;
            this.chunkToPlay = (this.chunkToPlay + 1) % COMMON.MAX_CHUNK_NUMBER;
        } else {
            //chunk not available to play, make explicit request
            this.losses += 1;
            try {
                //Request to neighbout having minimum debt
                const goodNeigbour = Object.keys(this.debt).reduce((first, second) => this.debt[first] > this.debt[second] ? first : second);
                this.requestChunk(this.chunkToPlay, goodNeigbour);
            } catch (e) {
                if (this.neighbour) {
                    this.requestChunk(this.chunkToPlay, this.neighbour);
                }
            }
        }
        this.consumedChunks += 1;
    }
    
    addPeer(peer) {
        this.peerList.push[peer];
    }
}
