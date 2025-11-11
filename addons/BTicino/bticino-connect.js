var net = require('net');

//create a BTicino connection class
class BTicinoConnection {
    status = 'disconnected';
    constructor(ip, port, password, monitoring, log, updateStatus) {
        this.ip = ip;
        this.port = port;
        this.password = password;
        this.log = log;
        this.updateStatus = updateStatus;

        this.rawData = "";
        this.lastMessage = '';
        this.messages = [];
        this.messagesToSend = [];
        this.lastMessageTimestamp = undefined;
        this.monitoring = monitoring;
        this.client = undefined;
        this.#connect();
        if (!monitoring)
            setInterval(() => this.#flushMessage(), 1000);
    }

    #connect() {
        this.status = 'connecting';
        this.client = new net.Socket();

        this.client.on('error', (err) => {
                this.log("Socket Error: " + err);
                this.status = 'disconnected';
                this.client = undefined;
        });

        this.client.on('data', (data) => {
                this.rawData += data;
                this.#processRawData();
        });

        this.client.on('close', () => {
            if (!this.monitoring) {
                    this.log('Hub connection closed, resetting connection...');
                    this.status = 'disconnected';
                    this.client = undefined;
                } else {
                    this.log('Hub connection closed, restarting...');
                    process.exit();
                }
        });

        this.client.connect(this.port, this.ip, () => {
            this.log("Connected to BTicino Hub");
            if (this.lastMessage) {
                this.log('Resending last message: ' + this.lastMessage);
                this.messagesToSend.unshift(this.lastMessage);
                this.lastMessage = '';
            }
            this.status = 'connected';
        });
    }

