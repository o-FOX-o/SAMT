const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const shim = fs.readFileSync(path.join(__dirname, '../web/runtime-compat.js'), 'utf8');
const context = vm.createContext({});
const run = source => vm.runInContext(source, context);
const json = source => JSON.parse(run(`JSON.stringify(${source})`));
run('delete Object.fromEntries; delete Array.prototype.flat; delete Array.prototype.flatMap; delete this.globalThis;');
vm.runInContext(shim, context);

assert.equal(run('globalThis === this'), true, 'globalThis points to the WebView global');
assert.deepEqual(json('Object.fromEntries(new Map([["first", 1], ["second", 2]]))'), { first: 1, second: 2 });
assert.equal(run('Object.fromEntries([["first", 1], ["first", 3]]).first'), 3, 'last duplicate entry wins');
assert.equal(run('Object.getPrototypeOf(Object.fromEntries([["__proto__", 7]])) === Object.prototype'), true, 'keys cannot change the object prototype');
assert.equal(run('Object.fromEntries([["__proto__", 7]]).__proto__'), 7);
assert.equal(run('(function () { var key = Symbol("key"); return Object.fromEntries([[key, 9]])[key]; })()'), 9, 'symbol keys survive');
assert.throws(() => run('Object.fromEntries(null)'), { name: 'TypeError' });
assert.throws(() => run('Object.fromEntries([1])'), { name: 'TypeError' });
assert.equal(run('(function () { var closed = false; function* entries() { try { yield 1; } finally { closed = true; } } try { Object.fromEntries(entries()); } catch (error) {} return closed; })()'), true, 'invalid entries close their iterator');

assert.deepEqual(json('[1, [2, [3]]].flat()'), [1, 2, [3]], 'default depth is one');
assert.deepEqual(json('[1, [2, [3]]].flat(Infinity)'), [1, 2, 3]);
assert.deepEqual(json('[1, [2]].flat(-1)'), [1, [2]], 'negative depth does not flatten');
assert.deepEqual(json('[1, [2, [3]]].flat("1.9")'), [1, 2, [3]], 'depth is converted to an integer');
assert.deepEqual(json('[, 1, [, 2], [[3]]].flat(2)'), [1, 2, 3], 'holes are omitted at every flattened depth');
assert.deepEqual(json('Array.prototype.flat.call({0: [1, 2], 2: 3, length: 3})'), [1, 2, 3], 'array-like receivers work');
assert.deepEqual(json('Array.prototype.flat.call({0: [1], length: -1})'), [], 'negative lengths are empty');
assert.throws(() => run('Array.prototype.flat.call(null)'), { name: 'TypeError' });

assert.deepEqual(json('[1, 2].flatMap(function (value) { return [value, [value + 1]]; })'), [1, [2], 2, [3]], 'flatMap flattens one level');
assert.deepEqual(json('(function () { var calls = []; var values = [, 2, 3]; var result = values.flatMap(function (value, index, source) { calls.push([index, source === values]); return [value * this.factor]; }, {factor: 2}); return {result: result, calls: calls}; })()'), { result: [4, 6], calls: [[1, true], [2, true]] }, 'flatMap skips holes and supplies callback arguments and thisArg');
assert.deepEqual(json('Array.prototype.flatMap.call({0: 2, length: 1}, function (value) { return [value, value + 1]; })'), [2, 3]);
assert.throws(() => run('[1].flatMap(null)'), { name: 'TypeError' });
assert.throws(() => run('Array.prototype.flatMap.call(undefined, function () {})'), { name: 'TypeError' });
assert.deepEqual(json('[Object.getOwnPropertyDescriptor(this, "globalThis").enumerable, Object.getOwnPropertyDescriptor(Object, "fromEntries").enumerable, Object.getOwnPropertyDescriptor(Array.prototype, "flat").enumerable, Object.getOwnPropertyDescriptor(Array.prototype, "flatMap").enumerable]'), [false, false, false, false], 'shims are non-enumerable');

const nativeContext = vm.createContext({});
vm.runInContext('var nativeApis = [globalThis, Object.fromEntries, Array.prototype.flat, Array.prototype.flatMap];', nativeContext);
vm.runInContext(shim, nativeContext);
assert.equal(vm.runInContext('nativeApis[0] === globalThis && nativeApis[1] === Object.fromEntries && nativeApis[2] === Array.prototype.flat && nativeApis[3] === Array.prototype.flatMap', nativeContext), true, 'supported WebViews keep their native APIs');
console.log('PASS: old-WebView runtime shims, iterable keys, sparse arrays and callback semantics');
