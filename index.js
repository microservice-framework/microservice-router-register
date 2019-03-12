/**
 * Process JSON validation and execute tasks.
 * Parse request and s
 */
'use strict';

const EventEmitter = require('events').EventEmitter;
const util = require('util');
const MicroserviceClient = require('@microservice-framework/microservice-client');
const pidusage = require('pidusage');
const os = require('os');
const debugF = require('debug');
const LoaderClass = require('./includes/loaderClass.js');

var debug = {
  log: debugF('client-search:log'),
  debug: debugF('client-search:debug')
};


/**
 * Constructor of ZenciMicroservice object.
 *   .
 *   settings.server.url = Router Server;
 *   settings.server.secureKey = Secure key to register;
 *   settings.server.period = Send request each milisec
 *   settings.route.url = Self URL to register http(s)://IP:PORT;
 *   settings.route.path = URL base path to register with
 *   settings.cluster = cluster info.
 */
function MicroserviceRouterRegister(settings) {
  EventEmitter.call(this);

  // Use a closure to preserve `this`
  var self = this;
  self.settings = settings;
  self.cluster = settings.cluster;
  self.server = settings.server;
  self.route = settings.route;
  self.authData = false
  self.isNewAPI = false
  self.cpuUsage = false
  if (!settings.cluster.workers) {
    self.receivedStats = {}
    self.isNewAPI = true
    self.cluster.worker.on('message', function(message){
      if (message.type && message.message && message.workerPID) {
        if (message.type == 'mfw_stats') {
          if (!self.receivedStats[message.workerPID]) {
            self.receivedStats[message.workerPID] = {}
          }
          self.receivedStats[message.workerPID].stats = message.message;
          self.receivedStats[message.workerPID].time = Date.now()
        }
        // clean up old stats for pids that doesnot exists anymore
        for (let workerPID in self.receivedStats) {
          if (self.receivedStats[workerPID].time < Date.now() - self.server.period) {
            delete self.receivedStats[workerPID]
          }
        }
      }
    })
  }

  self.client = new MicroserviceClient({
    URL: self.server.url,
    secureKey: self.server.secureKey
  });

  self.on('timer', function() {
    if (self.isNewAPI) {
      return self.collectStat();
    }
    self.collectStats();
  });

  self.on('report', function(stats) {
    self.reportStats(stats);
  });

  setInterval(function() {
    self.emit('timer');
    self.debug.debug('timer triggered');
  }, self.server.period);

  // backward compatibility 1.x
  if (settings.cluster.workers) {
    self.collectStats();
  }
}

util.inherits(MicroserviceRouterRegister, EventEmitter);

MicroserviceRouterRegister.prototype.debug = {
  log: debugF('microservice-router-register:log'),
  debug: debugF('microservice-router-register:debug'),
};

MicroserviceRouterRegister.prototype.collectStat = function() {
  var self = this;
  // support node before 6.1
  // pidusage will be depricated.
  if (!process.memoryUsage || !process.process.cpuUsage) {
    return pidusage.stat(self.cluster.worker.process.pid, function(error, stat) {
      if (stat) {
        stat.memory = stat.memory / 1024 / 1024;
        stat.cpu = stat.cpu.toFixed(2);
        stat.loadavg = os.loadavg();
        process.send({
          type: 'mfw_stats',
          workerPID: self.cluster.worker.process.pid,
          message: stat
        })
      }
    });
  }
  
  let cpuPercent = "0"
  if (!self.receivedStats[self.cluster.worker.process.pid]) {
    self.cpuUsage = process.cpuUsage()
    cpuPercent = 100 * (self.cpuUsage.user + self.cpuUsage.system) / process.uptime() / 1000000
    cpuPercent = cpuPercent.toFixed(2)
  } else {
    let timePeriod = Date.now() - self.receivedStats[self.cluster.worker.process.pid].time
    self.cpuUsage = process.cpuUsage(self.cpuUsage)
    cpuPercent = 100 * (self.cpuUsage.user + self.cpuUsage.system) / timePeriod / 1000
    cpuPercent = cpuPercent.toFixed(2)
  }
  let stat = {
    memory: process.memoryUsage().rss / 1024 / 1024,
    loadavg: os.loadavg(),
    cpu: cpuPercent
  }
  let message = {
    type: 'mfw_stats',
    workerPID: self.cluster.worker.process.pid,
    message: stat
  }
  if (!self.cluster.workers) {
    self.cluster.message(message)
  } else {
    self.debug.debug('Broadcast message to workers %s.', message.toString());
    for (var key in self.cluster.workers) {
      self.cluster.workers[key].send(message);
    }
  }
}

