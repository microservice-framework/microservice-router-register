# microservice-router-register

[![Gitter](https://img.shields.io/gitter/room/microservice-framework/chat.svg?style=flat-square)](https://gitter.im/microservice-framework/chat)
[![npm](https://img.shields.io/npm/dt/@microservice-framework/microservice-router-register.svg?style=flat-square)](https://www.npmjs.com/~microservice-framework)
[![microservice-frame.work](https://img.shields.io/badge/online%20docs-200-green.svg?style=flat-square)](http://microservice-frame.work)

Provide:
 - class `MicroserviceRouterRegister` to register microservice in microservice-router 
 - class `loaderClass` internal use only class. Help to load data from other service by provides option. 
 - function `clientViaRouter(path, accessToken, callback)` to access other microservices from microservice by url. accessToken is optional.
 - function `loaderMicroservice(method, jsonData, requestDetails, callback)` implements callback.loader for microservice-cluster. Automatically load to requestDetails.name values from path myservice/:name/subservice
 - function `loaderByList(list, accessToken, callback)` used by ws integration to make sure that accessToken has access to myservice/:name/subservice

```js
'use strict';

const Cluster = require('@microservice-framework/microservice-cluster');
const Microservice = require('@microservice-framework/microservice');
const MicroserviceRouterRegister = require('@microservice-framework/microservice-router-register');
const debugF = require('debug');

var debug = {
  log: debugF('proxy:log'),
  debug: debugF('proxy:debug')
};

require('dotenv').config();

var mservice = new Microservice({
  mongoUrl: process.env.MONGO_URL + process.env.MONGO_PREFIX + process.env.MONGO_OPTIONS,
  mongoTable: process.env.MONGO_TABLE,
  secureKey: process.env.SECURE_KEY,
  schema: process.env.SCHEMA
});

var mControlCluster = new Cluster({
  pid: process.env.PIDFILE,
  port: process.env.PORT,
  hostname: process.env.HOSTNAME,
  count: process.env.WORKERS,
  callbacks: {
    init: microserviceINIT,
    validate: mservice.validate,
    POST: mservice.post,
    GET: mservice.get,
    PUT: mservice.put,
    DELETE: mservice.delete,
    SEARCH: mservice.search
  }
});

/**
 * Init Handler.
 */
function microserviceINIT(cluster, worker, address) {
  if (worker.id == 1) {
    var mserviceRegister = new MicroserviceRouterRegister({
      server: {
        url: process.env.ROUTER_URL,
        secureKey: process.env.ROUTER_SECRET,
        period: process.env.ROUTER_PERIOD,
      },
      route: {
        path: [process.env.SELF_PATH],
        url: process.env.SELF_URL,
        secureKey: process.env.SECURE_KEY
      },
      cluster: cluster
    });
  }
}

```

Example .env file for service:

```
MONGO_URL="mongodb://%%MONGO_HOST%%/%%MONGO_DATABASE%%%%MONGO_OPTION%%"
MONGO_TABLE="owners"

SECURE_KEY="%%SECURE_KEY%%"

SCHEMA="myservice.json"

HOSTNAME="%%SERVER_IP%%"
PORT=%%PORT%%
WORKERS=2

PIDFILE=%%PIDS_DIR%%/myservice.pid
LOGFILE=%%LOGS_DIR%%/myservice.log


ROUTER_URL="https://%%APISERVER/admin/api/v1/"
ROUTER_PROXY_URL="https://%%APISERVER/api/v1/"
ROUTER_SECRET=%%ROUTER_SECRET%%
ROUTER_PERIOD=3000

SELF_PATH="myservice"
SELF_URL="http://%%SERVER_IP%%:%%PORT%%/"

SCOPE="myservice"

```

Example schema/myservice.json

```json
{
  "id": "/MyService",
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "description": "Name.",
      "required": true
    },
    "profile": {
      "type": "array",
      "items": {
          "type": "object",
          "properties": {
              "title": {
                "type": "string",
                "required": true
              },
              "value": {
                "type": "string",
                "required": true
              }
          },
          "additionalProperties": false
      },
      "minItems": 1
    }
  }
}

```

Replace %%NAME%% with your values

For more details please check our [website](http://microservice-frame.work)

## Changelog

- 1.3.0
  - preparing switch from access_token header to 'Access-Token'
  
