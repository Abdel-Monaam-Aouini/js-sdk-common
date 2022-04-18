const { v1: uuidv1 } = require('uuid');
const { getContextKinds } = require('./context');

const errors = require('./errors');
const messages = require('./messages');
const utils = require('./utils');

const ldUserIdKey = 'ld:$anonUserId';

/**
 * Create an object which can process a context and populate any required keys
 * for transient objects.
 *
 * @param {Object} persistentStorage The persistent storage from which to store
 * and access persisted transient context keys.
 * @returns A TransientContextProcessor.
 */
function TransientContextProcessor(persistentStorage) {
  function getContextKeyIdString(kind) {
    if (kind === undefined || kind === null || kind === 'user') {
      return ldUserIdKey;
    }
    return `ld:$contextKey:${kind}`;
  }

  function getCachedContextKey(kind) {
    return persistentStorage.get(getContextKeyIdString(kind));
  }

  function setCachedContextKey(id, kind) {
    return persistentStorage.set(getContextKeyIdString(kind), id);
  }

  /**
   * Process a single kind context, or a single context within a multi-kind context.
   * @param {string} kind The kind of the context. Independent because the kind is not prevent
   * within a context in a multi-kind context.
   * @param {Object} context
   * @returns {Promise} a promise that resolves to a processed contexts, or rejects
   * a context which cannot be processed.
   */
  function processSingleKindContext(kind, context) {
    // We are working on a copy of an original context, so we want to re-assign
    // versus duplicating it again.

    /* eslint-disable no-param-reassign */
    if (context.key !== null && context.key !== undefined) {
      context.key = context.key.toString();
      return Promise.resolve(context);
    }

    const transient = ((kind === undefined || kind === null) && context.anonymous) || (kind && context.transient);
    // If it has no kind, then it is a legacy style user and is transient if 'anonymous' is set.
    // If it has a kind, then the attribute would be 'transient'.

    // The context did not have a key, so the context needs to be transient, if it
    // is not transient, then it is not valid.
    if (transient) {
      // If the key doesn't exist, then the persistent storage will resolve
      // with undefined.
      return getCachedContextKey(kind).then(cachedId => {
        if (cachedId) {
          context.key = cachedId;
          return context;
        } else {
          const id = uuidv1();
          context.key = id;
          return setCachedContextKey(id, kind).then(() => context);
        }
      });
    } else {
      return Promise.reject(new errors.LDInvalidUserError(messages.invalidUser()));
    }
    /* eslint-enable no-param-reassign */
  }

  /**
   * Process the context, returning a Promise that resolves to the processed context, or rejects if there is an error.
   * @param {Object} context
   * @returns {Promise} A promise which resolves to a processed context, or a rejection if the context cannot be
   * processed. The context should still be checked for overall validity after being processed.
   */
  this.processContext = context => {
    if (!context) {
      return Promise.reject(new errors.LDInvalidUserError(messages.userNotSpecified()));
    }

    const processedContext = utils.clone(context);

    if (context.kind === 'multi') {
      const kinds = getContextKinds(processedContext);

      return Promise.all(kinds.map(kind => processSingleKindContext(kind, processedContext[kind]))).then(
        () => processedContext
      );
    }
    return processSingleKindContext(context.kind, processedContext);
  };
}

module.exports = TransientContextProcessor;
