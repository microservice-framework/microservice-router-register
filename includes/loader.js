import LoaderClass from './loaderClass.js'
import debugF from "debug"

const debug = {
  log: debugF('loader:log'),
  debug: debugF('loader:debug')
};

export default async function(request) {
 //loader
  var preLoadValues = new LoaderClass(request.headers);
  debug.debug('loaderMicroservice:headers %O', request.headers);

  preLoadValues.on('error', function(result) {
    debug.debug('loaderMicroservice:error %O', result);

    var errorMessage = 'Pre Load failed:\n';
    for (var i in result) {
      var errorItem = result[i];
      errorMessage = errorMessage + ' - ' + errorItem.pairSearch.name
        + ': ' + errorItem.error.message + '\n';
    }
    return callback(new Error(errorMessage));
  });

  preLoadValues.on('done', function(result) {
    debug.debug('loaderMicroservice:done %O', result);
    if (result) {
      for (var name in result) {
        request[name] = result[name];
      }
    }
    callback(null);
  });

  preLoadValues.process();


  return preLoadValues;
}