/**
 * Collect Stats.
 * deprecated code for 1.x compatibility
 */
MicroserviceRouterRegister.prototype.collectStats = function() {
  var self = this;

  self.debug.debug('collect stats');
  var receivedStats = [];

  var workersCount = 0;
  for (var i in self.cluster.workers) {
    workersCount = workersCount + 1;
  }

  for (var id in self.cluster.workers) {
    try {
      pidusage.stat(self.cluster.workers[id].process.pid, function(error, stat) {
        if (stat) {
          stat.memory = stat.memory / 1024 / 1024;
          stat.cpu = stat.cpu.toFixed(2);
          stat.loadavg = os.loadavg();
          receivedStats.push(stat);
          if (receivedStats.length == workersCount) {
            self.emit('report', receivedStats);
          }
        } else {
          workersCount = workersCount - 1;
          if (receivedStats.length == workersCount) {
            self.emit('report', receivedStats);
          }
        }
      });
    } catch (e) {
      //pidusage trow exception if pid is not awailable
      self.debug.debug('possible dead child error %O', e);
      workersCount = workersCount - 1;
      if (receivedStats.length == workersCount) {
        self.emit('report', receivedStats);
      }
    }
  }
}

/**
 * Report Stats.
 */
MicroserviceRouterRegister.prototype.reportStats = function(stats) {
  var self = this;

  self.debug.debug('report stats');
  if (!self.authData) {
    self.debug.debug('register on router');
    var router = self.route;
    router.metrics = stats;
    if (!router.scope && process.env.SCOPE) {
      router.scope = process.env.SCOPE;
    }
    self.client.post(router, function(err, handlerResponse) {
      if (err) {
        self.debug.log('Router server is not available.')
        self.debug.debug('Router responce %O.', err);
        return;
      }
      self.authData = handlerResponse;
    });
    return;
  }
  self.debug.debug('Update stats on router');
  self.client.put(self.authData.id, self.authData.token,
    { metrics: stats}, function(err) {
    if (err) {
      self.authData = false;
      return self.reportStats(stats);
    }
  });
}

/**
 * Compare route to router.path items.
 */
function matchRoute(route, routeItem) {
  let routeItems = route.split('/');
  var paths = routeItem.path;


  for (var i in paths) {
    // If route qual saved path
    if (paths[i] == route) {
      return true;
    }

    // If routeItems.length == 1, and did not match
    if (routeItems.length == 1) {
      if (paths[i] != route) {
        continue;
      }
    }

    var pathItems = paths[i].split('/');
    if (pathItems.length != routeItems.length) {
      continue;
    }
    var fullPathMatched = true;
    for (var i = 0; i < routeItems.length; i++) {
      if (pathItems[i].charAt(0) == ':') {
        routeItem.matchVariables[pathItems[i].substring(1)] = routeItems[i];
      } else {
        if (routeItems[i] != pathItems[i]) {
          fullPathMatched = false;
          break;
        }
      }
    }
    if (fullPathMatched) {
      return true;
    }
  }

  return false;
}

/**
 * Find target URL.
 */
