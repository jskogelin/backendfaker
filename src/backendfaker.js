#!/usr/bin/env node
'use strict';

var faker = require('../node_modules/faker'),
    fs = require('fs'),
    extend = require('node.extend'),
    express = require('express'),
    argv = require('yargs').argv,
    server = express();

if (argv.h) {
    console.log([
        'usage: backend-faker [options]',
        '',
        'options:',
        '  -p       sets the port that the faker server listens to',
        '  -d       sets a maximum delay (in milliseconds) for the server to wait before responding',
        '  -b       looks for the backend.json file in the specified path',
        '  -h       halp',
        ''
    ].join('\n'));
    process.exit();
}

/**
 * Sets up a fake "backend" that intercepts calls made to paths specified in a backend.json file.
 *
 * Backend constructor.
 *
 * TODO: add support for a nested backend architecture
 * TODO: add way to pass arguments to faker methods through backend.json (e.g. for specifying max range in faker.random.number())
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

    var RESERVEDKEYS = ['_LIST_', '_CONNECT_'];

    var _super = this;

    var fakerMethod = JSON.parse('{"name":["firstName","lastName","findName","prefix","suffix"],"address":["zipCode","city","cityPrefix","citySuffix","streetName","streetAddress","streetSuffix","secondaryAddress","county","country","state","stateAbbr","latitude","longitude"],"phone":["phoneNumber","phoneNumberFormat","phoneFormats"],"internet":["avatar","email","userName","domainName","domainSuffix","domainWord","ip","userAgent","color","password"],"company":["suffixes","companyName","companySuffix","catchPhrase","bs","catchPhraseAdjective","catchPhraseDescriptor","catchPhraseNoun","bsAdjective","bsBuzz","bsNoun"],"image":["image","avatar","imageUrl","abstract","animals","business","cats","city","food","nightlife","fashion","people","nature","sports","technics","transport"],"lorem":["words","sentence","sentences","paragraph","paragraphs"],"helpers":["randomNumber","randomize","slugify","replaceSymbolWithNumber","shuffle","mustache","createCard","contextualCard","userCard","createTransaction"],"date":["past","future","between","recent"],"random":["number","array_element","object_element"],"finance":["account","accountName","mask","amount","transactionType","currencyCode","currencyName","currencySymbol"],"hacker":["abbreviation","adjective","noun","verb","ingverb","phrase"]}');


    //reads the backend.json file located in the path specified by the CONFIG
    this.readBackendConfig = function (cb) {
        fs.readFile(CONFIG.BACKENDPATH, 'utf8', function (err, data) {
            if (err) {
                throw 'There was an error reading the backend config! Make sure you have a backend.json file in the directory from where this is running.';
            } else {
                _super.backend = JSON.parse(data);
                cb();
            }
        });
    };

    var Response = function (path, id, backendDefinition) {
        var response = {};
        var status = 200;                                                   //set default status
        var maxnOfListItems = (backendDefinition._LIST_)
            ? faker.random.number(backendDefinition._LIST_)
            : null;

        var hasConnectionToPath = (backendDefinition._CONNECT_)
            ? backendDefinition._CONNECT_
            : null;

        var definitionSuccessCheck = function (tProp, tMethod) {
            if (!tProp || !tMethod) { throw 'Response could not be constructed! Please check your backend.json file.' }
        };

        var abortIfReservedKey = function (definition) {
            var pass = true;
            RESERVEDKEYS.forEach(function (el) {
                if (el === definition) {pass = false}
            });
            return pass;
        };

        var assignToResponse = function (bdp, tProp, tMethod) {
            if (abortIfReservedKey(bdp)) {
                definitionSuccessCheck(targetProperty, targetMethod);
                response[backendDefinitionProp] = faker[tProp][tMethod];
            }
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
            assignToResponse(backendDefinitionProp, targetProperty, targetMethod);
            if (!maxnOfListItems && abortIfReservedKey(backendDefinitionProp)) {
                /*
                * Temporary
                * TODO: fix by allowing to send arguments to faker through backend.json
                * */
                if (backendDefinitionProp === 'faker.random.number') {
                    response[backendDefinitionProp] = response[backendDefinitionProp](2000);
                }
                else {
                    response[backendDefinitionProp] = response[backendDefinitionProp]();
                }
            }
        }

        //extend if response has connection to other path
        var extendWithConnection = function () {
            for (var bufferId in responseBuffer[hasConnectionToPath]) {
                responseBuffer[hasConnectionToPath][bufferId].response.data.forEach(function (el, index) {
                    if (el.id === parseInt(id, 10)) {
                        response = extend(response, el);
                    }
                });
            }
        };

        if (hasConnectionToPath) { extendWithConnection() }

        if (maxnOfListItems) {
            var responseList = [];
            for (var i = 0; i < maxnOfListItems; i++) {
                for (var prop in response) {
                    if (!responseList[i]) { responseList[i] = {} }
                    //temp fix for ids
                    if (prop === 'id') {
                        responseList[i][prop] = response[prop](2000);
                    }
                    else {
                        responseList[i][prop] = response[prop]();
                    }
                }
            }
            response = responseList;
        }

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

    this.createBackendRoutes = function () {

        _super.backend.forEach(function (el) {
            var path;
            var type = 'get';
            for(var prop in el) {
                path = prop;
                break;
            }

            server[type](path, function (request, response) {
                setTimeout(function () {
                    var res = (responseBuffer._hasResponse_(path, (request.params.id) ? request.params.id : null))
                        ? responseBuffer[path][request.params.id]
                        : new Response(path, request.params.id, el[path]);
                    response.header("Access-Control-Allow-Origin", "*");
                    response.header("Access-Control-Allow-Headers", "X-Requested-With");
                    response.send(res.response.string());
                    console.log('REQUEST: ' + request.method + ' ' + request.url);
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
    'b': 'BACKENDPATH'
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
