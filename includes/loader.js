import MicroserviceClient from '@microservice-framework/microservice-client';
import debugF from 'debug';

const debug = {
  debug: debugF('loader:debug'),
};

const getLoaderSettings = async function (name, headers, mfwHeaders) {
  let routerServer = new MicroserviceClient({
    URL: process.env.ROUTER_URL,
    secureKey: process.env.ROUTER_SECRET,
  });
  var searchQuery = {};
  searchQuery['provides.:' + name] = {
    $exists: true,
  };
  let response = await routerServer.search(searchQuery);

  if (response.error) {
    return {
      name: name,
      error: response.error,
    };
  }

  let routes = response.answer;

  if (!routes || !routes.length) {
    return {
      name: name,
      error: new Error('No route found for ' + name),
    };
  }

  if (routes[0].scope == process.env.SCOPE) {
    return {
      name: name,
      skip: true,
    };
  }

  let loaderURL = routes[0].path[0].split('/');
  let resultPath = [];
  for (var i in loaderURL) {
    if (loaderURL[i].charAt(0) == ':') {
      let urlItem = loaderURL[i].substr(1);
      if (mfwHeaders[urlItem]) {
        resultPath.push(mfwHeaders[urlItem]);
        continue;
      }
    }
    resultPath.push(loaderURL[i]);
  }
  if (process.env.ROUTER_PROXY_URL.charAt(process.env.ROUTER_PROXY_URL.length - 1) == '/') {
    resultPath = process.env.ROUTER_PROXY_URL + resultPath.join('/');
  } else {
    resultPath = process.env.ROUTER_PROXY_URL + '/' + resultPath.join('/');
  }
  var clientSettings = {
    URL: resultPath,
  };
  let accessToken = false;
  if (headers['Access-Token']) {
    accessToken = headers['Access-Token'];
  }
  if (accessToken) {
    clientSettings.accessToken = accessToken;
  } else {
    clientSettings.secureKey = routes[0].secureKey;
  }
  return {
    name: name,
    client: clientSettings,
    searchBy: routes[0].provides[':' + name],
  };
};

const findValue = async function (loader) {
  debug.debug('loader', loader);
  let msClient = new MicroserviceClient(loader.client);
  // Is secure key. Get will not work with secureKey
  if (loader.client.secureKey) {
    var searchQuery = {};
    switch (loader.searchBy.type) {
      case 'number': {
        searchQuery[loader.searchBy.field] = parseInt(loader.value);
        break;
      }
      case 'float': {
        searchQuery[loader.searchBy.field] = parseFloat(loader.value);
        break;
      }
      default: {
        searchQuery[loader.searchBy.field] = loader.value;
      }
    }
    let response = await msClient.search(searchQuery);
    if (response.error) {
      return response;
    }
    let answer = response.answer[0];
    response.answer = answer;
    debug.debug('loader:found', response);
    return response;
  }
  // Get doesn't work with secureKey, need only access Token
  return await msClient.get(loader.value);
};

export default async function (request) {
  let headers = request.headers;
  let mfwHeaders = {};
  let okResult = {};
  let errorResult = [];
  for (let header in headers) {
    if (header.substring(0, 4) == 'mfw-') {
      let name = header.substring(4);
      mfwHeaders[name] = headers[header];
      let loader = await getLoaderSettings.bind(this)(name, headers, mfwHeaders);
      if (loader.skip) {
        debug.debug('Skip %s %O', name, loader);
        continue;
      }
      if (loader.error) {
        debug.debug('Error %s %O', name, loader.error);
        errorResult.push({
          name: name,
          error: loader.error,
        });
        continue;
      }
      loader.value = mfwHeaders[name];
      let response = await findValue(loader);
      if (response.error) {
        debug.debug('Error %s %O', name, response.error);
        errorResult.push({
          name: name,
          error: response.error,
        });
        continue;
      }
      okResult[name] = response.answer;
    }
  }
  if (errorResult.length) {
    debug.debug('errorResult', errorResult);
    var errorMessage = 'Pre Load failed:\n';
    for (var i in errorResult) {
      var errorItem = errorResult[i];
      errorMessage = errorMessage + ' - ' + errorItem.name + ': ' + errorItem.error.message + '\n';
    }
    return { code: 403, message: errorMessage};
  }
  //assign preloaded
  debug.debug('okResult', okResult);
  for (var name in okResult) {
    request[name] = okResult[name];
  }
}
