var fs = require('fs');
const express = require('express');
const request = require('request');
var bodyParser = require('body-parser');
const { BTicinoConnection } = require('./bticino-connect');

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
                // two hours of silence
                log("So quiet here... rebooting.");
                process.exit();
        }
}
setInterval(restartOnSilence, 10000); //check every 10 seconds

const settingsFile = "/config/bticino-settings.json";
// const settingsFile = "./bticino-settings.json";
if (!fs.existsSync(settingsFile)) {
        fs.copyFileSync('./settings.template.json', settingsFile);
        log("Init settings file");
}
var settings = require(settingsFile);

function cacheSettings() {
        var json = JSON.stringify(settings, null, '\t');
        fs.writeFileSync(settingsFile, json);
}

pClient = new BTicinoConnection(settings.gwIP, settings.gwPort, settings.gwPwd, true, log, updateStatus);
cClient = new BTicinoConnection(settings.gwIP, settings.gwPort, settings.gwPwd, false, log);

function updateHelper(id, level, type) {
        log("Sending hub update to home assistant: " + type + " (" + id + ") was set to " + level);
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
        log("Received hub status update: "+settings.lights[id].type+" ("+id+") set to " + level);

        if (settings.lights[id].type == 'switch' && level > 1) settings.lights[id].type = 'dimmer';

        if (settings.lights[id].level == level) {
                log("Ignoring hub status update for " + settings.lights[id].type + " (" + id + "). Level was " + level);
                return;
        }
        if (lastSentMessage[settings.lights[id].type + "_" + id] && (new Date()).getTime() - lastSentMessage[settings.lights[id].type + "_" + id] < 5000 ) {
                log("Ignoring hub status update for " + settings.lights[id].type + " (" + id + "). Update came in too fast.");
                return;
        }

        settings.lights[id].level = level;
        updateHelper(id.replace(/#.*$/, ''), level, settings.lights[id].type);
        cacheSettings();
}

function shutterStatusUpdate(id, level) {
        if (!settings.shutters[id]) {
                settings.shutters[id] = {
                        name: 'Shutter ' + (Object.keys(settings.shutters).length + 1),
                        type: 'shutter',
                        level: -1
                };
                cacheSettings();
        }
        log("Received hub status update: shutter ("+id+") set to " + level);

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

        if (level != 0 && level != 100) {
                log("Ignoring hub status update for shutter (" + id + "). Level was " + level);
                return;
        }
        
        if (settings.shutters[id].level == level){
                log("Ignoring hub status update for shutter (" + id + "). Level did not change: " + level);
                return;
        }
        if (lastSentMessage["shutter_" + id] && (new Date()).getTime() - lastSentMessage["shutter_" + id] < 10000 ) {
                log("Ignoring hub status update for shutter (" + id + "). Update came in too fast.");
                return;
        }

        settings.shutters[id].level = level;
        updateHelper(id.replace(/#.*$/, ''), level, 'shutter');
        cacheSettings();
}

function updateStatus(type, id, level) {
        switch(type) {
                case 'light':
                        lightStatusUpdate(id, level);
                        break;
                case 'shutter':
                        shutterStatusUpdate(id, level);
                        break;
                default:
                        log("Unknown status update type: " + type);
                        break;
        }
}

function lightAction(level, id) {
        var what = settings.lights[id].type;
        if (what == 'dimmer' && level == 1) level = 2;
        log("Received home assistant status update: " + what + " (" + id + ") was set to " + level);

        if (settings.lights[id].level != level) {
                //log("Setting " + settings.lights[light].name +  " light level to " + level);
                settings.lights[id].level = level;
                lastSentMessage[what + "_" + id] = (new Date()).getTime();
                cClient.sendCommand('light', level, id);
                cacheSettings();
        } else {
                log("Ignoring home assistant status update for " + what + " (" + id + "). Level is already " + level);
        }
}

function setShutterPosition(id, level) {
        var what = 'shutter';
        log("Received home assistant status update: " + what + " (" + id + ") was set to " + level);
        if (settings.shutters[id].level != level) {
                if (level > 0 && level < 5) level = 0;
                //log("Setting " + settings.shutters[shutter].name + " shutter level to " + level);
                var oldLevel = settings.shutters[id].level;
                settings.shutters[id].level = level;
                cacheSettings();
                switch(level) {
                        case 0:
                        case 100:
                        case -1:
                                lastSentMessage[what + "_" + id] = (new Date()).getTime();
                                cClient.sendCommand(what, level, id);
                                break;
                        default:
                                // partial
                                //log("Going from " + oldLevel + " to " + level)
                                if (oldLevel > level) {
                                        // open a bit
                                        lastSentMessage[what + "_" + id] = (new Date()).getTime();
                                        cClient.sendCommand(what, id, 0);
                                        var timeOut = ((oldLevel - level)/100*settings.shutterCycleSeconds*1000);
                                        setTimeout(function() {
                                                lastSentMessage[what + "_" + id] = (new Date()).getTime();
                                                cClient.sendCommand(what, id, level);
                                                //log("Done setting " + settings.shutters[shutter].name + " shutter level to " + level);
                                        }, timeOut);
                                } else {
                                        // close a bit
                                        lastSentMessage[what + "_" + id] = (new Date()).getTime();
                                        cClient.sendCommand(what, id, 100);
                                        var timeOut = ((level - oldLevel)/100*settings.shutterCycleSeconds*1000);
                                        setTimeout(function() {
                                                lastSentMessage[what + "_" + id] = (new Date()).getTime();
                                                cClient.sendCommand(what, id, level);
                                                //log("Done setting " + settings.shutters[shutter].name + " shutter level to " + level);
                                        }, timeOut);
                                }
                }
        } else {
                log("Ignoring home assistant status update for " + what + " (" + id + "). Level is already " + level);
        }
}

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
        //log("GET /lights/");
        if (settings.lights) {
                res.setHeader('Content-Type', 'application/json');
                res.send(JSON.stringify(settings.lights, null, '\t'));
        } else {
                res.sendStatus(404);
        }
});

app.get('/shutters/', function(req, res) {
        //log("GET /shutters/");
        if (settings.shutters) {
                res.setHeader('Content-Type', 'application/json');
                res.send(JSON.stringify(settings.shutters, null, '\t'));
        } else {
                res.sendStatus(404);
        }
});

app.get('/lights/:light', function(req, res) {
        //log("GET /lights/" + req.params.light);
        if (settings.lights[req.params.light]) {
                res.setHeader('Content-Type', 'application/json');
                res.send(JSON.stringify(settings.lights[req.params.light], null, '\t'));
        } else {
                res.sendStatus(404);
        }
});

app.get('/shutters/:shutter', function(req, res) {
        //log("GET /shutters/" + req.params.shutter);
        if (settings.shutters[req.params.shutter]) {
                res.setHeader('Content-Type', 'application/json');
                res.send(JSON.stringify(settings.shutters[req.params.shutter], null, '\t'));
        } else {
                res.sendStatus(404);
        }
});

app.post('/lights/:light', function(req, res) {
        //log("POST /lights/" + req.params.light + " " + JSON.stringify(req.body));
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
        //log(`POST /shutters/${req.params.shutter} body: ${JSON.stringify(req.body)}`);
        
        const shutterId = req.params.shutter;
        const shutter = settings.shutters[shutterId];
        if (!shutter) return res.sendStatus(404);

        var success = false;

        // Handle a "stop" action from Home Assistant / Apple Home
        if (req.body && req.body.action === 'stop') {
                //log(`Stopping shutter ${shutterId}`);
                bticinoConnect('shutter', shutterId, 50);
                success = true;
        }

        // Handle a "open" action from Home Assistant / Apple Home
        if (req.body && req.body.action === 'open') {
                //log(`Opening shutter ${shutterId}`);
                setShutterPosition(shutterId, 100);
                success = true;
        }

        // Handle a "close" action from Home Assistant / Apple Home
        if (req.body && req.body.action === 'close') {
                //log(`Closing shutter ${shutterId}`);
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

// var levelLivingLight = 0;
// function updateLivingLight() {
//         levelLivingLight = 1 - levelLivingLight;
//         lightAction(levelLivingLight, '706247701#9');
// }

// setInterval(updateLivingLight, 5000); // every 5 seconds


app.listen(8080, "0.0.0.0", function() {log('Listening on port 8080!')});