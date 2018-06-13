var WebSocketServer = require('websocket').server;
var http = require('http');

var server = http.createServer(function(request, response) {

});
server.listen(9033, function() { 
  console.log('Listening on port 9033');
});

//create the server
wsServer = new WebSocketServer({
  httpServer: server
});
//List of websocket connections with the Team
var teamMembers = [];
var splitter;
wsServer.on('request', function(request) {
  var connection = request.accept(null, request.origin);
  console.log(request);
  // all messages from users here.     
  connection.on('message', function(message) {  
       //console.log(message.utf8Data);      
       var msg = JSON.parse(message.utf8Data);
       console.log(' parsed message ' + msg);
       //Register peer or splitter for the team
       if(msg.addSplitter) {
           console.log('new addition');
           //store websocket connection
           teamMembers[msg.splitterId] = connection;
       }
       else if(msg.addPeer) {  
           console.log('new addition of peer');
           teamMembers[msg.peerId] = connection;
       }
       //Signalling message to be relayed to the receiver
       else {
         var receiver = msg.receiverId;
         console.log(receiver);
         console.log(teamMembers[receiver])
         //transmit over receiver's socket
         teamMembers[receiver].sendUTF(JSON.stringify(msg));
       }
  });

  connection.on('close', function(connection) {
    // close user connection
    console.log(connection + 'has closed');
  });
});
