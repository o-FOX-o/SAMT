// Runtime APIs used by the bundled app but missing from older Android WebViews.
// Keep this banner compatible with Chromium 58; esbuild does not transform it.
(function (root) {
  'use strict';

  function define(target, name, value) {
    Object.defineProperty(target, name, { value: value, writable: true, configurable: true });
  }

  if (typeof root.globalThis === 'undefined') define(root, 'globalThis', root);

  if (typeof Object.fromEntries !== 'function') {
    define(Object, 'fromEntries', function (iterable) {
      if (iterable == null || typeof iterable[Symbol.iterator] !== 'function') {
        throw new TypeError('Object.fromEntries requires an iterable.');
      }
      var iterator = iterable[Symbol.iterator]();
      var result = {};
      try {
        while (true) {
          var step = iterator.next();
          if (Object(step) !== step) throw new TypeError('Invalid iterator result.');
          if (step.done) return result;
          var entry = step.value;
          if (Object(entry) !== entry) throw new TypeError('Invalid entry.');
          Object.defineProperty(result, entry[0], {
            value: entry[1], writable: true, enumerable: true, configurable: true
          });
        }
      } catch (error) {
        // Close generators when an entry fails, preserving the original error.
        try { if (typeof iterator.return === 'function') iterator.return(); } catch (ignored) {}
        throw error;
      }
    });
  }

  function integer(value) {
    var number = Number(value);
    if (number !== number || number === 0) return 0;
    return number < 0 ? -Math.floor(-number) : Math.floor(number);
  }

  function length(value) {
    return Math.min(Math.max(integer(value), 0), 9007199254740991);
  }

  function sourceObject(value) {
    if (value == null) throw new TypeError('Array method called on null or undefined.');
    return Object(value);
  }

  function flatten(result, source, sourceLength, depth, mapper, thisArg) {
    for (var index = 0; index < sourceLength; index++) {
      if (!(index in source)) continue;
      var item = source[index];
      if (mapper) item = mapper.call(thisArg, item, index, source);
      if (depth > 0 && Array.isArray(item)) {
        flatten(result, item, length(item.length), depth - 1);
      } else {
        if (result.length >= 9007199254740991) throw new TypeError('Flattened array is too large.');
        result.push(item);
      }
    }
    return result;
  }

  if (typeof Array.prototype.flat !== 'function') {
    define(Array.prototype, 'flat', function (depth) {
      var source = sourceObject(this);
      var sourceLength = length(source.length);
      return flatten([], source, sourceLength, depth === undefined ? 1 : integer(depth));
    });
  }

  if (typeof Array.prototype.flatMap !== 'function') {
    define(Array.prototype, 'flatMap', function (mapper, thisArg) {
      var source = sourceObject(this);
      var sourceLength = length(source.length);
      if (typeof mapper !== 'function') throw new TypeError('flatMap requires a function.');
      return flatten([], source, sourceLength, 1, mapper, thisArg);
    });
  }
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : this);
