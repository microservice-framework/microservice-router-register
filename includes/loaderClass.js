/**
 * Process Test task.
 */
'use strict';

import debug from 'debug';
import { EventEmitter } from 'node:events';
import MicroserviceClient from "@microservice-framework/microservice-client"


/**
 * Constructor.
 *   Prepare data for test.
 */
function LoaderClass(headers) {
  EventEmitter.call(this);
  this.headers = headers;
  this.preLoad = [];
  this.errorResult = [];
  this.okResult = {};
  this.processedCount = 0;
  this.mfwHeaders = {};
  this.loadersPrepared = 0;
  this.loadersToPrepare = 0;

  for (let name in this.headers) {
    if (name.substring(0, 4) == 'mfw-') {
      this.mfwHeaders[name.substring(4)] = this.headers[name];
      this.loadersToPrepare = this.loadersToPrepare + 1;
    }
  }

  this.on('itemError',  ( preLoad, err ) => {
    this.debug.debug('itemError %O %O', err, preLoad);
    this.errorResult.push({
      error: err,
      pairSearch: preLoad,
    });
    this.processedCount = this.processedCount + 1;
    if (this.processedCount == this.preLoad.length) {
      this.emit('error', this.errorResult);
    }
  });

  this.on('itemOk', (preLoad, searchResult) => {
    this.debug.debug('itemOk %O result: %O', preLoad, searchResult);

    this.okResult[preLoad.name] = searchResult;
    this.processedCount = this.processedCount + 1;
    if (this.processedCount == this.preLoad.length) {
      if (this.errorResult.length > 0) {
        this.emit('error', this.errorResult);
      } else {
        this.emit('done', this.okResult);
      }
    }
  });
  this.on('loaderFailed',  (name) => {
    this.debug.debug('loader failed %s = %s', name, this.mfwHeaders[name]);
    delete this.mfwHeaders[name];
    this.loadersPrepared = this.loadersPrepared + 1;
    if (this.loadersToPrepare == this.loadersPrepared) {
      this.processLoaders();
    }
  });
  this.on('loaderSkip',  (name) => {
    this.debug.debug('loader Skip %s = %s', name, this.mfwHeaders[name]);
    delete this.mfwHeaders[name];
    this.loadersPrepared = this.loadersPrepared + 1;
    if (this.loadersToPrepare == this.loadersPrepared) {
      this.processLoaders();
    }
  });
  this.on('loaderReady', (name, clientSettings, searchBy) => {
    this.debug.debug('loader ready %s = %s', name, this.mfwHeaders[name]);
    let value = this.mfwHeaders[name];
    this.preLoad.push({
      name: name,
      value: value,
      clientSettings: clientSettings,
      searchBy: searchBy,
    });
    this.loadersPrepared = this.loadersPrepared + 1;
    if (this.loadersToPrepare == this.loadersPrepared) {
      this.processLoaders();
    }
  });
}

// Inherit from EventEmitter
Object.setPrototypeOf(LoaderClass.prototype, EventEmitter.prototype);

LoaderClass.prototype.debug = {
  debug: debug('loader:debug'),
};

/**
 * Entry point.
 */
LoaderClass.prototype.process = function () {
  this.debug.debug('Processing %s %O', this.loadersToPrepare, this.mfwHeaders);
  if (this.loadersToPrepare == 0) {
    return this.emit('done', false);
  }
  for (let name in this.mfwHeaders) {
    this.preProcessLoader(name);
  }
};
/**
 * Check module status.
 *
 * @param {object} module - module data.
 */
LoaderClass.prototype.processLoaders = function () {
  this.debug.debug('Processing %s %O', this.preLoad.length, this.preLoad);

  if (this.preLoad.length == 0) {
    return this.emit('done', false);
  }
  for (let i in this.preLoad) {
    let preLoad = this.preLoad[i];
    this.processPreLoad(preLoad);
  }
};

/**
 * Check module status.
 *
 * @param {object} module - module data.
 */
LoaderClass.prototype.preProcessLoader = async function (name) {

  let loaded = await this.getLoaderSettings(name);
  if(loader.skip) {
    return this.emit('loaderSkip', name);
  }
  if(loaded.error) {
    return this.emit('loaderFailed', name);
  }
  this.emit('loaderReady', loaded);
};

/**
 * Wrapper to get secure access to service by path.
 */
LoaderClass.prototype.processPreLoad = function (preLoad) {
  this.debug.debug('Process preLoad %O', preLoad);
  let msClient = new MicroserviceClient(preLoad.clientSettings);
  if (preLoad.clientSettings.secureKey) {
    var searchQuery = {};
    switch (preLoad.searchBy.type) {
      case 'number': {
        searchQuery[preLoad.searchBy.field] = parseInt(preLoad.value);
        break;
      }
      case 'float': {
        searchQuery[preLoad.searchBy.field] = parseFloat(preLoad.value);
        break;
      }
      default: {
        searchQuery[preLoad.searchBy.field] = preLoad.value;
      }
    }
    return msClient.search(searchQuery).then((response) => {
      if(response.error) {
        this.emit('itemError', preLoad, response.error)
        return
      }
      this.emit('itemOk', preLoad, response.answer[0]);
    })
  }
  msClient.get(preLoad.value).then((response) => {
    if(response.error) {
      this.emit('itemError', preLoad, response.error)
      return
    }
    this.emit('itemOk', preLoad, response.answer);
  })
};

/**
 * Wrapper to get secure access to service by path.
 */
LoaderClass.prototype.getLoaderSettings = async function (name) {
  var self = this;
  let routerServer = new MicroserviceClient({
    URL: process.env.ROUTER_URL,
    secureKey: process.env.ROUTER_SECRET,
  });
  var searchQuery = {};
  searchQuery['provides.:' + name] = {
    $exists: true,
  };
  let routes = await routerServer.search(searchQuery)

  if(routes.error) {
    return {
      name: name,
      error: routes.error
    }
  }

  if (routes[0].scope == process.env.SCOPE) {
    return {
      name: name,
      skip: true
    };
  }

  let loaderURL = routes[0].path[0].split('/');
  let resultPath = [];
  for (var i in loaderURL) {
    if (loaderURL[i].charAt(0) == ':') {
      let urlItem = loaderURL[i].substr(1);
      if (this.mfwHeaders[urlItem]) {
        resultPath.push(this.mfwHeaders[urlItem]);
        continue;
      }
    }
    resultPath.push(loaderURL[i]);
  }
  if (process.env.ROUTER_PROXY_URL.charAt(process.env.ROUTER_PROXY_URL.length - 1) == '/') {
    resultPath = process.env.ROUTER_PROXY_URL + resultPath.join('/');
  } else {
    resultPath = process.env.ROUTER_PROXY_URL + '/' + resultPath.join('/');
  }
  var clientSettings = {
    URL: resultPath,
  };
  let accessToken = false;
  if (this.headers.access_token) {
    accessToken = this.headers.access_token;
  }
  if (this.headers['Access-Token']) {
    accessToken = this.headers['Access-Token'];
  }
  if (accessToken) {
    clientSettings.accessToken = accessToken;
  } else {
    clientSettings.secureKey = routes[0].secureKey;
  }
  return {
    name: name,
    client: clientSettings,
    searchBy: routes[0].provides[':' + name]
  }
};

export default LoaderClass