    #startMonitor() {
        if (this.monitoring) this.log("Start hub monitoring")
        var message = '99*' + (this.monitoring?'1':'0');
        this.log('Send:     ' + message);
        this.client.write('*' + message + '##');
    }

    #openwebnetAnswer(pass, nonce) {
        var _0x9148=["\x30","\x31","\x32","\x33","\x34","\x35","\x36","\x37","\x38","\x39"];
        var _0xba8b=[_0x9148[0],_0x9148[1],_0x9148[2],_0x9148[3],_0x9148[4],_0x9148[5],_0x9148[6],_0x9148[7],_0x9148[8],_0x9148[9]];
        var flag=true;
        var num1=0x0;
        var num2=0x0;
        var password=parseInt(pass,10);
        for(var c in nonce){
            c= nonce[c];
            if(c!= _0xba8b[0]){
                if(flag){
                    num2= password
                };
                flag= false
            };
            switch(c){
                case _0xba8b[1]:
                    num1= num2& 0xFFFFFF80;
                    num1= num1>>> 7;
                    num2= num2<< 25;
                    num1= num1+ num2;
                    break;
                case _0xba8b[2]:
                    num1= num2& 0xFFFFFFF0;
                    num1= num1>>> 4;
                    num2= num2<< 28;
                    num1= num1+ num2;
                    break;
                case _0xba8b[3]:
                    num1= num2& 0xFFFFFFF8;
                    num1= num1>>> 3;
                    num2= num2<< 29;
                    num1= num1+ num2;
                    break;
                case _0xba8b[4]:
                    num1= num2<< 1;
                    num2= num2>>> 31;
                    num1= num1+ num2;
                    break;
                case _0xba8b[5]:
                    num1= num2<< 5;
                    num2= num2>>> 27;
                    num1= num1+ num2;
                    break;
                case _0xba8b[6]:
                    num1= num2<< 12;
                    num2= num2>>> 20;
                    num1= num1+ num2;
                    break;
                case _0xba8b[7]:
                    num1= num2& 0x0000FF00;
                    num1= num1+ ((num2& 0x000000FF)<< 24);
                    num1= num1+ ((num2& 0x00FF0000)>>> 16);
                    num2= (num2& 0xFF000000)>>> 8;
                    num1= num1+ num2;
                    break;
                case _0xba8b[8]:
                    num1= num2& 0x0000FFFF;
                    num1= num1<< 16;
                    num1= num1+ (num2>>> 24);
                    num2= num2& 0x00FF0000;
                    num2= num2>>> 8;
                    num1= num1+ num2;
                    break;
                case _0xba8b[9]:
                    num1=  ~num2;
                    break;
                case _0xba8b[0]:
                    num1= num2;
                    break
            };
            num2= num1
        };
        return (num1>>> 0).toString();
    }

    #authenticate(key) {
        this.log("Sending hub authentication request");
        var message = '#' + this.#openwebnetAnswer(this.password, key);
        this.log('Send:     ' + message);
        this.client.write('*' + message + '##');
    }

    #processRawData() {
        var idx;
        while(true) {
                idx = this.rawData.indexOf('##');
                if (idx == -1) {
                        break;
                }
                var message = this.rawData.substring(1,idx);
                this.messages.push(message);
                this.rawData = this.rawData.substring(idx+2);
        }
        if (this.messages.length > 0) this.#processMessages();
    }

    #processMessages() {
        var message;
        var matches;
        while (message = this.messages.shift()) {
            this.lastMessageTimestamp = (new Date()).getTime();
            if (message == '#*1' && this.status == 'connected') {
                this.status = 'handshaking';
                this.log("Received: " + message + ", initializing handshake.");
                this.#startMonitor();
            } else if ((matches = message.match(/^#(\d+)$/)) && this.status == 'handshaking') {
                this.status = 'authenticated';
                this.log("Received: " + message + ", authenticating.");
                this.#authenticate(matches[1]);
            } else if ((matches = message.match(/^1\*(\d+)\*([\d#]+)$/)) && this.status == 'authenticated') {
                this.log("Received: " + message + " - light status information.");
                this.updateStatus('light', matches[2], matches[1]);
            } else if ((matches = message.match(/^2\*(\d+)\*([\d#]+)$/)) && this.status == 'authenticated') {
                this.log("Received: " + message + " - shutter status information.");
                this.updateStatus('shutter', matches[2], parseInt(matches[1]));
            } else if (message == '#*1' && this.status == 'authenticated') {
                // athenticated command sent confirmation, do nothing
                this.log("Received: Authentication confirmation.");
            } else if (message == '#*1' && this.status == 'sending') {
                // command sent confirmation
                this.lastMessage = '';
                this.log("Received: Message sent confirmation.");
                this.status = 'authenticated';
            } else {
                this.log("Received unknown message: " + message + " while " + this.status + ".");
            }
        }
    }

    #flushMessage() {
        if (this.messagesToSend.length == 0) return;
        if (this.status == 'sending') {
            if ((new Date()).getTime() - this.lastMessageTimestamp > 5000) {
                this.log("No message received in the last 5 seconds, restarting connection.");
                this.client.destroy();
            }
            return; // already sending, push back
        }
        if (this.status == 'authenticated') {
            var message = this.messagesToSend.shift()
            this.status = 'sending';
            this.lastMessage = message;
            this.log('Sending:  ' + message);
            this.client.write('*' + message + '##');
        }
        if (this.status == 'disconnected') {
            this.log("Connection lost, reconnecting.");
            this.#connect();
        }
    }

    #send(message) {
        this.messagesToSend.push(message);
        // only flush if there is only one message to send
        if (this.messagesToSend.length == 1) this.#flushMessage();
    }

    sendCommand(what, level, id) {
        // execure command
        switch(what) {
                case 'light':
                        this.#send('1*' + level + '*' + id);
                        break;
                case 'shutter':
                        var bLevel;
                        switch(level) {
                                case 0:
                                        bLevel = 2;
                                        break;
                                case 100:
                                        bLevel = 1;
                                        break;
                                default:
                                        bLevel = 0;
                        }
                        this.#send('2*' + bLevel + '*' + id);
                        break;
        }
    }
}

module.exports = { BTicinoConnection };