/**
 * Process Test task.
 */
'use strict';

const EventEmitter = require('events').EventEmitter;
const util = require('util');
const MicroserviceClient = require('@microservice-framework/microservice-client');
const debugF = require('debug');

/**
 * Constructor.
 *   Prepare data for test.
 */
function LoaderClass(headers) {
  EventEmitter.call(this);
  var self = this;
  self.headers = headers;
  self.preLoad = [];
  self.errorResult = [];
  self.okResult = {};
  self.processedCount = 0;
  self.mfwHeaders = {};

  for (var name in self.headers) {
    if (name.substr(0, 4) == 'mfw-') {
      self.mfwHeaders[name] = self.headers[name];
      self.preLoad.push({
        name: name.substr(4),
        value: self.headers[name]
      });
    }
  }
  self.on('itemError', function(err, pairSearch) {
    self.debug.debug('itemError %O %O',err, pairSearch);
    self.errorResult.push({
      error: err,
      pairSearch: pairSearch
    });
    self.processedCount = self.processedCount + 1;
    if (self.processedCount == self.preLoad.length) {
      self.emit('error', self.errorResult);
    }
  });
  self.on('itemSkip', function(pairSearch) {
    self.debug.debug('itemSkip %O %O', pairSearch);

    self.processedCount = self.processedCount + 1;
    if (self.processedCount == self.preLoad.length) {
      if (self.errorResult.length > 0) {
        self.emit('error', self.errorResult);
      } else {
        self.emit('done', self.okResult);
      }
    }
  });
  self.on('itemOk', function(pairSearch, searchResult) {
    self.debug.debug('itemOk %O result: %O', pairSearch, searchResult);

    self.okResult[pairSearch.name] = searchResult;
    self.processedCount = self.processedCount + 1;
    if (self.processedCount == self.preLoad.length) {
      if (self.errorResult.length > 0) {
        self.emit('error', self.errorResult);
      } else {
        self.emit('done', self.okResult);
      }
    }
  });
}
util.inherits(LoaderClass, EventEmitter);


LoaderClass.prototype.debug = {
  debug: debugF('loader:debug')
};

/**
 * Check module status.
 *
 * @param {object} module - module data.
 */
LoaderClass.prototype.process = function() {
  var self = this;
  self.debug.debug('Processing %s %O', self.preLoad.length, self.preLoad);
  if (self.preLoad.length == 0) {
    return self.emit('done', false);
  }
  for (var i in self.preLoad) {
    var pairSearch = self.preLoad[i];
    self.processPair(pairSearch);
  }

}

/**
 * Wrapper to get secure access to service by path.
 */
LoaderClass.prototype.processPair = function(pairSearch) {
  var self = this;
  self.debug.debug('ProcessPair %O', pairSearch);
  self.getLoader(pairSearch.name, function(err, client, searchBy) {
    if (err == 'skip') {
      return self.emit('itemSkip', pairSearch);
    }
    if (err) {
      return self.emit('itemError', err, pairSearch);
    }
    var searchQuery = {};
    switch (searchBy.type){
      case 'number': {
        searchQuery[searchBy.field] = parseInt(pairSearch.value);
        break;
      }
      case 'float': {
        searchQuery[searchBy.field] = parseFloat(pairSearch.value);
        break;
      }
      default: {
        searchQuery[searchBy.field] = pairSearch.value;
      }
    }
    client.search(searchQuery, function(err, searchResult) {
      if (err) {
        return self.emit('itemError', err, pairSearch);
      }
      self.emit('itemOk', pairSearch, searchResult[0]);
    });
  });
}

/**
 * Wrapper to get secure access to service by path.
 */
LoaderClass.prototype.getLoader = function(name, callback) {
  var self = this;
  let routerServer = new MicroserviceClient({
    URL: process.env.ROUTER_URL,
    secureKey: process.env.ROUTER_SECRET
  });
  var searchQuery = {};
  searchQuery['provides.:' + name] = {
    $exists: true
  }

  routerServer.search(searchQuery, function(err, routes) {
      if (err) {
        return callback(err);
      }
      if (routes[0].scope == process.env.SCOPE) {
        return callback('skip');
      }
      var clientSettings = {
        URL: process.env.ROUTER_PROXY_URL + '/' + routes[0].path[0]
      }
      if (self.headers.access_token) {
        clientSettings.accessToken = self.headers.access_token;
      } else {
        clientSettings.secureKey = routes[0].secureKey;
      }
      clientSettings.headers = self.mfwHeaders;
      let msClient = new MicroserviceClient(clientSettings);
      callback(null, msClient, routes[0].provides[':' + name]);
    });
}

module.exports = LoaderClass;
