import MicroserviceClient from '@microservice-framework/microservice-client';
import debugF from 'debug';
var clientCache = {};

const debug = {
  log: debugF('client-search:log'),
  debug: debugF('client-search:debug'),
};

/**
 * Compare route to router.path items.
 */
function matchRoute(route, routeItem) {
  let routeItems = route.split('/');
  let paths = routeItem.path;

  for (let i in paths) {
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

    let pathItems = paths[i].split('/');
    if (pathItems.length != routeItems.length) {
      continue;
    }
    let fullPathMatched = true;
    for (let j = 0; j < routeItems.length; j++) {
      if (pathItems[j].charAt(0) == ':') {
        routeItem.matchVariables[pathItems[j].substring(1)] = routeItems[j];
      } else {
        if (routeItems[j] != pathItems[j]) {
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

  let availableRoutes = [];
  for (let i in routes) {
    if (routes[i].type && routes[i].type != 'handler') {
      continue;
    }
    routes[i].matchVariables = {};
    if (matchRoute(route, routes[i])) {
      availableRoutes.push(routes[i]);
    }
  }
  debug.debug('Available routes for %s %O', route, availableRoutes);
  if (availableRoutes.length == 0) {
    debug.debug('Not found for %s', route);
    throw new Error('Endpoint not found');
  }
  if (availableRoutes.length == 1) {
    return callback(null, availableRoutes.pop());
  }

  let random = Math.floor(Math.random() * availableRoutes.length + 1) - 1;
  debug.log(availableRoutes[random]);
  return callback(null, availableRoutes[random]);
}

export default async function (pathURL, accessToken) {
  if (clientCache[pathURL]) {
    return clientCache[pathURL];
  }

  let routerServer = new MicroserviceClient({
    URL: process.env.ROUTER_URL,
    secureKey: process.env.ROUTER_SECRET,
  });

  let routes = await routerServer.search({});
  if (routes.error) {
    return routes.error;
  }
  try {
    let router = FindTarget(routes, pathURL);
    let clientSettings = {
      URL: process.env.ROUTER_PROXY_URL + '/' + pathURL,
    };
    if (accessToken) {
      clientSettings.accessToken = accessToken;
    } else {
      clientSettings.secureKey = router.secureKey;
    }
    clientCache[pathURL] = new MicroserviceClient(clientSettings);
    return clientCache[pathURL];
  } catch (err) {
    return false;
  }
}
