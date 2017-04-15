/**
 * Process JSON validation and execute tasks.
 * Parse request and s
 */
'use strict';

const MicroserviceClient = require('@microservice-framework/microservice-client');
const pidusage = require( 'pidusage' );
const os = require( 'os' );

const bind = function(fn, me) { return function() { return fn.apply(me, arguments); }; };

/**
 * Constructor of ZenciMicroservice object.
 *   .
 *   settings.server.url = Router Server;
 *   settings.server.secureKey = Secure key to register;
 *   settings.server.period = Send request each milisec
 *   settings.route.url = Self URL to register http(s)://IP:PORT;
 *   settings.route.path = URL base path to register with
 *   settings.type = Is it master or child.
 */
function MicroserviceRouterRegister(settings) {

  // Use a closure to preserve `this`
  var self = this;

  self.settings = settings;

  self.register = bind(self.register, self);
  self.monitor = bind(self.monitor, self);
  self.register(settings);

}

/**
 * Ping server by timer.
 */
MicroserviceRouterRegister.prototype.monitor = function(cluster, client, RecordID, RecordToken) {

  var totalWorkers = 0 ;
  for (var id in cluster.workers) {
    totalWorkers++;
  }

  var receivedStats = [];

  for (var id in cluster.workers) {
    pidusage.stat( cluster.workers[id].process.pid, function( error, stat) {
      stat.memory = stat.memory / 1024 / 1024;
      stat.loadavg = os.loadavg();
      receivedStats.push(stat);

      if(receivedStats.length == totalWorkers ) {
        client.put(RecordID, RecordToken, { metrics: receivedStats}, function(err, handlerResponse) {
          if (err) {
            console.log('Router server report error %s.', err.message);
          }
        });
      }
    });
  }
}

/**
 * Register route.
 */
MicroserviceRouterRegister.prototype.register = function(settings) {
  var self = this;

  var client = new MicroserviceClient({
    URL: settings.server.url,
    secureKey: settings.server.secureKey
  });

  var totalWorkers = 0 ;
  for (var id in self.settings.cluster.workers) {
    totalWorkers++;
  }
  var receivedStats = [];

  for (var id in self.settings.cluster.workers) {
    pidusage.stat( self.settings.cluster.workers[id].process.pid, function( error, stat) {
      stat.memory = stat.memory / 1024 / 1024;
      stat.loadavg = os.loadavg();
      receivedStats.push(stat);

      if(receivedStats.length == totalWorkers ) {
        client.post({
            url: settings.route.url,
            path: settings.route.path,
            metrics: receivedStats,
            secureKey: settings.route.secureKey
          },
          function(err, handlerResponse) {
            if (!err) {
              setInterval(self.monitor,
                settings.server.period,
                self.settings.cluster,
                client,
                handlerResponse.id,
                handlerResponse.token
              );
            } else {
              console.log('Router server is not available.')
            }
          }
        );
      }
    });
  }
};

module.exports = MicroserviceRouterRegister;