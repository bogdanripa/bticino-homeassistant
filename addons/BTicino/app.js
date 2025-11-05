var net = require('net');
var fs = require('fs');
const express = require('express');
const request = require('request');
var bodyParser = require('body-parser');
var pClient;

var app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

var lastSentMessage = {};
var lastLog = (new Date()).getTime();
function log(msg) {
        msg = (new Date()).toLocaleTimeString() + " " + msg;
        console.log(msg);
        //fs.appendFileSync('/data/bticino.log', (new Date()).toLocaleDateString() + ' ' + msg);
        lastLog = (new Date()).getTime();
}

function restartOnSilence() {
        var currentLog = (new Date()).getTime();
        if (currentLog - lastLog > 1000*60*60*2) {
                // one hour of silence
                log("So quiet here... rebooting.");
                process.exit();
        }
}
setInterval(restartOnSilence, 10000); //check every 10 seconds

const settingsFile = "/data/bticino-settings.json";
//const settingsFile = "./settings.json";
if (!fs.existsSync(settingsFile)) {
        fs.copyFileSync('./settings.template.json', settingsFile);
        log("Init settings file");
}
var settings = require(settingsFile);
settings.haToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJhMzdmZDY3YjM0ZDg0MjUxYjRiZGZkNTU4MmRjZGM4MyIsImlhdCI6MTY5MTQyNjY0OSwiZXhwIjoyMDA2Nzg2NjQ5fQ.oghtXVZcJh6avgz1ThDQImDoca8bV9CCrd54SbQIMLc';

function cacheSettings() {
        var json = JSON.stringify(settings, null, '\t');
        fs.writeFileSync(settingsFile, json);
}

var connected = false;

var sendingCommand = false;
function bticinoConnect(what, id, level) {
        if (!sendingCommand) {
                bticinoConnectDelayed(0, what, id, level);
        } else {
                setTimeout(() => bticinoConnect(what, id, level), 500);
        }
}

