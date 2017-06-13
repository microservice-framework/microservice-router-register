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
  self.loadersPrepared = 0;
  self.loadersToPrepare = 0;

  for (var name in self.headers) {
    if (name.substr(0, 4) == 'mfw-') {
      self.mfwHeaders[name.substr(4)] = self.headers[name];
      self.loadersToPrepare = self.loadersToPrepare + 1;
    }
  }

  self.on('itemError', function(err, preLoad) {
    self.debug.debug('itemError %O %O',err, preLoad);
    self.errorResult.push({
      error: err,
      pairSearch: preLoad
    });
    self.processedCount = self.processedCount + 1;
    if (self.processedCount == self.preLoad.length) {
      self.emit('error', self.errorResult);
    }
  });

  self.on('itemOk', function(preLoad, searchResult) {
    self.debug.debug('itemOk %O result: %O', preLoad, searchResult);

    self.okResult[preLoad.name] = searchResult;
    self.processedCount = self.processedCount + 1;
    if (self.processedCount == self.preLoad.length) {
      if (self.errorResult.length > 0) {
        self.emit('error', self.errorResult);
      } else {
        self.emit('done', self.okResult);
      }
    }
  });
  self.on('loaderFailed', function(name) {
    self.debug.debug('loader failed %s = %s', name, self.mfwHeaders[name]);
    delete self.mfwHeaders[name];
    self.loadersPrepared = self.loadersPrepared + 1;
    if (self.loadersToPrepare == self.loadersPrepared) {
      self.processLoaders();
    }
  });
  self.on('loaderSkip', function(name) {
    self.debug.debug('loader Skip %s = %s', name, self.mfwHeaders[name]);
    delete self.mfwHeaders[name];
    self.loadersPrepared = self.loadersPrepared + 1;
    if (self.loadersToPrepare == self.loadersPrepared) {
      self.processLoaders();
    }

  });
  self.on('loaderReady', function(name, clientSettings, searchBy) {
    self.debug.debug('loader ready %s = %s', name, self.mfwHeaders[name]);
    let value = self.mfwHeaders[name];
    self.preLoad.push({
      name: name,
      value: value,
      clientSettings: clientSettings,
      searchBy: searchBy,
    });
    self.loadersPrepared = self.loadersPrepared + 1;
    if (self.loadersToPrepare == self.loadersPrepared) {
      self.processLoaders();
    }
  });

}
util.inherits(LoaderClass, EventEmitter);


LoaderClass.prototype.debug = {
  debug: debugF('loader:debug')
};

/**
 * Entry point.
 */
LoaderClass.prototype.process = function() {
  var self = this;
  self.debug.debug('Processing %s %O', self.loadersToPrepare, self.mfwHeaders);
  if (self.loadersToPrepare == 0) {
    return self.emit('done', false);
  }
  for (var name in self.mfwHeaders) {
    self.preProcessLoader(name, self.mfwHeaders[name]);
  }
}
/**
 * Check module status.
 *
 * @param {object} module - module data.
 */
LoaderClass.prototype.processLoaders = function() {
  var self = this;
  self.debug.debug('Processing %s %O', self.preLoad.length, self.preLoad);

  if (self.preLoad.length == 0) {
    return self.emit('done', false);
  }
  for (var i in self.preLoad) {
    var preLoad = self.preLoad[i];
    self.processPreLoad(preLoad);
  }
}

/**
 * Check module status.
 *
 * @param {object} module - module data.
 */
LoaderClass.prototype.preProcessLoader = function(name, value) {
  var self = this;
  self.getLoaderSettings(name, function(err, clientSettings, searchBy) {
    if (err) {
      if (err == 'skip') {
        return self.emit('loaderSkip', name);
      }
      return self.emit('loaderFailed', name);
    }
    return self.emit('loaderReady', name, clientSettings, searchBy);
  })
}

/**
 * Wrapper to get secure access to service by path.
 */
LoaderClass.prototype.processPreLoad = function(preLoad) {
  var self = this;
  self.debug.debug('Process preLoad %O', preLoad);
  let msClient = new MicroserviceClient(preLoad.clientSettings);
  msClient.get(preLoad.value, function(err, searchResult) {
    if (err) {
      return self.emit('itemError', err, preLoad);
    }
    self.emit('itemOk', preLoad, searchResult);
  });
}

/**
 * Wrapper to get secure access to service by path.
 */
LoaderClass.prototype.getLoaderSettings = function(name, callback) {
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
      let loaderURL = routes[0].path[0].split('/');
      let resultPath = [];
      for (var i in loaderURL) {
        if (loaderURL[i].charAt(0) == ':') {
          let urlItem = loaderURL[i].substr(1);
          if (self.mfwHeaders[urlItem]) {
            resultPath.push(self.mfwHeaders[urlItem]);
            continue;
          }
        }
        resultPath.push(loaderURL[i]);
      }
      if (process.env.ROUTER_PROXY_URL.charAt(process.env.ROUTER_PROXY_URL.length - 1) == '/') {
        resultPath = process.env.ROUTER_PROXY_URL + resultPath.join('/')
      } else {
        resultPath = process.env.ROUTER_PROXY_URL + '/' + resultPath.join('/')
      }
      var clientSettings = {
        URL: resultPath
      }
      if (self.headers.access_token) {
        clientSettings.accessToken = self.headers.access_token;
      } else {
        clientSettings.secureKey = routes[0].secureKey;
      }
      callback(null, clientSettings, routes[0].provides[':' + name]);
    });
}

module.exports = LoaderClass;
