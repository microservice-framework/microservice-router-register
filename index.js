/**
 * Process JSON validation and execute tasks.
 * Parse request and s
 */
'use strict';

const MicroserviceClient = require('zenci-microservice-client');
const getMetrics = require('metrics-process');

const bind = function(fn, me) { return function() { return fn.apply(me, arguments); }; };

/**
 * Constructor of ZenciMicroservice object.
 *   .
 *   settings.server.url = Router Server;
 *   settings.server.secureKey = Secure key to register;
 *   settings.server.period = Send request each milisec
 *   settings.route.url = Self URL to register http(s)://IP:PORT;
 *   settings.route.path = URL base path to register with
 */
function ZenciMicroserviceRouterRegister(settings) {

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
ZenciMicroserviceRouterRegister.prototype.monitor = function(client, RecordID, RecordToken) {
  getMetrics(function(error, metrics) {
    client.put(RecordID, RecordToken, { metrics: metrics}, function(err, handlerResponse) {
      if (err) {
        console.log('Router server report error %s.', err.message);
      }
    });
  });
}
/**
 * Register route.
 */
ZenciMicroserviceRouterRegister.prototype.register = function(settings) {
  var self = this;

  var client = new MicroserviceClient({
    URL: settings.server.url,
    secureKey: settings.server.secureKey
  });

  client.post({
      url: settings.route.url,
      path: settings.route.path
    },
    function(err, handlerResponse) {
      if (!err) {
        setInterval(self.monitor,
          settings.server.period,
          client,
          handlerResponse.id,
          handlerResponse.token
        );
      } else {
        console.log('Router server is not available.')
      }
    }
  );
};

module.exports = ZenciMicroserviceRouterRegister;