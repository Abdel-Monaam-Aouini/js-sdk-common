import * as errors from './errors';
import * as utils from './utils';

const MAX_URL_LENGTH = 2000;

export default function EventSender(platform, environmentId, options) {
  const imageUrlPath = '/a/' + environmentId + '.gif';
  const headers = utils.extend(
    {
      'Content-Type': 'application/json',
      'X-LaunchDarkly-Event-Schema': '3',
    },
    utils.getLDHeaders(platform, options)
  );
  const httpFallbackPing = platform.httpFallbackPing; // this will be set for us if we're in the browsr SDK
  const sender = {};

  function getResponseInfo(result) {
    const ret = { status: result.status };
    const dateStr = result.header('date');
    if (dateStr) {
      const time = Date.parse(dateStr);
      if (time) {
        ret.serverTime = time;
      }
    }
    return ret;
  }

  sender.sendChunk = (events, url, usePost) => {
    const jsonBody = JSON.stringify(events);

    function doPostRequest(canRetry) {
      return platform
        .httpRequest('POST', url, headers, jsonBody)
        .promise.then(result => {
          if (!result) {
            // This was a response from a fire-and-forget request, so we won't have a status.
            return;
          }
          if (result.status >= 400 && errors.isHttpErrorRecoverable(result.status) && canRetry) {
            return doPostRequest(false);
          } else {
            return getResponseInfo(result);
          }
        })
        .catch(() => {
          if (canRetry) {
            return doPostRequest(false);
          }
          return Promise.reject();
        });
    }

    if (usePost) {
      return doPostRequest(true).catch(() => {});
    } else {
      httpFallbackPing && httpFallbackPing(url + imageUrlPath + '?d=' + utils.base64URLEncode(jsonBody));
      return Promise.resolve(); // we don't wait for this request to complete, it's just a one-way ping
    }
  };

  sender.sendEvents = function(events, url) {
    if (!platform.httpRequest) {
      return Promise.resolve();
    }
    const canPost = platform.httpAllowsPost();
    let chunks;
    if (canPost) {
      // no need to break up events into chunks if we can send a POST
      chunks = [events];
    } else {
      chunks = utils.chunkUserEventsForUrl(MAX_URL_LENGTH - url.length, events);
    }
    const results = [];
    for (let i = 0; i < chunks.length; i++) {
      results.push(sender.sendChunk(chunks[i], url, canPost));
    }
    return Promise.all(results);
  };

  return sender;
}
