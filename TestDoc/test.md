##### Explicit Splitter calls:

```javascript
let counter = 0;
let splitter = new SplitterDBS();
splitter.preinitialise();
// Simulate stream behaviour using timeout
let timer = setInterval(function () {
   splitter.receiveChunk("A");
   if (counter >= 50) {
       clearInterval(timer);
   }    
   counter++;
}, 500);

```

##### Explicit Peer calls:

```javascript
//current identifier an unicode character
let peer = new PeerDBS("P");
peer.preintialise();
peer.connectToSplitter();

```

##### Signalling Server usage:

```javascript

//After moving to current directory
node ./server.js

```
As of now running script(peer/splitter) in chrome tabs while directly including *Common.js*. Module system to be implemented.
### Splitter: 

#### preinitialise()

Splitter registers itself to the signalling server and receives signalling messages over websocket.

#### handleSignallingMessage(message)

Establishes a RTCPeerConnection by exchanging and setting the Ice candidates and SDP between splitter and peer.

#### setUpChannelHandlers(currentPeer,channelType)

Listens for messsages over TCP and UDP like channels and delegates work to other functions depending upon the message on a given channel

#### handlePeerArrival(message,peer)

When remote peer wants to join the team,team information(buffer size/list of current peers) is sent to it over reliable channel.

#### updateState()

Once chunk is successfully sent,it updates the current peer in round-roubin fashion and also the round if it complete.

#### moderateTheTeam(message,sender)
Processes leaving peer messages and lost chunks

#### processGoodBye(peer)
When received goodbye message add peers to outgoingList for next round

#### processLostMessage(chunkNumber,currentPeer)
To find the source origin peer to which the lost chunks were delegated

#### removeOutgoingPeers()
After each round, the peers who wanted to leave the team are removed.

#### incrementUnsupportivePeers(peer)
Total losses are updated for the origin peer once source of lost chunk is detected.

#### resetCounter()
Losses array for peers are updated at regular intervals

#### sendChunk(chunk,peer)
Sends chunk to the peers over unreliable channel in a round robin fashion

#### receiveChunk(chunk)
Simulates single letter chunks

### Peer:

#### connectToSplitter()
Initiates signalling with the splitter.

####initiateConnection(isInitiator,peer)
Existing Peers act as active signallers to new peers and to the splitter.Active initiators create data channels while passive initiators register for ondatachannel events for other peers.

#### setUpChannel(peer,type)
OnMessage and onOpen handlers are registered.Depending upon the current peer/splitter and type of channel different function is called

#### receiveTeamInformation(message)
Peers Receive and check the type of information about team to update its own properties for the team.

#### handleControlMessage(message,sender)
When other peers want some explicit action from the peer, each control message is processes differently to appropriate request.

#### handleChunk(message,sender)
If message is an actual chunk the peer processes and stores the chunk in buffer.Depending upon the sender ,its state in forwarding and pending table and the current neighbour appropriate action is taken.

#### playChunk()
Simulates playing the current chunk.If the chunk to be played is not present a explicit request is made.

#### pruneOrigin(chunkNumber,peer)
To avoid receiving duplicate chunk from a given source origin by sending control message.

#### requestChunk(chunkNumber,peer)
When the current chunk to played is not present in the buffer,the current peer requests it from reliable neigbours.

#### sayHello(peer)
New peers of the team send hello messages to the current team members.

#### initBuffer()
Initialises buffer with default chunks, which are then replaced by actual chunks.
