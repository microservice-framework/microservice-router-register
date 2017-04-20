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
const debug = require('debug');

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
  self.authData = false;

  self.client = new MicroserviceClient({
    URL: self.server.url,
    secureKey: self.server.secureKey
  });

  self.on('timer', function() {
    self.collectStats();
  });

  self.on('report', function(stats) {
    self.reportStats(stats);
  });

  setInterval(function() {
    self.emit('timer');
    self.debug.debug('timer triggered');
  }, self.server.period);

  self.collectStats();
}

util.inherits(MicroserviceRouterRegister, EventEmitter);

MicroserviceRouterRegister.prototype.debug = {
  log: debug('microservice-router-register:log'),
  debug: debug('microservice-router-register:debug'),
};


/**
 * Collect Stats.
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
    pidusage.stat(self.cluster.workers[id].process.pid, function(error, stat) {
      stat.memory = stat.memory / 1024 / 1024;
      stat.loadavg = os.loadavg();
      receivedStats.push(stat);
      if (receivedStats.length == workersCount) {
        self.emit('report', receivedStats);
      }
    });
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
    self.client.post({
      url: self.route.url,
      path: self.route.path,
      metrics: stats,
      secureKey: self.route.secureKey
    },
    function(err, handlerResponse) {
      if (!err) {
        self.authData = handlerResponse;
      } else {
        self.debug.log('Router server is not available.')
      }
    });
    return;
  }
  self.debug.debug('Update stats on router');
  self.client.put(self.authData.id, self.authData.token,
    { metrics: stats}, function(err, handlerResponse) {
    if (err) {
      self.authData = false;
      return self.reportStats(stats);
    }
  });
}

module.exports = MicroserviceRouterRegister;
