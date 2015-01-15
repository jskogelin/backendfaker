#!/usr/bin/env node
'use strict';

var faker = require('faker'),
    fs = require('fs'),
    extend = require('node.extend'),
    express = require('express'),
    argv = require('yargs').argv,
    server = express(),
    cors = require('cors');

if (argv.h) {
    console.log([
        'usage: backend-faker [options]',
        '',
        'options:',
        '  -D       set domain for CORS',
        '  -P       set port for CORS',
        '  -p       sets the port that the faker server listens to',
        '  -d       sets a maximum delay (in milliseconds) for the server to wait before responding',
        '  -b       looks for the backend.json file in the specified path',
        '  -h       halp',
        '  -s       silent mode. No logs of requests, etc.',
        ''
    ].join('\n'));
    process.exit();
}

var isArray = function (arr) {
    return Object.prototype.toString.call(arr) === '[object Array]';
};

/**
 * Sets up a fake "backend" that intercepts calls made to paths specified in a backend.json file.
 *
 * Backend constructor.
 *
 * TODO: add support for request types other than just get
 * TODO: add a way to "save" to the server by making a PUT request
 * TODO: configure response to include headers etc.
 * TODO: code coverage...
 *
 * @param config - backend config object. Possible configs at the moment:
 *      - port(-p): sets the port that the server listens to
 *      - delay(-d): sets a maximum delay (in milliseconds) for the server to wait before responding
 *      - backendPath(-b): looks for the backend.json file in the specified path
 *
 * @constructor
 */
