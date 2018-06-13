
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
        this.peerConnection = {};
        this.peerChannel = {};
        this.splitterId = "S";
        this.playerALive = true; // A flag which is evaluated after playing each chunk,to check the status of player
        this.peerList = [];
        this.firstChunk = -1;
        this.bufferSize = -1;
        this.signalSever = "";
        this.currentChunk = 0; //Current chunk to be played
    }

    preinitialise() {
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
            const senderId = msg.senderId || msg.peerId;
            //existing peers initiate connection
            if(!this.peerConnection[senderId]) {
                 //Existing peer of a team recieves a request
                 this.initiateConnection(false,senderId);
            }
            if (msg.sessionDescriptionProtocol) {
                if(msg.sessionDescriptionProtocol.type == "offer")
                {   console.log("got remote description");
                    this.peerConnection[senderId].setRemoteDescription(msg.sessionDescriptionProtocol).then(() => {
                    console.log(this.peerConnection[senderId].remoteDescription);
                    return navigator.mediaDevices.getUserMedia({audio: true, video: true});
                })
                .then((stream) => {
                    return this.peerConnection[senderId].addStream(stream);
                })
                .then(() => {
                    return this.peerConnection[senderId].createAnswer();
                })
                .then((answer) => {
                    return this.peerConnection[senderId].setLocalDescription(answer);
                })
                .then(() => {
                    const sendObj = {
                         senderId: this.peerId,
                         sessionDescriptionProtocol: this.peerConnection[senderId].localDescription,
                         receiverId: senderId
                    }
                    console.dir(sendObj);
                    this.signalServer.send(JSON.stringify(sendObj));
                })
                .catch(e => {
                     console.log(e);
                });
                //this.initiateConnection(false,senderId);
            }
            else {
                 this.peerConnection[senderId].setRemoteDescription(msg.sessionDescriptionProtocol);
            }}
            //check for null candidates
            if (msg.candidate) {
                this.peerConnection[senderId].addIceCandidate(msg.candidate);
            }
       }
    }
    connectToSplitter() {
        //initiate signalling with splitter
        this.initiateConnection(true, this.splitterId);
        this.forwarding[this.peerId] = [];
    }

    //Peer act as active signallers to the splitter and existing peer when they're new to the team
    //Existing peers use it on arrival of new peer(Passive)
    //Active signallers createDatachannel and other exististing peers/splitter register handlers on them
    initiateConnection(isInitiator, currentPeer) {
        this.peerConnection[currentPeer] = new RTCPeerConnection(Common.SERVER_CONFIG);
        this.peerChannel[currentPeer] = [];
        if (isInitiator) {
            this.createDataChannel(currentPeer);
        } else {
            this.handleIncomingDataChannels(currentPeer);
        }
        //Ice candidates fired when data channel created before setting local description(Works both with chrome and firefox)
        this.peerConnection[currentPeer].onicecandidate = (event) => {
            console.log(" ice candidate " + event.candidate);
            console.dir(event.candidate);
            if(event.candidate) {
                const sendObj = {
                    "candidate": event.candidate,
                    "peerId": this.peerId,
                    "receiverId": currentPeer
                }
                this.signalServer.send(JSON.stringify(sendObj));
            }
            else {
                console.log('recieved null candidate');
            }
        };
       
        //For passive peers negotiating simultaneous causes issue
        if (isInitiator) {
            this.peerConnection[currentPeer].onnegotiationneeded = () => {
                console.log(currentPeer + ' requires negotatiotion ')
                this.peerConnection[currentPeer].createOffer()
                .then((offer) => {
                    console.log(offer);
                    this.peerConnection[currentPeer].setLocalDescription(offer);
                })
                .then(() => {
                    console.log(this.peerConnection[currentPeer].localDescription + currentPeer);
                    const sendObj = {
                        "sessionDescriptionProtocol": this.peerConnection[currentPeer].localDescription,
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
        
    }

    //Used only by new peers to establish connection with existing peers and splitter
    createDataChannel(currentPeer) {
        if (currentPeer == this.splitterId) {
            //Reliable channel only with the splitter
            this.peerChannel[currentPeer][0] = this.peerConnection[currentPeer].createDataChannel("tcpLike ", Common.TCP_CONFIG);
            this.setupChannel(currentPeer, 0);
        }
        this.peerChannel[currentPeer][1] = this.peerConnection[currentPeer].createDataChannel("udpLike ", Common.UDP_CONFIG);
        this.setupChannel(currentPeer, 1);
    }

    handleIncomingDataChannels(currentPeer) {
        console.log('passive ');
        this.peerConnection[currentPeer].ondatachannel = (event) => {
            console.log('Data channel recieved from ' + currentPeer);
            const type = event.channel.id;
            this.peerChannel[currentPeer][type] = event.channel;
            this.setupChannel(currentPeer, type);
        }
    }
    // type == 0 => reliable
    // type == 1 => unreliable
    setupChannel(currentPeer, type) {
        this.peerChannel[currentPeer][type].onopen = (event) => {
            console.log('channel to other peer is open' + '   ' +currentPeer);
            if((currentPeer!= this.splitterId) || type == 0) {
                this.sayHello(currentPeer);
            }
        }
        this.peerChannel[currentPeer][type].onmessage = (event) => {
            let msg = JSON.parse(event.data);
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
                    ///messages sent by other peers that require specific action
                    this.handleControlMessage(msg, currentPeer);
                } else {
                    this.handleChunk(msg, currentPeer);
                }
            }
        }
    }

    receiveTeamInformation(message) {
        console.log('receiving team information' + message);
        if ('peerList' in message) {
            this.peerList = message.peerList;
            let teamList = this.peerList;
            console.log('received peerlist');
            console.log(teamList.length + '  ' + 'peers in the team');
            for (let i = 0; i < teamList.length; i++) {
                //new peer act as active signallers
               // console.log(teamList[i] + 'existing peers');
                this.initiateConnection(true, teamList[i]);
                this.addPeer(teamList[i]);
                // Hello message sent when data channel with team member opens
            }
        } else if ('numPeers' in message) {
            this.totalMonitorPeers = message.numMonitors;
            this.totalPeers = message.numPeers;
        } else {
            console.dir(message);
            this.bufferSize = message.bufferSize;
            //initialise chunk in buffer
            this.initBuffer();
        }
    }

    handleControlMessage(message, sender) {
        //chunk number = 0
        //chunk = 1;
        //origin peer = 2;
        const type = message.controlMessage;
        console.dir(message);
        switch (type) {
            case Common.PRUNE:
                {
                    const origin = message.chunkNum;
                    console.log('removing forwarding entry of ' + origin + ' for ' + sender);
                    //Remove sender from forwarding table entries indexed by origin
                    if (origin in this.forwarding) {
                        const senderIndex = this.forwarding[origin].indexOf(sender);
                        if (senderIndex !== -1) {
                            this.forwarding[origin].splice(senderIndex, 1);
                        }
                    }
                    break;
                }
            case Common.GOODBYE:
                {
                    console.log(sender + 'is leaving the team');
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
                    break;
                }
            case Common.HELLO:
                {
                    console.log('new peer' + sender + 'said hello');
                    const senderIndex = this.forwarding[this.peerId].indexOf(sender);
                    if (senderIndex == -1) {
                        this.forwarding[this.peerId].push(sender);
                        this.debt[sender] = 0;
                        //existing peers make the new peers as their neighbours
                        this.neighbour = sender;
                    }
                    break;
                }
            case Common.REQUEST:
                {
                    const chunkRequested = message.chunkNum;
                    //position in buffer maps to appropriate source
                    console.log(chunkRequested  + ' requested by ' + sender);
                    const origin = this.chunks[chunkRequested % this.bufferSize][2];
                    if (origin in this.forwarding) {
                        const senderIndex = this.forwarding[origin].indexOf(sender);
                        if (senderIndex == -1) {
                            this.forwarding[origin].push(sender);
                        }
                    } else {
                        if (origin) {
                            this.forwarding[origin] = [sender];
                        }
                    }
                    break;
                }
        }
    }

    //When message received is an actual chunk
    handleChunk(chunkMessage, sender) {
        console.dir(chunkMessage);
        console.log(' chunk received from ' + sender);
        const chunkNumber = chunkMessage[0];
        if(this.firstChunk == -1) {
            //Todo: buffer previous chunks of current round
            this.firstChunk = chunkNumber;
            this.chunkToPlay = this.firstChunk;
        }
        //Duplicate chunk received,ask the sending peer to remove entry from origin of the forwarding table
        if (this.chunks[chunkNumber % this.bufferSize][0] == chunkNumber) {
            this.pruneOrigin(chunkNumber, sender)
        } else {
            const chunk = chunkMessage[1];
            const origin = chunkMessage[2];
            this.chunks[chunkNumber % this.bufferSize] = chunkMessage;
            this.recievedChunks += 1;
            if (sender != this.splitterId) {
                console.dir(sender);
                if (sender in this.debt) {
                    this.debt[sender] -= 1;
                } else {
                    //Initialise debt 
                    this.debt[sender] = -1;
                }
                //The sender becomes the neigbour if no neighbour yet
                if (!this.neighbour) {
                    this.neighbour = sender;
                }
                //the reciever creates entry of it in its own forwarding table
                if (this.forwarding[this.peerId].indexOf(sender) == -1) {
                    this.forwarding[this.peerId].push(sender);
                }

            }
            //Iterate over the peers who want chunks from the current origin
            //Buffer the chunks for those peers
            if (origin in this.forwarding) {
                let peerList = this.forwarding[origin];
                for (let peerIndex = 0; peerIndex < peerList.length; peerIndex++) {
                    const peer = peerList[peerIndex];
                    if (peer in this.pending) {
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
                    peerList.splice(peerIndex,1);
                    if (this.neighbour in this.debt) {
                        //Selfish peer can't be our neighbour
                        //Delete entry for all source origin peers
                        this.debt[this.neighbour] += 1
                        if (this.debt[this.neighbour] > PeerDBS.MAX_CHUNK_DEBT) {
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
                console.log(this.neighbour + '  ' + ' was curent neighbour');
                let len = Object.keys(this.pending).length
                const neighbourIndex = Object.keys(this.pending).indexOf(this.neighbour);
                const nextIndex = (neighbourIndex + 1) % (len);
                this.neighbour = Object.keys(this.pending)[nextIndex];
               // this.neighbour = (this.neighbour + 1) % (this.pending.length); 
            }

        }
        this.playChunk();
    }

    sendChunk(chunkNumber, peer) {
        chunkNumber = chunkNumber % this.bufferSize;
        //extract the chunk from buffer
        let message = this.chunks[chunkNumber];
        try {
            this.peerChannel[peer][1].send(JSON.stringify(message));
        } catch {
            console.log(peer + 'not in the team');
        }
    }

    // request to remove entry of source origin of chunk from forwarding table of peer
    // Done when peer has alternative peers to provide chunks from same origin
    pruneOrigin(chunkNumber, peer) {
        const message = {
            controlMessage: Common.PRUNE,
            chunkNum: chunkNumber
        }
        //add logic for hello message
        this.sendControlMessage(message,peer);
    }

    //Initiate starting message to existing peer of team
    sayHello(peer) {
        const message = {
            controlMessage: Common.HELLO
        }
        //add logic for splitter seperately
        if(peer == this.splitterId) {
            const joinTeamMsg = {
                joinTeam: true
            }
            this.peerChannel[peer][0].send(JSON.stringify(joinTeamMsg));
        }
        else {
            this.sendControlMessage(message,peer);
        }
    }

    sayGoodbye(peer) {
        const message = {
            controlMessage: Common.GOODBYE
        }
        this.sendControlMessage(message,peer);
    }

    sayGoodbyeToTeam() {
        for (let peerIndex = 0; peerIndex < this.peerList.length; peerIndex++) {
            this.sayGoodbye(this.peerList[peerIndex]);
        }
    }

    //explicit request to a peer when chunk to play isn't present
    requestChunk(chunkNumber, peer) {
        const message = {
            controlMessage: Common.REQUEST,
            chunkNum: chunkNumber
        }
        this.sendControlMessage(message,peer);
    }

    //Peers send control messages to other peer over unreliable channel during their lifetime
    sendControlMessage(message, peer) {
        try {
            this.peerChannel[peer][1].send(JSON.stringify(message));
        } catch {
            console.log(peer + ' might have left ');
            console.log(message);
        }
    }

    initBuffer() {
        //Inititalise the buffer with sentinal values
        const defaultChunk = [-1, "Empty", undefined];
        for (let index = 0; index < this.bufferSize; index++) {
            this.chunks.push(defaultChunk);
        }
        console.log('buffer instantiated');
    }

    //called every time after a recieved chunk has been processed
    playChunk() {
        const chunk = this.chunks[this.chunkToPlay % this.bufferSize];
        if (chunk[0] != -1) {
            console.log(this.chunkToPlay + ' chunk is played');
            this.played += 1;
            this.chunkToPlay = (this.chunkToPlay + 1) % Common.MAX_CHUNK_NUMBER;
        } else {
            //chunk not available to play, make explicit request
            console.log(this.chunkToPlay + '  required chunk not available to be played');
            this.losses += 1;
            try {
                //Request to neighbout having minimum debt
                const goodNeigbour = Object.keys(this.debt).reduce((first, second) => this.debt[first] > this.debt[second] ? first : second);
                console.log(' request ' + this.chunkToPlay + ' from ' + goodNeigbour);
                this.requestChunk(this.chunkToPlay, goodNeigbour);
            } catch (e) {
                if (this.neighbour) {
                    console.log(this.chunkToPlay + ' could not be request from good neighbour ');
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

