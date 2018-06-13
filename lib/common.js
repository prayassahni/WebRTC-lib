class Common {
  static get UDP_CONFIG() {
     return {
            //Subject to change
            maxPacketLifeTime: 2000,
            maxRetransmits: 3,
            ordered: false,
            id: 1
     }
  }
  static get TCP_CONFIG() {
     return {
       ordered: true,
       id: 0
     }
  }
  static get URL() {
     return 'ws://localhost:9033';
  }
  static get MAX_CHUNK_NUMBER () {
     return 65536;
  }
  static get COUNTER_TIMING () {
     return 1;
  }
  static get BUFFER_SIZE () {
     return 128;
  }
  static get MAX_CHUNK_LOSS () {
     return 16;
  }
  static get SERVER_CONFIG () {
     return {
       iceServers: [{ url: 'stun:stun.l.google.com:19302' }]
     }
  }   
  static get HELLO() {
     return -1;
  }
  static get GOODBYE() {
     return -2;
  }    
  static get REQUEST() {
     return -3;
  }
  static get PRUNE() {
     return -4;
  }
}
