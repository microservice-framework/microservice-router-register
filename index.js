import LoaderClass from 'includes/loaderClass'
import clientByPath from './includes/clientByPath.js';
export default {
  Register,
  loader,
  LoaderClass,
  clientByPath,
}

const MicroserviceRouterRegister = require(framework + '/microservice-router-register').register;
const loaderMfw = require(framework + '/microservice-router-register').loaderMicroservice;
const ObjectID = require('mongodb').ObjectID;
const clientViaRouter = require(framework + '/microservice-router-register').clientViaRouter;