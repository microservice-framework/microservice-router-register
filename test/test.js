import { ClientRegister, loader } from '../index.js';

import Microservice from '@microservice-framework/microservice';
import Cluster from '@microservice-framework/microservice-cluster';

// Load environment variables from .env file
import dotenv from 'dotenv';
dotenv.config();

// Create a new microservice
let ms = new Microservice({
  mongoUrl: process.env.MONGO_URL,
  mongoDB: process.env.MONGO_DB,
  schema: process.env.SCHEMA,
  mongoTable: process.env.MONGO_TABLE,
  secureKey: process.env.SECURE_KEY,
});

const cluster = new Cluster({
  loader: async function (request) {
    console.log('loader', request);
    let answer = await loader(request);
    console.log('loader:status', answer);
    request.test = true;
    return false;
  },
  singleton: RegisterLoader,
  init: function (callback) {
    callback({ test: 1 });
    console.log('init');
  },
  shutdown: function (init) {
    console.log('shutdown', init);
    process.exit(0);
  },
  validate: ms.validate.bind(ms),
  methods: {
    POST: ms.post.bind(ms),
    GET: ms.get.bind(ms),
    PUT: ms.put.bind(ms),
    DELETE: ms.delete.bind(ms),
    SEARCH: async function(data, request) {

      if(request.eh) {
        console.log('eh!', request.eh)
      }

      return ms.search(data, request)
    },
    OPTIONS: ms.options.bind(ms),
    //PATCH: ms.aggregate.bind(ms),
  },
});

function RegisterLoader(isStart, variables) {
  //console.log('this', this)
  let cluster = this;
  if (isStart) {
    let register = new ClientRegister({
      route: {
        path: [process.env.SELF_PATH, 'eh/:eh/test'],
        url: process.env.SELF_URL,
        secureKey: process.env.SECURE_KEY,
      },
      cluster: cluster.cluster,
    });
    variables({ register: register });
  } else {
    variables.register.shutdown();
  }
}