var BackendFaker = function (config) {
    var DEFAULT = {
        PORT: 2000,
        BACKENDPATH: 'backend.json',
        DELAY: 0
    };
    var CONFIG = extend(DEFAULT, config);

    var RESERVEDKEYS = ['_LIST_', '_JOIN_'];

    var _super = this;

    var fakerMethod = JSON.parse('{"name":["firstName","lastName","findName","prefix","suffix"],"address":["zipCode","city","cityPrefix","citySuffix","streetName","streetAddress","streetSuffix","secondaryAddress","county","country","state","stateAbbr","latitude","longitude"],"phone":["phoneNumber","phoneNumberFormat","phoneFormats"],"internet":["avatar","email","userName","domainName","domainSuffix","domainWord","ip","userAgent","color","password"],"company":["suffixes","companyName","companySuffix","catchPhrase","bs","catchPhraseAdjective","catchPhraseDescriptor","catchPhraseNoun","bsAdjective","bsBuzz","bsNoun"],"image":["image","avatar","imageUrl","abstract","animals","business","cats","city","food","nightlife","fashion","people","nature","sports","technics","transport"],"lorem":["words","sentence","sentences","paragraph","paragraphs"],"helpers":["randomNumber","randomize","slugify","replaceSymbolWithNumber","shuffle","mustache","createCard","contextualCard","userCard","createTransaction"],"date":["past","future","between","recent"],"random":["number","array_element","object_element"],"finance":["account","accountName","mask","amount","transactionType","currencyCode","currencyName","currencySymbol"],"hacker":["abbreviation","adjective","noun","verb","ingverb","phrase"]}');
    
    //log if not silent
    var doLog = function(message) {
        if (!argv.s) { console.log(message) }
    };

    var isEmpty = function (obj) {
        for(var prop in obj) {
            if(obj.hasOwnProperty(prop))
                return false;
        }

        return true;
    };

    var deflated = {};

    /**
     * Deflate object depth for easier element interaction.
     *
     * Each value key populated by pointers to its original location for later use by inflate
     * @param backendDef
     * @param path
     * @returns {*}
     */
    var deflate = function(backendDef, path) {
        var dirty = [];
        deflated[path] = backendDef;
        var flatCheck = function() {
            for (var prop in backendDef) {
                if (typeof backendDef[prop] === 'object') {
                    dirty.push(prop);
                }
            }
        };
        var makeFlat = function() {
            dirty.forEach(function(el, index) {
                for (var prop in backendDef[el]) {
                    backendDef[prop + ':' + el] = backendDef[el][prop];           //set pointer to parent object
                    dirty.splice(index, 1);

                    delete backendDef[el][prop];
                    if (isEmpty(backendDef[el])) { delete backendDef[el]; }
                }
            });
            flatCheck();
            if (dirty.length > 0) { makeFlat(); }
        };
        flatCheck();
        makeFlat();
        return backendDef;
    };

    /**
     * Inflate the object back to its original state
     * @param resp
     */
    var inflate = function (resp) {

        resp = (!isArray(resp)) ? [resp] : resp;

        /**
         * Restores original depth.
         * @param buffer
         * @returns {*}
         */
        var makeDepth = function (buffer) {
            var sortable = [];
            //sort by property depth
            for (var prop in buffer) {
                sortable.push(prop);
            }
            sortable.sort(function (a, b) {
                a = (a.match(/:/ig)) ? a.match(/:/ig).length : 0;
                b = (b.match(/:/ig)) ? b.match(/:/ig).length : 0;
                return b - a;
            });
            sortable.forEach(function (el) {
                var tempObj = buffer[el];
                delete buffer[el];
                buffer[el] = tempObj;
            });

            for(var prop in buffer) {
                var pointers = prop.split(':');
                if (pointers.length > 1) {
                    buffer[pointers.splice(1, pointers.length).join(':')][pointers[0]] = buffer[prop];
                }
            }
            sortable.forEach(function (el) {
                if (el.match(/:/ig)) { delete buffer[el]; }
            });

            return buffer;
        };
        /**
         * Parses segments of each property marked by a :
         * @param resp
         * @returns {{}}
         */
        var parseSegmentTargets = function (resp) {
            var segmentsBuffer = {};
            for (var prop in resp) {
                var pointerBuffer = prop.split(':');
                if (pointerBuffer.length > 1) {
                    for (var i = 1; i < pointerBuffer.length; i++) {
                        if (i === pointerBuffer.length - 1) {
                            var spliceCopy = pointerBuffer.splice(1,pointerBuffer.length).join(':');
                            if (!segmentsBuffer[spliceCopy]) { segmentsBuffer[spliceCopy] = {}; }
                            segmentsBuffer[spliceCopy][pointerBuffer[0]] = resp[prop];
                        }
                    }
                }
                else {
                    segmentsBuffer[prop] = resp[prop];
                }
            }
            return segmentsBuffer;
        };

        resp.forEach(function (el, index) {
            resp[index] = makeDepth(parseSegmentTargets(el));
        });

        return resp;
    };

    //reads the backend.json file located in the path specified by the CONFIG
    this.readBackendConfig = function (cb) {
        fs.readFile(CONFIG.BACKENDPATH, 'utf8', function (err, data) {
            if (err) {
                throw 'There was an error reading the backend config! Make sure you have a backend.json file in the directory where this is running.';
            } else {
                _super.backend = JSON.parse(data);
                cb();
            }
        });
    };

    /**
     * Response constructor
     * @param path
     * @param id
     * @param backendDefinition
     * @returns {BackendFaker.Response}
     * @constructor
     */
    var Response = function (path, id, backendDefinition) {
        var response = {};
        var status = 200;                                                           //set default status
        backendDefinition = deflate(clone(backendDefinition), path);               //deflate backend structure
        var args = parseMethodArguments(backendDefinition);

        //set amount of items to return
        var maxnOfListItems = (backendDefinition._LIST_)
            ? faker.random.number(backendDefinition._LIST_)
            : null;

        //set any defined _JOINS_
        var hasConnectionToPath = (backendDefinition._JOIN_)
            ? backendDefinition._JOIN_
            : null;

        /**
         * Throws an error if a response cannot be constructed.
         * @param tProp - target faker property
         * @param tMethod - target faker method
         */
        var definitionSuccessCheck = function (tProp, tMethod) {
            if (!tProp || !tMethod) { throw new ReferenceError('Response could not be constructed! Please check your backend.json file.') }
        };

        /**
         * Returns false if the definition property specified is a reserved key.
         * @param definition
         * @returns {boolean}
         */
        var abortIfReservedKey = function (definition) {
            var pass = true;
            RESERVEDKEYS.forEach(function (el) {
                if (el === definition) {pass = false; return}
            });
            return pass;
        };

        function parseMethodArguments (definition) {
            var obj = {};
            var argRegex = /\(([^)]+)\)/ig;
            var bracketRegex = /\[(.*?)\]/ig;
            var nRegex = /^\d+$/;
            var trueRegex = /^true$/;
            var falseRegex = /^false$/;

            function matchAndReplace(val, matchers) {
                var returnval;
                matchers.forEach(function (el) {
                    if (val.match(el[0])) {
                        returnval = el[1](val);
                        return false;
                    }
                });
                return returnval;
            }

            for (var prop in definition) {
                if (typeof definition[prop] !== 'string') { continue; }
                if (definition[prop].match(argRegex)) {
                    var arr = (definition[prop].match(bracketRegex)) ? true : false;
                    obj[prop] = definition[prop]
                        .match(argRegex)[0]
                        .replace('(', '')
                        .replace(')', '')
                        .replace('[', '')
                        .replace(']', '')
                        .replace(']', '')
                        .replace(/\'/ig, '')
                        .replace(' ', '')
                        .split(',');
                    
                    backendDefinition[prop] = backendDefinition[prop].replace(argRegex, '').replace(bracketRegex, '');

                    //look for and parse numbers
                    obj[prop].forEach(function (el, index) {
                        if (typeof el === 'string') {

                            obj[prop][index] = matchAndReplace(el, [
                                [trueRegex, function () {
                                    return true;
                                }],
                                [falseRegex, function () {
                                    return false;
                                }],
                                [nRegex, function (val) {
                                    return parseInt(val, 10);
                                }]
                            ]);
                        }
                    });

                    if (arr) { obj[prop] = [obj[prop]]}
                }
            }
            return obj;
        }

        /**
         * Assigns a targeted faker method to the provided response.
         * @param bdp - backend definition property
         * @param tProp - faker target property
         * @param tMethod - target faker method
         */
        var assignToResponse = function (bdp, tProp, tMethod, response) {
            var resp = response;
            if (abortIfReservedKey(bdp)) {
                definitionSuccessCheck(tProp, tMethod);
                resp[bdp] = faker[tProp][tMethod];
            }
            return resp;
        };

        for (var backendDefinitionProp in backendDefinition) {
            var targetProperty, targetMethod;
            for (var fakerMethodProp in fakerMethod) {
                fakerMethod[fakerMethodProp].forEach(function(el) {
                    if (el === backendDefinition[backendDefinitionProp]) {
                        targetMethod = el;
                        targetProperty = fakerMethodProp;
                    }
                });
            }
            response = assignToResponse(backendDefinitionProp, targetProperty, targetMethod, response);
            if (!maxnOfListItems && abortIfReservedKey(backendDefinitionProp)) {
                response[backendDefinitionProp] = response[backendDefinitionProp].apply(null, args[backendDefinitionProp]);
            }
        }


        /**
         * Extends the response with any joins connected to this request.
         * @param resp
         * @return {*}
         */
        var extendWithConnection = function (resp) {
            for (var bufferId in responseBuffer[hasConnectionToPath]) {
                
                responseBuffer[hasConnectionToPath][bufferId].response.data
                    = (isArray(responseBuffer[hasConnectionToPath][bufferId].response.data)) ?
                        responseBuffer[hasConnectionToPath][bufferId].response.data :
                        [responseBuffer[hasConnectionToPath][bufferId].response.data];

                responseBuffer[hasConnectionToPath][bufferId].response.data.forEach(function (el, index) {
                    if (el.id === parseInt(id, 10)) {
                        resp = extend(resp, el);
                    }
                });
            }
            return resp;
        };

        if (hasConnectionToPath) { 
            response = extendWithConnection(response);
        }

        if (maxnOfListItems) {
            var responseList = [];
            for (var i = 0; i < maxnOfListItems; i++) {
                for (var prop in response) {
                    if (!responseList[i]) { responseList[i] = {} }
                    responseList[i][prop] = response[prop].apply(null, args[prop]);
                }
            }
            response = responseList;
        }

        //inflate the response back to original state
        response = inflate(response);

        if (!maxnOfListItems) { response = response[0] }

        this.response = {
            data: response,
            string: function () {
                return JSON.stringify(response);
            },
            status: function () {
                return status;
            }
        };

        if (!responseBuffer[path]) {
            responseBuffer[path] = {};
        }

        responseBuffer[path][id] = this;

        return this;
    };

    var responseBuffer = {
        _hasResponse_: function (path, id) {
            if (!id) { return false }
            for (var prop in this) {
                if (path === prop) {
                    return (this[prop][id]) ? true : false;
                }
            }
        }
    };

    var clone = function (def) {
        return JSON.parse(JSON.stringify(def));
    };

    this.createBackendRoutes = function () {

        _super.backend.forEach(function (el, index) {
            var path;
            var type = 'get';
            for(var prop in el) {
                path = prop;
                break;
            }
            var corsOrigin = 'http://' + CONFIG.CORSDOMAIN;
            if (CONFIG.CORSPORT) { corsOrigin = corsOrigin.concat(':' + CONFIG.CORSPORT) }

            //set up server
            server.get(path, cors({origin: corsOrigin, credentials: false}), function (request, response) {
                setTimeout(function () {
                    var res = (responseBuffer._hasResponse_(path, (request.params.id) ? request.params.id : null))
                        ? responseBuffer[path][request.params.id]
                        : new Response(path, request.params.id, clone(_super.backend[index][prop]));
                    response.send(res.response.string());
                    doLog('REQUEST: ' + request.method + ' ' + request.url);
                }, (CONFIG.DELAY === 0) ? CONFIG.DELAY : faker.random.number(CONFIG.DELAY));
            });
        });
    };

    this.launchServer = function () {
        this.server = server.listen(CONFIG.PORT, function () {
            console.log('Fake backend up and running! Listening in on port ' + CONFIG.PORT);
        });
    };
};

var translateCfg = {
    'd': 'DELAY',
    'p': 'PORT',
    'b': 'BACKENDPATH',
    'D': 'CORSDOMAIN',
    'P': 'CORSPORT'
};
var config = {};

for (var cfg in translateCfg) {
    if (argv[cfg]) config[translateCfg[cfg]] = argv[cfg];
}

var backendFaker = new BackendFaker(config);

backendFaker.readBackendConfig(function () {
    backendFaker.createBackendRoutes();
    backendFaker.launchServer();
});
