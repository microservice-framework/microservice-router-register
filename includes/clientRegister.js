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

  this.settings = settings;
  this.cluster = settings.cluster;
  this.route = settings.route;
  this.authData = false;
  this.isNewAPI = false;
  this.cpuUsage = false;
  this.reportTimeout = false;
  this.isTerminating = false;
  this.intervals = [];
  this.timeouts = [];

  this.server = {
    url: process.env.ROUTER_URL,
    secureKey: process.env.ROUTER_SECRET,
    period: parseInt(process.env.ROUTER_PERIOD),
  };

  if (!this.server.period) {
    throw new Error('Priod need to be integer value');
  }

  this.init();

  this.client = new MicroserviceClient({
    URL: this.server.url,
    secureKey: this.server.secureKey,
  });
  this.on('timer2', () => {
    if (this.isTerminating) {
      return;
    }
    return this.collectStat();
  });
  this.on('timer', () => {
    if (this.isTerminating) {
      return;
    }
    this.collectStats();
  });

  this.on('report', (stats) => {
    if (this.isTerminating) {
      return;
    }
    this.reportStats(stats);
  });

  let shutDownAction = () => {};
  process.on('SIGINT', () => {
    this.isTerminating = true;
    shutDownAction();
  });
  process.on('SIGTERM', () => {
    this.isTerminating = true;
    shutDownAction();
  });
}

// Inherit from EventEmitter
Object.setPrototypeOf(ClientRegister.prototype, EventEmitter.prototype);

ClientRegister.prototype.debug = {
  log: debug('microservice-router-register:log'),
  debug: debug('microservice-router-register:debug'),
};
ClientRegister.prototype.shutdown = function () {
  this.isTerminating = true;
  if (this.intervals.length) {
    for (let i in this.intervals) {
      clearInterval(this.intervals[i]);
    }
  }
  if (this.timeouts.length) {
    for (let i in this.timeouts) {
      clearTimeout(this.timeouts[i]);
    }
  }
  if (this.authData) {
    this.debug.log('deleteRegister', process.pid, this.client);
    this.client.delete(this.authData.id, this.authData.token).then((response) => {
      this.authData = false;
      this.debug.log('deleted', err, answer);
    });
  }
};
ClientRegister.prototype.init = function () {
  if (!this.cluster.workers) {
    this.debug.debug('Cluster child detected');
    this.receivedStats = {};
    this.cluster.worker.on('message', (message) => {
      if (message.type && message.message && message.workerPID) {
        let nowTime = Date.now();
        this.debug.debug('Received message', message);
        if (message.type == 'mfw_stats') {
          if (!this.receivedStats[message.workerPID]) {
            this.receivedStats[message.workerPID] = {
              workerID: message.workerID,
            };
          }
          this.receivedStats[message.workerPID].stats = message.message;
          this.receivedStats[message.workerPID].time = nowTime;
        }
        // clean up old stats for pids that doesnot exists anymore
        let minID = 0;
        for (let workerPID in this.receivedStats) {
          this.debug.debug('minID', minID);
          // add extra 1sec to compare due to milisecs diference on time period
          if (this.receivedStats[workerPID].time < nowTime - this.server.period - 1000) {
            this.debug.debug('remove workerPID', workerPID, this.receivedStats[workerPID], nowTime - this.server.period);
            delete this.receivedStats[workerPID];
            continue;
          }
          if (minID == 0 && this.receivedStats[workerPID].workerID) {
            minID = this.receivedStats[workerPID].workerID;
          }

          if (this.receivedStats[workerPID].workerID) {
            if (minID > this.receivedStats[workerPID].workerID) {
              minID = this.receivedStats[workerPID].workerID;
            }
          }
        }
        this.debug.debug('Detect who should send', this.receivedStats, minID, this.cluster.worker.id);

        if (minID === this.cluster.worker.id) {
          if (!this.reportTimeout) {
            this.reportTimeout = setTimeout(() => {
              this.debug.debug('reportTimeout triggered', minID, this.cluster.worker.id, process.pid);
              var receivedStats = [];
              for (let workerPID in this.receivedStats) {
                receivedStats.push(this.receivedStats[workerPID].stats);
              }
              this.emit('report', receivedStats);
              this.reportTimeout = false;
            }, this.server.period);
            this.timeouts.push(this.reportTimeout);
          }
        }
      }
    });
    let timer2interval = setInterval(() => {
      if (this.isTerminating) {
        return;
      }
      this.emit('timer2');
      this.debug.debug('timer2 triggered');
    }, this.server.period);
    this.intervals.push(timer2interval);
  } else {
    this.debug.debug('isMaster code detected');
    // backward compatibility 1.x
    // we are inside cluster.isMaster
    // Detect if old module uses this code
    this.cluster.on('message', (worker, message) => {
      // if we received
      if (message.type && message.type == 'mfw_stats') {
        this.debug.debug('NewAPI detected');
        this.isNewAPI = true;
      }
    });
    let checkIn = this.server.period + 3000;
    this.debug.debug('check for failback in', checkIn);
    let failbackTimer = setTimeout(() => {
      this.debug.debug('prepare for failback');
      //failback to old API
      if (!this.isNewAPI) {
        this.debug.debug('old API detected');
        this.collectStats();
        let timerinterval = setInterval(() => {
          if (this.isTerminating) {
            return;
          }
          this.emit('timer');
          this.debug.debug('timer triggered');
        }, this.server.period);
        this.intervals.push(timerinterval);
        return;
      }
      // enable cluster.isMaster collection too.
      let timer2interval = setInterval(() => {
        if (this.isTerminating) {
          return;
        }
        this.emit('timer2');
        this.debug.debug('timer2 master triggered');
      }, this.server.period);
      this.intervals.push(timer2interval);
    }, checkIn);
    this.timeouts.push(failbackTimer);
  }
};

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
  if (this.cluster.worker) {
    message.workerID = this.cluster.worker.id;
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
ClientRegister.prototype.reportStats = function (stats) {
  this.debug.debug('report stats');
  if (!this.authData) {
    this.debug.debug('register on router');
    var router = this.route;
    router.metrics = stats;
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
  this.client.put(this.authData.id, this.authData.token, { metrics: stats }).then((response) => {
    if (response.error) {
      this.authData = false;
      this.debug.log('Router server is not available.');
      this.debug.debug('Router responce %O', response.error);
      return this.reportStats(stats);
    }
  });
};

export default ClientRegister;