var monitorlessCommands = 0;
function bticinoConnectDelayed(monitor, what, id, level) {
        lastSentMessage[what + "_" + id] = (new Date()).getTime();
        //log(monitor + ' Init');
        if (!monitor) sendingCommand = true;
        var messages =[];
        var rawData = '';
        var status = 0;

        if(monitorlessCommands++>10) {
                log("10 commands with no moitor. Exittng.");
                process.exit();
        }

        function openwebnetAnswer(pass,nonce) {
                var _0x9148=["\x30","\x31","\x32","\x33","\x34","\x35","\x36","\x37","\x38","\x39"];var _0xba8b=[_0x9148[0],_0x9148[1],_0x9148[2],_0x9148[3],_0x9148[4],_0x9148[5],_0x9148[6],_0x9148[7],_0x9148[8],_0x9148[9]];var flag=true;var num1=0x0;var num2=0x0;var password=parseInt(pass,10);for(var c in nonce){c= nonce[c];if(c!= _0xba8b[0]){if(flag){num2= password};flag= false};switch(c){case _0xba8b[1]:num1= num2& 0xFFFFFF80;num1= num1>>> 7;num2= num2<< 25;num1= num1+ num2;break;case _0xba8b[2]:num1= num2& 0xFFFFFFF0;num1= num1>>> 4;num2= num2<< 28;num1= num1+ num2;break;case _0xba8b[3]:num1= num2& 0xFFFFFFF8;num1= num1>>> 3;num2= num2<< 29;num1= num1+ num2;break;case _0xba8b[4]:num1= num2<< 1;num2= num2>>> 31;num1= num1+ num2;break;case _0xba8b[5]:num1= num2<< 5;num2= num2>>> 27;num1= num1+ num2;break;case _0xba8b[6]:num1= num2<< 12;num2= num2>>> 20;num1= num1+ num2;break;case _0xba8b[7]:num1= num2& 0x0000FF00;num1= num1+ ((num2& 0x000000FF)<< 24);num1= num1+ ((num2& 0x00FF0000)>>> 16);num2= (num2& 0xFF000000)>>> 8;num1= num1+ num2;break;case _0xba8b[8]:num1= num2& 0x0000FFFF;num1= num1<< 16;num1= num1+ (num2>>> 24);num2= num2& 0x00FF0000;num2= num2>>> 8;num1= num1+ num2;break;case _0xba8b[9]:num1=  ~num2;break;case _0xba8b[0]:num1= num2;break};num2= num1};return (num1>>> 0).toString();
        }

        function startMonitor() {
                send('99*' + (monitor?'1':'0'));
        }

        function authenticate(key) {
                send('#' + openwebnetAnswer(settings.gwPwd, key));
        }

        function updateHelper(id, level, type) {
                log("External update - device " + id + " ("+type+") set to " + level);
                let url = `http://homeassistant.local:8123/api/services/`;
                let data = {};

                if (type == 'shutter') {
                        data.entity_id = 'cover.cover' + id;
                        if (level == 0)
                                url += 'cover/close_cover'
                        else if (level == 100)
                                url += 'cover/open_cover'
                        else {
                                url += 'cover/set_cover_position';
                                data.position = level
                        }
                } else {
                        data.entity_id = 'light.light' + id;
                        if (level == 0)
                                url += 'light/turn_off';
                        else
                                url += 'light/turn_on';
                }

                if (type == 'dimmer' && level != 0) {
                        var brightness = parseInt(level)*25;
                        if (brightness == 250) brightness = 255;
                        data.brightness = brightness;
                }

                const headers = {
                        Authorization: `Bearer ${settings.haToken}`,
                };

                request({
                        method: "POST",
                        url: url,
                        headers: headers,
                        body: JSON.stringify(data)
                }, function(err, res2, body) {
                        if (err)
                                log(monitor + ' ' + err);
                });
        }

        function lightStatusUpdate(id, level) {
                if (!settings.lights[id]) {
                        settings.lights[id] = {
                                name: 'Light ' + (Object.keys(settings.lights).length + 1),
                                type: 'switch'
                        };
                        cacheSettings();
                }

                if (settings.lights[id].type == 'switch' && level > 1) settings.lights[id].type = 'dimmer';

                if (lastSentMessage[settings.lights[id].type + "_" + id] && (new Date()).getTime() - lastSentMessage[settings.lights[id].type + "_" + id] < 5000 ) {
                        log(monitor + " Ignoring status update for " + id);
                        return;
                }

                log(monitor + " Light status update (" + settings.lights[id].type + "): " + settings.lights[id].name + " set to " + level);
                if (settings.lights[id].level != level) {
                        settings.lights[id].level = level;
                        updateHelper(id.replace(/#.*$/, ''), level, settings.lights[id].type);
                        cacheSettings();
                }
        }

        function shutterStatusUpdate(id, level) {
                log(monitor + " Shutter status update: " + id + " set to " + level);
                if (!settings.shutters[id]) {
                        settings.shutters[id] = {
                                name: 'Shutter ' + (Object.keys(settings.shutters).length + 1),
                                type: 'shutter',
                                level: -1
                        };
                        cacheSettings();
                }

                if (lastSentMessage["shutter_" + id] && (new Date()).getTime() - lastSentMessage["shutter_" + id] < 10000 ) {
                        log(monitor + " Ignoring status update for " + id);
                        return;
                }

                switch(level) {
                        case 1:
                                level = 100;
                                break;
                        case 2:
                                level = 0;
                                break;
                        case 0:
                                if (settings.shutters[id].level == 0 || settings.shutters[id].level == 100) {
                                        level = 50;
                                } else {
                                        level = settings.shutters[id].level;
                                }
                }

                if (level == 0 || level == 100) {
                        if (settings.shutters[id].level != level) {
                                settings.shutters[id].level = level;
                                updateHelper(id.replace(/#.*$/, ''), level, 'shutter');
                                cacheSettings();
                        }
                }
        }

        function send(message) {
                //log(monitor + ' S: ('+status+')' + message);
                client.write('*' + message + '##');
        }

        function received(message) {
                //log(monitor + " R: ("+status+")" + message);
        }

        function processMessages() {
                var message;
                var matches;
                while (message = messages.shift()) {
                        if (message == '#*1' && status == 0) {
                                status = 1;
                                startMonitor();
                        } else if ((matches = message.match(/^#(\d+)$/)) && status == 1) {
                                status = 2;
                                authenticate(matches[1]);
                        } else if ((matches = message.match(/^1\*(\d+)\*([\d#]+)$/)) && status == 2) {
                                lightStatusUpdate(matches[2], matches[1]);
                        } else if ((matches = message.match(/^2\*(\d+)\*([\d#]+)$/)) && status == 2) {
                                shutterStatusUpdate(matches[2], parseInt(matches[1]));
                        } else if (message == '#*1' && status == 2){
                                if (!monitor) {
                                        // execure command
                                        status = 3;
                                        switch(what) {
                                                case 'light':
                                                        send('1*' + level + '*' + id);
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
                                                        send('2*' + bLevel + '*' + id);
                                                        break;
                                        }
                                } else {
                                        connected = true;
                                }
                        } else if (message == '#*1' && status == 3){
                                if (!monitor) {
                                        // disconnect
                                        //log(monitor + ' Destroy');
                                        client.destroy();
                                }
                        } else {
                                received(message);
                                if (!monitor) {
                                        // disconnect
                                        //log(monitor + ' Destroy');
                                        client.destroy();
                                }
                        }
                }
        }

        function processRawData() {
                var idx;
                while(true) {
                        idx = rawData.indexOf('##');
                        if (idx == -1) {
                                break;
                        }
                        var message = rawData.substring(1,idx);
                        messages.push(message);
                        rawData = rawData.substring(idx+2);
                }
                processMessages();
        }

        function monitorIsAlive() {
                monitorlessCommands = 0;
        }

        client = new net.Socket();

        client.on('error', function(err) {
                log(monitor + ' ' + err);
        });

        client.on('data', function(data) {
                rawData += data;
                processRawData();
                if (monitor) monitorIsAlive();
        });

        client.on('close', function() {
                //log(monitor + ' Connection closed');
                if (!monitor) sendingCommand = false;
                if (monitor)
                        process.exit();
        });

        client.connect(settings.gwPort, settings.gwIP, function() {
                //log(monitor + ' Connected');
        });

        if (monitor) pClient = client;
}

function lightAction(level, light) {

        if (settings.lights[light].type == 'dimmer' && level == 1) level = 2;

        if (settings.lights[light].level != level) {
                log("Setting " + settings.lights[light].name +  " light level to " + level);
                settings.lights[light].level = level;
                bticinoConnect('light', light, level);
                cacheSettings();
        }
}

function setShutterPosition(shutter, level) {
        if (settings.shutters[shutter].level != level) {
                if (level > 0 && level < 5) level = 0;
                log("Setting " + settings.shutters[shutter].name + " shutter level to " + level);
                var oldLevel = settings.shutters[shutter].level;
                settings.shutters[shutter].level = level;
                cacheSettings();
                switch(level) {
                        case 0:
                        case 100:
                        case -1:
                                bticinoConnect('shutter', shutter, level);
                                break;
                        default:
                                // partial
                                log("Going from " + oldLevel + " to " + level)
                                if (oldLevel > level) {
                                        // open a bit
                                        bticinoConnect('shutter', shutter, 0);
                                        var timeOut = ((oldLevel - level)/100*settings.shutterCycleSeconds*1000);
                                        setTimeout(function() {
                                                bticinoConnect('shutter', shutter, level);
                                                log("Done setting " + settings.shutters[shutter].name + " shutter level to " + level);
                                        }, timeOut);
                                } else {
                                        // close a bit
                                        bticinoConnect('shutter', shutter, 100);
                                        var timeOut = ((level - oldLevel)/100*settings.shutterCycleSeconds*1000);
                                        setTimeout(function() {
                                                bticinoConnect('shutter', shutter, level);
                                                log("Done setting " + settings.shutters[shutter].name + " shutter level to " + level);
                                        }, timeOut);
                                }
                }
        }
}

bticinoConnectDelayed(1);

app.get('/', function(req, res) {
        res.send('<form method="POST"><h1>BTicino MyHome Play Login</h1><div>E-mail:<input type="text" name="email"/></div><div>Password:<input type="password" name="pwd"/></div><input type="submit"/></form>');
});

app.get('/setup/plants/:plantId', function(req, res) {
        request({
                method: "GET",
                headers: {'Content-Type': 'application/json', auth_token: req.query.auth_token},
                url: "https://www.myhomeweb.com/mhp/plants/" + req.params.plantId + "/mhplaygw"
        }, function(err, res2, body) {
                try {
                        body = JSON.parse(body);
                }catch(e) {
                        log(err);
                        log(body);
                        res.send("Error...");
                        return;
                }
                body.forEach(function(plant) {
                        settings.gwPwd = plant.PswOpen;
                        cacheSettings();
                        res.send("All good!");
                });
        });
});

function getPlants(auth_token, res) {
        request({
                method: "GET",
                headers: {'Content-Type': 'application/json', auth_token: auth_token},
                url: "https://www.myhomeweb.com/mhp/plants"
        }, function(err, res2, body) {
                try {
                        body = JSON.parse(body);
                }catch(e) {
                        body = {};
                }
                var txt = "<h1>Select a location:</h1><ul>";
                body.forEach(function(plant) {
                        if (plant.Enabled == 1) {
                                txt += '<li><a href="/setup/plants/' + plant.PlantId + '?auth_token=' + encodeURIComponent(auth_token) + '">'+plant.PlantName+'</a></li>';
                        }
                });
                txt += "</ul>";

                res.send(txt);
        });
}

app.post('/', function(req, res) {
        request({
                        method: "POST",
                        url: "https://www.myhomeweb.com/mhp/users/sign_in",
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({"username":req.body.email,"pwd":req.body.pwd})
                },
                function(err, res2, body) {
                        if(res2.headers.auth_token) {
                                getPlants(res2.headers.auth_token, res);
                        } else {
                                res.send("Login Failed...");
                        }
                }
        );
});

app.post('/set', function(req, res) {
        var success = false;

        if (req.body && req.body.ip) {
                settings.gwIP = req.body.ip;
                success = true;
        }

        if (req.body && req.body.port) {
                settings.gwPort = req.body.port;
                success = true;
        }

        if (req.body && req.body.password) {
                settings.gwPwd = req.body.password;
                success = true;
        }

        if (success) {
                res.sendStatus(200);
        } else {
                res.sendStatus(404);
        }

});

app.get('/lights/', function(req, res) {
        log("GET /lights/");
        if (settings.lights) {
                res.setHeader('Content-Type', 'application/json');
                res.send(JSON.stringify(settings.lights, null, '\t'));
        } else {
                res.sendStatus(404);
        }
});

app.get('/shutters/', function(req, res) {
        log("GET /shutters/");
        if (settings.shutters) {
                res.setHeader('Content-Type', 'application/json');
                res.send(JSON.stringify(settings.shutters, null, '\t'));
        } else {
                res.sendStatus(404);
        }
});

app.get('/lights/:light', function(req, res) {
        log("GET /lights/" + req.params.light);
        if (settings.lights[req.params.light]) {
                res.setHeader('Content-Type', 'application/json');
                res.send(JSON.stringify(settings.lights[req.params.light], null, '\t'));
        } else {
                res.sendStatus(404);
        }
});

app.get('/shutters/:shutter', function(req, res) {
        log("GET /shutters/" + req.params.shutter);
        if (settings.shutters[req.params.shutter]) {
                res.setHeader('Content-Type', 'application/json');
                res.send(JSON.stringify(settings.shutters[req.params.shutter], null, '\t'));
        } else {
                res.sendStatus(404);
        }
});

app.post('/lights/:light', function(req, res) {
        log("POST /lights/" + req.params.light + " " + JSON.stringify(req.body));
        if (settings.lights[req.params.light]) {
                var success = false;
                var level = req.body.level;

                if (req.body.brightness !== undefined) {
                        level = parseInt(req.body.brightness/25);
                }

                if (level !== undefined) {
                        lightAction(parseInt(level), req.params.light);
                        success = true;
                }

                if (req.body && req.body.name) {
                        settings.lights[req.params.light].name = req.body.name;
                }

                if (success) {
                        res.sendStatus(200);
                } else {
                        res.sendStatus(500);
                }
        } else {
                res.sendStatus(404);
        }
});

app.post('/shutters/:shutter', function(req, res) {
        log(`POST /shutters/${req.params.shutter} body: ${JSON.stringify(req.body)}`);
        
        const shutterId = req.params.shutter;
        const shutter = settings.shutters[shutterId];
        if (!shutter) return res.sendStatus(404);

        var success = false;

        // Handle a "stop" action from Home Assistant / Apple Home
        if (req.body && req.body.action === 'stop') {
                log(`Stopping shutter ${shutterId}`);
                bticinoConnect('shutter', shutterId, 50);
                success = true;
        }

        // Handle a "open" action from Home Assistant / Apple Home
        if (req.body && req.body.action === 'open') {
                log(`Opening shutter ${shutterId}`);
                setShutterPosition(shutterId, 100);
                success = true;
        }

        // Handle a "close" action from Home Assistant / Apple Home
        if (req.body && req.body.action === 'close') {
                log(`Closing shutter ${shutterId}`);
                setShutterPosition(shutterId, 0);
                success = true;
        }

        // Handle standard "level" changes (open, close, or partial)
        if (req.body && req.body.position !== undefined) {
                setShutterPosition(shutterId, parseInt(req.body.position));
                success = true;
        }

        // Optional: allow renaming via API
        if (req.body && req.body.name) {
                shutter.name = req.body.name;
                cacheSettings();
                success = true;
        }

        res.sendStatus(success ? 200 : 500);
});

app.post('/connect', function(req, res) {
        if (pClient) {
                pClient.destroy();
        }
        bticinoConnectDelayed(1);
        if (pClient) {
                res.sendStatus(200);
        } else {
                res.sendStatus(404);
        }
});

app.get('/status', function(req, res) {
        res.send(connected?"Connected":"Disconnected");
});

app.get('/disconnect', function(req, res) {
        if (pClient) {
                pClient.destroy();
                res.sendStatus(200);
        } else {
                res.sendStatus(404);
        }
});

function refreshWeather() {
        if (timer2 > 0) {
                timer2--;
                return;
        }
        log("Refreshing Weather");
        var url = 'https://api.openweathermap.org/data/2.5/weather?lat='+settings.openWeather.lat+'&lon='+settings.openWeather.lon+'&appid=' + settings.openWeather.apiKey;
        request(url, { json: true }, function(err, res, body) {
                if (err) {
                        return log(err);
                }
                var shouldClose = false;
                if (!body.weather) {
                        log(JSON.stringify(body));
                        return;
                }
                body.weather.forEach( function(wo) {
                        if (shouldClose) {
                                return;
                        }
                        switch(parseInt(wo.id/100)) {
                                case 2:
                                case 3:
                                case 5:
                                case 6:
                                        shouldClose = true;
                        }

                        if (wo.id % 10 == 0) {
                                // light
                                if (body.wind.speed < 10) {
                                        // low speed
                                        shouldClose = false;
                                }
                        } else if (wo.id % 10 == 1) {
                                // normal
                                if (body.wind.speed < 5) {
                                        // low speed
                                        shouldClose = false;
                                }
                        }
                });


                if (shouldClose) {
                        timer2 = 6*60/5;
                        Object.keys(settings.shutters).forEach(function(shutter) {
                                setShutterPosition(shutter, 0);
                        });
                }
        });
}

//var timer2 = 0;
//setInterval(refreshWeather, 1000*60*5); // every 5 minutes
//refreshWeather();

app.listen(8080, "0.0.0.0", function() {log('Listening on port 8080!')});