function FindTarget(routes, route, callback) {
  debug.debug('Find route %s', route);

  var availableRoutes = [];
  for (var i in routes) {
    if (routes[i].type && routes[i].type != 'handler') {
      continue
    }
    routes[i].matchVariables = {};
    if (matchRoute(route, routes[i])) {
      availableRoutes.push(routes[i]);
    }
  }
  debug.debug('Available routes for %s %O', route, availableRoutes);
  if (availableRoutes.length == 0) {
    debug.debug('Not found for %s', route);
    return callback(new Error('Endpoint not found'), null);
  }
  if (availableRoutes.length == 1) {
    return callback(null, availableRoutes.pop());
  }

  var random = Math.floor(Math.random() * (availableRoutes.length) + 1) - 1;
  debug.log(availableRoutes[random]);
  return callback(null, availableRoutes[random]);
}

/**
 * Wrapper to get secure access to service by path.
 */
function clientViaRouter(pathURL, accessToken, callback) {
  if (!callback) {
    callback = accessToken;
    accessToken = false;
  }
  let routerServer = new MicroserviceClient({
    URL: process.env.ROUTER_URL,
    secureKey: process.env.ROUTER_SECRET
  });

  routerServer.search({}, function(err, routes) {
      if (err) {
        return callback(err);
      }
      FindTarget(routes, pathURL, function(err, router) {
        if (err) {
          return callback(err, null);
        }
        var clientSettings = {
          URL: process.env.ROUTER_PROXY_URL + '/' + pathURL
        }
        if (accessToken) {
          clientSettings.accessToken = accessToken;
        } else {
          clientSettings.secureKey = router.secureKey;
        }

        let msClient = new MicroserviceClient(clientSettings);
        return callback(null, msClient);
      });
    });
}

/**
 * Loader is a static method to wrap around LoaderClass.
 * load mfw-name as requestDetails.name objects provided by other services.
 */
function loaderMicroservice(method, jsonData, requestDetails, callback) {

  var preLoadValues = new LoaderClass(requestDetails.headers);
  debug.debug('loaderMicroservice:headers %O', requestDetails.headers);

  preLoadValues.on('error', function(result) {
    debug.debug('loaderMicroservice:error %O', result);

    var errorMessage = 'Pre Load failed:\n';
    for (var i in result) {
      var errorItem = result[i];
      errorMessage = errorMessage + ' - ' + errorItem.pairSearch.name
        + ': ' + errorItem.error.message + '\n';
    }
    return callback(new Error(errorMessage));
  });

  preLoadValues.on('done', function(result) {
    debug.debug('loaderMicroservice:done %O', result);
    if (result) {
      for (var name in result) {
        requestDetails[name] = result[name];
      }
    }
    callback(null);
  });

  preLoadValues.process();


  return preLoadValues;
}

/**
 * Loader is a static method to wrap around LoaderClass.
 * load mfw-name as requestDetails.name objects provided by other services.
 */
function loaderByList(list, accessToken, callback) {
  var headers = {}
  for (var i in list) {
    headers['mfw-' + i] = list[i];
  }
  if (!callback) {
    callback = accessToken;
  } else {
    headers['access_token'] = accessToken;
    headers['Access-Token'] = accessToken;
  }

  var preLoadValues = new LoaderClass(headers);

  preLoadValues.on('error', function(result) {
    var errorMessage = 'Pre Load failed:\n';
    for (var i in result) {
      var errorItem = result[i];
      errorMessage = errorMessage + ' - ' + errorItem.pairSearch.name
        + ': ' + errorItem.error.message + '\n';
    }
    return callback(new Error(errorMessage));
  });

  preLoadValues.on('done', function(result) {
    debug.debug('loaderByList:done %O', result);
    callback(null, result);
  });
  preLoadValues.process();

  return preLoadValues;
}

module.exports.register = MicroserviceRouterRegister;
module.exports.clientViaRouter = clientViaRouter;
module.exports.loaderClass = LoaderClass;
module.exports.loaderMicroservice = loaderMicroservice;
module.exports.loaderByList = loaderByList;
