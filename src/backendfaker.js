#!/usr/bin/env node
'use strict';

var faker = require('../node_modules/faker');
var fs = require('fs');
var extend = require('node.extend');
var express = require('express');
var server = express();

var FakeBackend = function (config) {
    var DEFAULT = {
        PORT: 1330
    };
    var CONFIG = extend(DEFAULT, config);

    var _super = this;

    var fakerMethod = JSON.parse('{"name":["firstName","lastName","findName","prefix","suffix"],"address":["zipCode","city","cityPrefix","citySuffix","streetName","streetAddress","streetSuffix","secondaryAddress","county","country","state","stateAbbr","latitude","longitude"],"phone":["phoneNumber","phoneNumberFormat","phoneFormats"],"internet":["avatar","email","userName","domainName","domainSuffix","domainWord","ip","userAgent","color","password"],"company":["suffixes","companyName","companySuffix","catchPhrase","bs","catchPhraseAdjective","catchPhraseDescriptor","catchPhraseNoun","bsAdjective","bsBuzz","bsNoun"],"image":["image","avatar","imageUrl","abstract","animals","business","cats","city","food","nightlife","fashion","people","nature","sports","technics","transport"],"lorem":["words","sentence","sentences","paragraph","paragraphs"],"helpers":["randomNumber","randomize","slugify","replaceSymbolWithNumber","shuffle","mustache","createCard","contextualCard","userCard","createTransaction"],"date":["past","future","between","recent"],"random":["number","array_element","object_element"],"finance":["account","accountName","mask","amount","transactionType","currencyCode","currencyName","currencySymbol"],"hacker":["abbreviation","adjective","noun","verb","ingverb","phrase"]}');

    this.readBackendConfig = function (callback) {
        fs.readFile('backend.json', 'utf8', function (err, data) {
            if (err) {
                throw 'There was an error reading the backend config: ' + err.message;
            } else {
                _super.backend = JSON.parse(data);
                callback();
            }
        });
    };

    /**
     *
     * @param path
     * @param id
     * @param backendDefinition
     * @returns {FakeBackend.Response}
     * @constructor
     */
    var Response = function (path, id, backendDefinition) {
        var response = {};
        var status = 200;                   //set default status

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
            response[backendDefinitionProp] = faker[targetProperty][targetMethod]();
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

        if (!RESPONSEBUFFER[path]) {
            RESPONSEBUFFER[path] = {};
        }

        RESPONSEBUFFER[path][id] = this;

        return this;
    };

    var RESPONSEBUFFER = {
        _hasResponse_: function (path, id) {
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
            var type = (el._type_) ? el._type_ : 'get';
            for(var prop in el) {
                path = prop;
                break;
            }

            server[type](path, function (request, response) {
                var res = (RESPONSEBUFFER._hasResponse_(path, request.params.id)) ? RESPONSEBUFFER[path][request.params.id] : new Response(path, request.params.id, el[path]);;
                response.send(res.response.string());
                console.log('REQUEST: ' + request.method + ' ' + request.url);
            });
        });
    };

    this.launchServer = function () {
        this.server = server.listen(CONFIG.PORT, function () {
            console.log('Fake backend up and running!');
        });
    };
};

var fakeBackend = new FakeBackend();

fakeBackend.readBackendConfig(function () {
    fakeBackend.createBackendRoutes();
    fakeBackend.launchServer();
});
