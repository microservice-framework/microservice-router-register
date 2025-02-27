'use strict';

import os from 'node:os';
import debug from 'debug';
import { EventEmitter } from 'node:events';
import MicroserviceClient from '@microservice-framework/microservice-client';

/**
 * Constructor.
 *   Prepare data for test.
 */
function ClientRegister(settings) {
  EventEmitter.call(this);

  this.cluster = settings.cluster;
  this.route = settings.route;
  this.authData = false;
  this.cpuUsage = false;
  this.receivedStats = {}
  this.collectInterval = false
  this.reportInterval = false

  this.server = {
    url: process.env.ROUTER_URL,
    secureKey: process.env.ROUTER_SECRET,
    period: parseInt(process.env.ROUTER_PERIOD),
  };
  if (!this.server.period) {
    throw new Error('Priod need to be integer value');
  }
  this.client = new MicroserviceClient({
    URL: this.server.url,
    secureKey: this.server.secureKey,
  });
  process.on('SIGINT', () => {
    this.shutdown();
  });
  process.on('SIGTERM', () => {
    this.shutdown();
  });

  this.init()
  return this
}

// Inherit from EventEmitter
Object.setPrototypeOf(ClientRegister.prototype, EventEmitter.prototype);

ClientRegister.prototype.debug = {
  log: debug('microservice-router-register:log'),
  debug: debug('microservice-router-register:debug'),
};

ClientRegister.prototype.shutdown = function () {
  this.isTerminating = true;

  if(this.collectInterval) {
    clearInterval(this.collectInterval)
  }
  if(this.reportInterval) {
    clearInterval(this.reportInterval)
  }

  if (this.authData) {
    this.debug.log('deleteRegister', process.pid);
    this.client.delete(this.authData.id, this.authData.token).then((response) => {
      this.authData = false;
      this.debug.log('deleted from router');
    });
  }
};

ClientRegister.prototype.init = function () {
  if (this.cluster.isWorker) {
    this.debug.debug('Cluster child detected');
    this.collectInterval = setInterval(()=> { 
      if (this.isTerminating) {
        return;
      }
      this.collectStat()
    }, this.server.period)
  } else {
    this.debug.debug('Master detected');
    this.reportInterval = setInterval(()=> { 
      if (this.isTerminating) {
        return;
      }
      this.reportStats()
    }, this.server.period)
    this.cluster.on('message', (worker, message) => {
      this.debug.debug('Received message %O', message);
      let nowTime = Date.now();
      // if we received
      if (message.type && message.message && message.workerPID) {
        if (message.type == 'mfw_stats') {
          if (!this.receivedStats[message.workerPID]) {
            this.receivedStats[message.workerPID] = {
              workerID: message.workerID,
            };
          }
          this.receivedStats[message.workerPID].stats = message.message;
          this.receivedStats[message.workerPID].time = nowTime;
        }
      }
      this.debug.debug('Delete old stats from dead workers');
      for (let workerPID in this.receivedStats) {
        // add extra 1sec to compare due to milisecs diference on time period
        if (this.receivedStats[workerPID].time < nowTime - this.server.period - 1000) {
          this.debug.debug('remove workerPID', workerPID, this.receivedStats[workerPID], nowTime - this.server.period);
          delete this.receivedStats[workerPID];
          continue;
        }
      }
    });
  }
}

ClientRegister.prototype.collectStat = function () {
  this.debug.debug('collect via process memoryUsage & cpuUsage', process.pid);
  let cpuPercent = '0';
  
  if (!this.receivedStats || !this.receivedStats[process.pid]) {
    this.cpuUsage = process.cpuUsage();
    cpuPercent = (100 * (this.cpuUsage.user + this.cpuUsage.system)) / process.uptime() / 1000000;
    cpuPercent = cpuPercent.toFixed(2);
  } else {
    let timePeriod = Date.now() - this.receivedStats[process.pid].time;
    this.cpuUsage = process.cpuUsage(this.cpuUsage);
    cpuPercent = (100 * (this.cpuUsage.user + this.cpuUsage.system)) / timePeriod / 1000;
    cpuPercent = cpuPercent.toFixed(2);
  }

  let stat = {
    memory: process.memoryUsage().rss / 1024 / 1024,
    loadavg: os.loadavg(),
    cpu: cpuPercent,
  };

  let message = {
    type: 'mfw_stats',
    workerPID: process.pid,
    message: stat,
  };

  if (this.cluster.isWorker) {
    message.workerID = this.cluster.worker.id;
    process.send(message);
  } else {
    // just save data
    if (!this.receivedStats[message.workerPID]) {
      this.receivedStats[message.workerPID] = {
        workerID: message.workerID,
      };
    }
    this.receivedStats[message.workerPID].stats = message.message;
    this.receivedStats[message.workerPID].time = Date.now();
  }
  if (!this.cluster.workers) {
    this.debug.debug('not workers send %s.', message.toString(), process.pid);
    process.send(message);
  } else {
    this.debug.debug('Broadcast message to workers %s.', message.toString());
    for (var key in this.cluster.workers) {
      this.cluster.workers[key].send(message);
    }
  }
};


/**
 * Report Stats.
 */
ClientRegister.prototype.reportStats = function () {
  this.debug.debug('report stats');
  
  var receivedStats = [];
  for (let workerPID in this.receivedStats) {
    receivedStats.push(this.receivedStats[workerPID].stats);
  }
  this.debug.debug('reportTimeout triggered', receivedStats);
  if (!this.authData) {
    this.debug.debug('register on router');
    var router = this.route;
    router.metrics = receivedStats;
    if (!router.scope && process.env.SCOPE) {
      router.scope = process.env.SCOPE;
    }
    this.client.post(router).then((response) => {
      if (response.error) {
        this.debug.log('Router server is not available.');
        this.debug.debug('Router responce %O.', err);
        return;
      }
      this.authData = response.answer;
    });
    return;
  }
  this.debug.debug('Update stats on router', this.authData);
  this.client.put(this.authData.id, this.authData.token, { metrics: receivedStats }).then((response) => {
    if (response.error) {
      this.authData = false;
      this.debug.log('Router server is not available.');
      this.debug.debug('Router responce %O', response.error);
      return this.reportStats();
    }
  });
};

export default ClientRegister;
