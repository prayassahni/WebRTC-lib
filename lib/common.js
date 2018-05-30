
export default class Common {
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
			iceServers: [{ url: 'stun:stun.l.google.com:19302' }, { url: ‘stun:stun2.l.google.com:19302’ }];		
		}
	}
}
