"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/.pnpm/papaparse@5.4.1/node_modules/papaparse/papaparse.js
var require_papaparse = __commonJS({
  "node_modules/.pnpm/papaparse@5.4.1/node_modules/papaparse/papaparse.js"(exports2, module2) {
    (function(root, factory) {
      if (typeof define === "function" && define.amd) {
        define([], factory);
      } else if (typeof module2 === "object" && typeof exports2 !== "undefined") {
        module2.exports = factory();
      } else {
        root.Papa = factory();
      }
    })(exports2, function moduleFactory() {
      "use strict";
      var global = (function() {
        if (typeof self !== "undefined") {
          return self;
        }
        if (typeof window !== "undefined") {
          return window;
        }
        if (typeof global !== "undefined") {
          return global;
        }
        return {};
      })();
      function getWorkerBlob() {
        var URL = global.URL || global.webkitURL || null;
        var code = moduleFactory.toString();
        return Papa3.BLOB_URL || (Papa3.BLOB_URL = URL.createObjectURL(new Blob(["var global = (function() { if (typeof self !== 'undefined') { return self; } if (typeof window !== 'undefined') { return window; } if (typeof global !== 'undefined') { return global; } return {}; })(); global.IS_PAPA_WORKER=true; ", "(", code, ")();"], { type: "text/javascript" })));
      }
      var IS_WORKER = !global.document && !!global.postMessage, IS_PAPA_WORKER = global.IS_PAPA_WORKER || false;
      var workers = {}, workerIdCounter = 0;
      var Papa3 = {};
      Papa3.parse = CsvToJson;
      Papa3.unparse = JsonToCsv;
      Papa3.RECORD_SEP = String.fromCharCode(30);
      Papa3.UNIT_SEP = String.fromCharCode(31);
      Papa3.BYTE_ORDER_MARK = "\uFEFF";
      Papa3.BAD_DELIMITERS = ["\r", "\n", '"', Papa3.BYTE_ORDER_MARK];
      Papa3.WORKERS_SUPPORTED = !IS_WORKER && !!global.Worker;
      Papa3.NODE_STREAM_INPUT = 1;
      Papa3.LocalChunkSize = 1024 * 1024 * 10;
      Papa3.RemoteChunkSize = 1024 * 1024 * 5;
      Papa3.DefaultDelimiter = ",";
      Papa3.Parser = Parser;
      Papa3.ParserHandle = ParserHandle;
      Papa3.NetworkStreamer = NetworkStreamer;
      Papa3.FileStreamer = FileStreamer;
      Papa3.StringStreamer = StringStreamer;
      Papa3.ReadableStreamStreamer = ReadableStreamStreamer;
      if (typeof PAPA_BROWSER_CONTEXT === "undefined") {
        Papa3.DuplexStreamStreamer = DuplexStreamStreamer;
      }
      if (global.jQuery) {
        var $ = global.jQuery;
        $.fn.parse = function(options) {
          var config = options.config || {};
          var queue = [];
          this.each(function(idx) {
            var supported = $(this).prop("tagName").toUpperCase() === "INPUT" && $(this).attr("type").toLowerCase() === "file" && global.FileReader;
            if (!supported || !this.files || this.files.length === 0)
              return true;
            for (var i = 0; i < this.files.length; i++) {
              queue.push({
                file: this.files[i],
                inputElem: this,
                instanceConfig: $.extend({}, config)
              });
            }
          });
          parseNextFile();
          return this;
          function parseNextFile() {
            if (queue.length === 0) {
              if (isFunction(options.complete))
                options.complete();
              return;
            }
            var f = queue[0];
            if (isFunction(options.before)) {
              var returned = options.before(f.file, f.inputElem);
              if (typeof returned === "object") {
                if (returned.action === "abort") {
                  error("AbortError", f.file, f.inputElem, returned.reason);
                  return;
                } else if (returned.action === "skip") {
                  fileComplete();
                  return;
                } else if (typeof returned.config === "object")
                  f.instanceConfig = $.extend(f.instanceConfig, returned.config);
              } else if (returned === "skip") {
                fileComplete();
                return;
              }
            }
            var userCompleteFunc = f.instanceConfig.complete;
            f.instanceConfig.complete = function(results) {
              if (isFunction(userCompleteFunc))
                userCompleteFunc(results, f.file, f.inputElem);
              fileComplete();
            };
            Papa3.parse(f.file, f.instanceConfig);
          }
          function error(name, file, elem, reason) {
            if (isFunction(options.error))
              options.error({ name }, file, elem, reason);
          }
          function fileComplete() {
            queue.splice(0, 1);
            parseNextFile();
          }
        };
      }
      if (IS_PAPA_WORKER) {
        global.onmessage = workerThreadReceivedMessage;
      }
      function CsvToJson(_input, _config) {
        _config = _config || {};
        var dynamicTyping = _config.dynamicTyping || false;
        if (isFunction(dynamicTyping)) {
          _config.dynamicTypingFunction = dynamicTyping;
          dynamicTyping = {};
        }
        _config.dynamicTyping = dynamicTyping;
        _config.transform = isFunction(_config.transform) ? _config.transform : false;
        if (_config.worker && Papa3.WORKERS_SUPPORTED) {
          var w = newWorker();
          w.userStep = _config.step;
          w.userChunk = _config.chunk;
          w.userComplete = _config.complete;
          w.userError = _config.error;
          _config.step = isFunction(_config.step);
          _config.chunk = isFunction(_config.chunk);
          _config.complete = isFunction(_config.complete);
          _config.error = isFunction(_config.error);
          delete _config.worker;
          w.postMessage({
            input: _input,
            config: _config,
            workerId: w.id
          });
          return;
        }
        var streamer = null;
        if (_input === Papa3.NODE_STREAM_INPUT && typeof PAPA_BROWSER_CONTEXT === "undefined") {
          streamer = new DuplexStreamStreamer(_config);
          return streamer.getStream();
        } else if (typeof _input === "string") {
          _input = stripBom(_input);
          if (_config.download)
            streamer = new NetworkStreamer(_config);
          else
            streamer = new StringStreamer(_config);
        } else if (_input.readable === true && isFunction(_input.read) && isFunction(_input.on)) {
          streamer = new ReadableStreamStreamer(_config);
        } else if (global.File && _input instanceof File || _input instanceof Object)
          streamer = new FileStreamer(_config);
        return streamer.stream(_input);
        function stripBom(string) {
          if (string.charCodeAt(0) === 65279) {
            return string.slice(1);
          }
          return string;
        }
      }
      function JsonToCsv(_input, _config) {
        var _quotes = false;
        var _writeHeader = true;
        var _delimiter = ",";
        var _newline = "\r\n";
        var _quoteChar = '"';
        var _escapedQuote = _quoteChar + _quoteChar;
        var _skipEmptyLines = false;
        var _columns = null;
        var _escapeFormulae = false;
        unpackConfig();
        var quoteCharRegex = new RegExp(escapeRegExp(_quoteChar), "g");
        if (typeof _input === "string")
          _input = JSON.parse(_input);
        if (Array.isArray(_input)) {
          if (!_input.length || Array.isArray(_input[0]))
            return serialize(null, _input, _skipEmptyLines);
          else if (typeof _input[0] === "object")
            return serialize(_columns || Object.keys(_input[0]), _input, _skipEmptyLines);
        } else if (typeof _input === "object") {
          if (typeof _input.data === "string")
            _input.data = JSON.parse(_input.data);
          if (Array.isArray(_input.data)) {
            if (!_input.fields)
              _input.fields = _input.meta && _input.meta.fields || _columns;
            if (!_input.fields)
              _input.fields = Array.isArray(_input.data[0]) ? _input.fields : typeof _input.data[0] === "object" ? Object.keys(_input.data[0]) : [];
            if (!Array.isArray(_input.data[0]) && typeof _input.data[0] !== "object")
              _input.data = [_input.data];
          }
          return serialize(_input.fields || [], _input.data || [], _skipEmptyLines);
        }
        throw new Error("Unable to serialize unrecognized input");
        function unpackConfig() {
          if (typeof _config !== "object")
            return;
          if (typeof _config.delimiter === "string" && !Papa3.BAD_DELIMITERS.filter(function(value) {
            return _config.delimiter.indexOf(value) !== -1;
          }).length) {
            _delimiter = _config.delimiter;
          }
          if (typeof _config.quotes === "boolean" || typeof _config.quotes === "function" || Array.isArray(_config.quotes))
            _quotes = _config.quotes;
          if (typeof _config.skipEmptyLines === "boolean" || typeof _config.skipEmptyLines === "string")
            _skipEmptyLines = _config.skipEmptyLines;
          if (typeof _config.newline === "string")
            _newline = _config.newline;
          if (typeof _config.quoteChar === "string")
            _quoteChar = _config.quoteChar;
          if (typeof _config.header === "boolean")
            _writeHeader = _config.header;
          if (Array.isArray(_config.columns)) {
            if (_config.columns.length === 0) throw new Error("Option columns is empty");
            _columns = _config.columns;
          }
          if (_config.escapeChar !== void 0) {
            _escapedQuote = _config.escapeChar + _quoteChar;
          }
          if (typeof _config.escapeFormulae === "boolean" || _config.escapeFormulae instanceof RegExp) {
            _escapeFormulae = _config.escapeFormulae instanceof RegExp ? _config.escapeFormulae : /^[=+\-@\t\r].*$/;
          }
        }
        function serialize(fields, data, skipEmptyLines) {
          var csv2 = "";
          if (typeof fields === "string")
            fields = JSON.parse(fields);
          if (typeof data === "string")
            data = JSON.parse(data);
          var hasHeader = Array.isArray(fields) && fields.length > 0;
          var dataKeyedByField = !Array.isArray(data[0]);
          if (hasHeader && _writeHeader) {
            for (var i = 0; i < fields.length; i++) {
              if (i > 0)
                csv2 += _delimiter;
              csv2 += safe(fields[i], i);
            }
            if (data.length > 0)
              csv2 += _newline;
          }
          for (var row = 0; row < data.length; row++) {
            var maxCol = hasHeader ? fields.length : data[row].length;
            var emptyLine = false;
            var nullLine = hasHeader ? Object.keys(data[row]).length === 0 : data[row].length === 0;
            if (skipEmptyLines && !hasHeader) {
              emptyLine = skipEmptyLines === "greedy" ? data[row].join("").trim() === "" : data[row].length === 1 && data[row][0].length === 0;
            }
            if (skipEmptyLines === "greedy" && hasHeader) {
              var line = [];
              for (var c = 0; c < maxCol; c++) {
                var cx = dataKeyedByField ? fields[c] : c;
                line.push(data[row][cx]);
              }
              emptyLine = line.join("").trim() === "";
            }
            if (!emptyLine) {
              for (var col = 0; col < maxCol; col++) {
                if (col > 0 && !nullLine)
                  csv2 += _delimiter;
                var colIdx = hasHeader && dataKeyedByField ? fields[col] : col;
                csv2 += safe(data[row][colIdx], col);
              }
              if (row < data.length - 1 && (!skipEmptyLines || maxCol > 0 && !nullLine)) {
                csv2 += _newline;
              }
            }
          }
          return csv2;
        }
        function safe(str, col) {
          if (typeof str === "undefined" || str === null)
            return "";
          if (str.constructor === Date)
            return JSON.stringify(str).slice(1, 25);
          var needsQuotes = false;
          if (_escapeFormulae && typeof str === "string" && _escapeFormulae.test(str)) {
            str = "'" + str;
            needsQuotes = true;
          }
          var escapedQuoteStr = str.toString().replace(quoteCharRegex, _escapedQuote);
          needsQuotes = needsQuotes || _quotes === true || typeof _quotes === "function" && _quotes(str, col) || Array.isArray(_quotes) && _quotes[col] || hasAny(escapedQuoteStr, Papa3.BAD_DELIMITERS) || escapedQuoteStr.indexOf(_delimiter) > -1 || escapedQuoteStr.charAt(0) === " " || escapedQuoteStr.charAt(escapedQuoteStr.length - 1) === " ";
          return needsQuotes ? _quoteChar + escapedQuoteStr + _quoteChar : escapedQuoteStr;
        }
        function hasAny(str, substrings) {
          for (var i = 0; i < substrings.length; i++)
            if (str.indexOf(substrings[i]) > -1)
              return true;
          return false;
        }
      }
      function ChunkStreamer(config) {
        this._handle = null;
        this._finished = false;
        this._completed = false;
        this._halted = false;
        this._input = null;
        this._baseIndex = 0;
        this._partialLine = "";
        this._rowCount = 0;
        this._start = 0;
        this._nextChunk = null;
        this.isFirstChunk = true;
        this._completeResults = {
          data: [],
          errors: [],
          meta: {}
        };
        replaceConfig.call(this, config);
        this.parseChunk = function(chunk, isFakeChunk) {
          if (this.isFirstChunk && isFunction(this._config.beforeFirstChunk)) {
            var modifiedChunk = this._config.beforeFirstChunk(chunk);
            if (modifiedChunk !== void 0)
              chunk = modifiedChunk;
          }
          this.isFirstChunk = false;
          this._halted = false;
          var aggregate = this._partialLine + chunk;
          this._partialLine = "";
          var results = this._handle.parse(aggregate, this._baseIndex, !this._finished);
          if (this._handle.paused() || this._handle.aborted()) {
            this._halted = true;
            return;
          }
          var lastIndex = results.meta.cursor;
          if (!this._finished) {
            this._partialLine = aggregate.substring(lastIndex - this._baseIndex);
            this._baseIndex = lastIndex;
          }
          if (results && results.data)
            this._rowCount += results.data.length;
          var finishedIncludingPreview = this._finished || this._config.preview && this._rowCount >= this._config.preview;
          if (IS_PAPA_WORKER) {
            global.postMessage({
              results,
              workerId: Papa3.WORKER_ID,
              finished: finishedIncludingPreview
            });
          } else if (isFunction(this._config.chunk) && !isFakeChunk) {
            this._config.chunk(results, this._handle);
            if (this._handle.paused() || this._handle.aborted()) {
              this._halted = true;
              return;
            }
            results = void 0;
            this._completeResults = void 0;
          }
          if (!this._config.step && !this._config.chunk) {
            this._completeResults.data = this._completeResults.data.concat(results.data);
            this._completeResults.errors = this._completeResults.errors.concat(results.errors);
            this._completeResults.meta = results.meta;
          }
          if (!this._completed && finishedIncludingPreview && isFunction(this._config.complete) && (!results || !results.meta.aborted)) {
            this._config.complete(this._completeResults, this._input);
            this._completed = true;
          }
          if (!finishedIncludingPreview && (!results || !results.meta.paused))
            this._nextChunk();
          return results;
        };
        this._sendError = function(error) {
          if (isFunction(this._config.error))
            this._config.error(error);
          else if (IS_PAPA_WORKER && this._config.error) {
            global.postMessage({
              workerId: Papa3.WORKER_ID,
              error,
              finished: false
            });
          }
        };
        function replaceConfig(config2) {
          var configCopy = copy(config2);
          configCopy.chunkSize = parseInt(configCopy.chunkSize);
          if (!config2.step && !config2.chunk)
            configCopy.chunkSize = null;
          this._handle = new ParserHandle(configCopy);
          this._handle.streamer = this;
          this._config = configCopy;
        }
      }
      function NetworkStreamer(config) {
        config = config || {};
        if (!config.chunkSize)
          config.chunkSize = Papa3.RemoteChunkSize;
        ChunkStreamer.call(this, config);
        var xhr;
        if (IS_WORKER) {
          this._nextChunk = function() {
            this._readChunk();
            this._chunkLoaded();
          };
        } else {
          this._nextChunk = function() {
            this._readChunk();
          };
        }
        this.stream = function(url) {
          this._input = url;
          this._nextChunk();
        };
        this._readChunk = function() {
          if (this._finished) {
            this._chunkLoaded();
            return;
          }
          xhr = new XMLHttpRequest();
          if (this._config.withCredentials) {
            xhr.withCredentials = this._config.withCredentials;
          }
          if (!IS_WORKER) {
            xhr.onload = bindFunction(this._chunkLoaded, this);
            xhr.onerror = bindFunction(this._chunkError, this);
          }
          xhr.open(this._config.downloadRequestBody ? "POST" : "GET", this._input, !IS_WORKER);
          if (this._config.downloadRequestHeaders) {
            var headers = this._config.downloadRequestHeaders;
            for (var headerName in headers) {
              xhr.setRequestHeader(headerName, headers[headerName]);
            }
          }
          if (this._config.chunkSize) {
            var end = this._start + this._config.chunkSize - 1;
            xhr.setRequestHeader("Range", "bytes=" + this._start + "-" + end);
          }
          try {
            xhr.send(this._config.downloadRequestBody);
          } catch (err) {
            this._chunkError(err.message);
          }
          if (IS_WORKER && xhr.status === 0)
            this._chunkError();
        };
        this._chunkLoaded = function() {
          if (xhr.readyState !== 4)
            return;
          if (xhr.status < 200 || xhr.status >= 400) {
            this._chunkError();
            return;
          }
          this._start += this._config.chunkSize ? this._config.chunkSize : xhr.responseText.length;
          this._finished = !this._config.chunkSize || this._start >= getFileSize(xhr);
          this.parseChunk(xhr.responseText);
        };
        this._chunkError = function(errorMessage) {
          var errorText = xhr.statusText || errorMessage;
          this._sendError(new Error(errorText));
        };
        function getFileSize(xhr2) {
          var contentRange = xhr2.getResponseHeader("Content-Range");
          if (contentRange === null) {
            return -1;
          }
          return parseInt(contentRange.substring(contentRange.lastIndexOf("/") + 1));
        }
      }
      NetworkStreamer.prototype = Object.create(ChunkStreamer.prototype);
      NetworkStreamer.prototype.constructor = NetworkStreamer;
      function FileStreamer(config) {
        config = config || {};
        if (!config.chunkSize)
          config.chunkSize = Papa3.LocalChunkSize;
        ChunkStreamer.call(this, config);
        var reader, slice;
        var usingAsyncReader = typeof FileReader !== "undefined";
        this.stream = function(file) {
          this._input = file;
          slice = file.slice || file.webkitSlice || file.mozSlice;
          if (usingAsyncReader) {
            reader = new FileReader();
            reader.onload = bindFunction(this._chunkLoaded, this);
            reader.onerror = bindFunction(this._chunkError, this);
          } else
            reader = new FileReaderSync();
          this._nextChunk();
        };
        this._nextChunk = function() {
          if (!this._finished && (!this._config.preview || this._rowCount < this._config.preview))
            this._readChunk();
        };
        this._readChunk = function() {
          var input = this._input;
          if (this._config.chunkSize) {
            var end = Math.min(this._start + this._config.chunkSize, this._input.size);
            input = slice.call(input, this._start, end);
          }
          var txt = reader.readAsText(input, this._config.encoding);
          if (!usingAsyncReader)
            this._chunkLoaded({ target: { result: txt } });
        };
        this._chunkLoaded = function(event) {
          this._start += this._config.chunkSize;
          this._finished = !this._config.chunkSize || this._start >= this._input.size;
          this.parseChunk(event.target.result);
        };
        this._chunkError = function() {
          this._sendError(reader.error);
        };
      }
      FileStreamer.prototype = Object.create(ChunkStreamer.prototype);
      FileStreamer.prototype.constructor = FileStreamer;
      function StringStreamer(config) {
        config = config || {};
        ChunkStreamer.call(this, config);
        var remaining;
        this.stream = function(s) {
          remaining = s;
          return this._nextChunk();
        };
        this._nextChunk = function() {
          if (this._finished) return;
          var size = this._config.chunkSize;
          var chunk;
          if (size) {
            chunk = remaining.substring(0, size);
            remaining = remaining.substring(size);
          } else {
            chunk = remaining;
            remaining = "";
          }
          this._finished = !remaining;
          return this.parseChunk(chunk);
        };
      }
      StringStreamer.prototype = Object.create(StringStreamer.prototype);
      StringStreamer.prototype.constructor = StringStreamer;
      function ReadableStreamStreamer(config) {
        config = config || {};
        ChunkStreamer.call(this, config);
        var queue = [];
        var parseOnData = true;
        var streamHasEnded = false;
        this.pause = function() {
          ChunkStreamer.prototype.pause.apply(this, arguments);
          this._input.pause();
        };
        this.resume = function() {
          ChunkStreamer.prototype.resume.apply(this, arguments);
          this._input.resume();
        };
        this.stream = function(stream) {
          this._input = stream;
          this._input.on("data", this._streamData);
          this._input.on("end", this._streamEnd);
          this._input.on("error", this._streamError);
        };
        this._checkIsFinished = function() {
          if (streamHasEnded && queue.length === 1) {
            this._finished = true;
          }
        };
        this._nextChunk = function() {
          this._checkIsFinished();
          if (queue.length) {
            this.parseChunk(queue.shift());
          } else {
            parseOnData = true;
          }
        };
        this._streamData = bindFunction(function(chunk) {
          try {
            queue.push(typeof chunk === "string" ? chunk : chunk.toString(this._config.encoding));
            if (parseOnData) {
              parseOnData = false;
              this._checkIsFinished();
              this.parseChunk(queue.shift());
            }
          } catch (error) {
            this._streamError(error);
          }
        }, this);
        this._streamError = bindFunction(function(error) {
          this._streamCleanUp();
          this._sendError(error);
        }, this);
        this._streamEnd = bindFunction(function() {
          this._streamCleanUp();
          streamHasEnded = true;
          this._streamData("");
        }, this);
        this._streamCleanUp = bindFunction(function() {
          this._input.removeListener("data", this._streamData);
          this._input.removeListener("end", this._streamEnd);
          this._input.removeListener("error", this._streamError);
        }, this);
      }
      ReadableStreamStreamer.prototype = Object.create(ChunkStreamer.prototype);
      ReadableStreamStreamer.prototype.constructor = ReadableStreamStreamer;
      function DuplexStreamStreamer(_config) {
        var Duplex = require("stream").Duplex;
        var config = copy(_config);
        var parseOnWrite = true;
        var writeStreamHasFinished = false;
        var parseCallbackQueue = [];
        var stream = null;
        this._onCsvData = function(results) {
          var data = results.data;
          if (!stream.push(data) && !this._handle.paused()) {
            this._handle.pause();
          }
        };
        this._onCsvComplete = function() {
          stream.push(null);
        };
        config.step = bindFunction(this._onCsvData, this);
        config.complete = bindFunction(this._onCsvComplete, this);
        ChunkStreamer.call(this, config);
        this._nextChunk = function() {
          if (writeStreamHasFinished && parseCallbackQueue.length === 1) {
            this._finished = true;
          }
          if (parseCallbackQueue.length) {
            parseCallbackQueue.shift()();
          } else {
            parseOnWrite = true;
          }
        };
        this._addToParseQueue = function(chunk, callback) {
          parseCallbackQueue.push(bindFunction(function() {
            this.parseChunk(typeof chunk === "string" ? chunk : chunk.toString(config.encoding));
            if (isFunction(callback)) {
              return callback();
            }
          }, this));
          if (parseOnWrite) {
            parseOnWrite = false;
            this._nextChunk();
          }
        };
        this._onRead = function() {
          if (this._handle.paused()) {
            this._handle.resume();
          }
        };
        this._onWrite = function(chunk, encoding, callback) {
          this._addToParseQueue(chunk, callback);
        };
        this._onWriteComplete = function() {
          writeStreamHasFinished = true;
          this._addToParseQueue("");
        };
        this.getStream = function() {
          return stream;
        };
        stream = new Duplex({
          readableObjectMode: true,
          decodeStrings: false,
          read: bindFunction(this._onRead, this),
          write: bindFunction(this._onWrite, this)
        });
        stream.once("finish", bindFunction(this._onWriteComplete, this));
      }
      if (typeof PAPA_BROWSER_CONTEXT === "undefined") {
        DuplexStreamStreamer.prototype = Object.create(ChunkStreamer.prototype);
        DuplexStreamStreamer.prototype.constructor = DuplexStreamStreamer;
      }
      function ParserHandle(_config) {
        var MAX_FLOAT = Math.pow(2, 53);
        var MIN_FLOAT = -MAX_FLOAT;
        var FLOAT = /^\s*-?(\d+\.?|\.\d+|\d+\.\d+)([eE][-+]?\d+)?\s*$/;
        var ISO_DATE = /^((\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z)))$/;
        var self2 = this;
        var _stepCounter = 0;
        var _rowCounter = 0;
        var _input;
        var _parser;
        var _paused = false;
        var _aborted = false;
        var _delimiterError;
        var _fields = [];
        var _results = {
          // The last results returned from the parser
          data: [],
          errors: [],
          meta: {}
        };
        if (isFunction(_config.step)) {
          var userStep = _config.step;
          _config.step = function(results) {
            _results = results;
            if (needsHeaderRow())
              processResults();
            else {
              processResults();
              if (_results.data.length === 0)
                return;
              _stepCounter += results.data.length;
              if (_config.preview && _stepCounter > _config.preview)
                _parser.abort();
              else {
                _results.data = _results.data[0];
                userStep(_results, self2);
              }
            }
          };
        }
        this.parse = function(input, baseIndex, ignoreLastRow) {
          var quoteChar = _config.quoteChar || '"';
          if (!_config.newline)
            _config.newline = guessLineEndings(input, quoteChar);
          _delimiterError = false;
          if (!_config.delimiter) {
            var delimGuess = guessDelimiter(input, _config.newline, _config.skipEmptyLines, _config.comments, _config.delimitersToGuess);
            if (delimGuess.successful)
              _config.delimiter = delimGuess.bestDelimiter;
            else {
              _delimiterError = true;
              _config.delimiter = Papa3.DefaultDelimiter;
            }
            _results.meta.delimiter = _config.delimiter;
          } else if (isFunction(_config.delimiter)) {
            _config.delimiter = _config.delimiter(input);
            _results.meta.delimiter = _config.delimiter;
          }
          var parserConfig = copy(_config);
          if (_config.preview && _config.header)
            parserConfig.preview++;
          _input = input;
          _parser = new Parser(parserConfig);
          _results = _parser.parse(_input, baseIndex, ignoreLastRow);
          processResults();
          return _paused ? { meta: { paused: true } } : _results || { meta: { paused: false } };
        };
        this.paused = function() {
          return _paused;
        };
        this.pause = function() {
          _paused = true;
          _parser.abort();
          _input = isFunction(_config.chunk) ? "" : _input.substring(_parser.getCharIndex());
        };
        this.resume = function() {
          if (self2.streamer._halted) {
            _paused = false;
            self2.streamer.parseChunk(_input, true);
          } else {
            setTimeout(self2.resume, 3);
          }
        };
        this.aborted = function() {
          return _aborted;
        };
        this.abort = function() {
          _aborted = true;
          _parser.abort();
          _results.meta.aborted = true;
          if (isFunction(_config.complete))
            _config.complete(_results);
          _input = "";
        };
        function testEmptyLine(s) {
          return _config.skipEmptyLines === "greedy" ? s.join("").trim() === "" : s.length === 1 && s[0].length === 0;
        }
        function testFloat(s) {
          if (FLOAT.test(s)) {
            var floatValue = parseFloat(s);
            if (floatValue > MIN_FLOAT && floatValue < MAX_FLOAT) {
              return true;
            }
          }
          return false;
        }
        function processResults() {
          if (_results && _delimiterError) {
            addError("Delimiter", "UndetectableDelimiter", "Unable to auto-detect delimiting character; defaulted to '" + Papa3.DefaultDelimiter + "'");
            _delimiterError = false;
          }
          if (_config.skipEmptyLines) {
            _results.data = _results.data.filter(function(d) {
              return !testEmptyLine(d);
            });
          }
          if (needsHeaderRow())
            fillHeaderFields();
          return applyHeaderAndDynamicTypingAndTransformation();
        }
        function needsHeaderRow() {
          return _config.header && _fields.length === 0;
        }
        function fillHeaderFields() {
          if (!_results)
            return;
          function addHeader(header, i2) {
            if (isFunction(_config.transformHeader))
              header = _config.transformHeader(header, i2);
            _fields.push(header);
          }
          if (Array.isArray(_results.data[0])) {
            for (var i = 0; needsHeaderRow() && i < _results.data.length; i++)
              _results.data[i].forEach(addHeader);
            _results.data.splice(0, 1);
          } else
            _results.data.forEach(addHeader);
        }
        function shouldApplyDynamicTyping(field) {
          if (_config.dynamicTypingFunction && _config.dynamicTyping[field] === void 0) {
            _config.dynamicTyping[field] = _config.dynamicTypingFunction(field);
          }
          return (_config.dynamicTyping[field] || _config.dynamicTyping) === true;
        }
        function parseDynamic(field, value) {
          if (shouldApplyDynamicTyping(field)) {
            if (value === "true" || value === "TRUE")
              return true;
            else if (value === "false" || value === "FALSE")
              return false;
            else if (testFloat(value))
              return parseFloat(value);
            else if (ISO_DATE.test(value))
              return new Date(value);
            else
              return value === "" ? null : value;
          }
          return value;
        }
        function applyHeaderAndDynamicTypingAndTransformation() {
          if (!_results || !_config.header && !_config.dynamicTyping && !_config.transform)
            return _results;
          function processRow(rowSource, i) {
            var row = _config.header ? {} : [];
            var j;
            for (j = 0; j < rowSource.length; j++) {
              var field = j;
              var value = rowSource[j];
              if (_config.header)
                field = j >= _fields.length ? "__parsed_extra" : _fields[j];
              if (_config.transform)
                value = _config.transform(value, field);
              value = parseDynamic(field, value);
              if (field === "__parsed_extra") {
                row[field] = row[field] || [];
                row[field].push(value);
              } else
                row[field] = value;
            }
            if (_config.header) {
              if (j > _fields.length)
                addError("FieldMismatch", "TooManyFields", "Too many fields: expected " + _fields.length + " fields but parsed " + j, _rowCounter + i);
              else if (j < _fields.length)
                addError("FieldMismatch", "TooFewFields", "Too few fields: expected " + _fields.length + " fields but parsed " + j, _rowCounter + i);
            }
            return row;
          }
          var incrementBy = 1;
          if (!_results.data.length || Array.isArray(_results.data[0])) {
            _results.data = _results.data.map(processRow);
            incrementBy = _results.data.length;
          } else
            _results.data = processRow(_results.data, 0);
          if (_config.header && _results.meta)
            _results.meta.fields = _fields;
          _rowCounter += incrementBy;
          return _results;
        }
        function guessDelimiter(input, newline, skipEmptyLines, comments, delimitersToGuess) {
          var bestDelim, bestDelta, fieldCountPrevRow, maxFieldCount;
          delimitersToGuess = delimitersToGuess || [",", "	", "|", ";", Papa3.RECORD_SEP, Papa3.UNIT_SEP];
          for (var i = 0; i < delimitersToGuess.length; i++) {
            var delim = delimitersToGuess[i];
            var delta = 0, avgFieldCount = 0, emptyLinesCount = 0;
            fieldCountPrevRow = void 0;
            var preview = new Parser({
              comments,
              delimiter: delim,
              newline,
              preview: 10
            }).parse(input);
            for (var j = 0; j < preview.data.length; j++) {
              if (skipEmptyLines && testEmptyLine(preview.data[j])) {
                emptyLinesCount++;
                continue;
              }
              var fieldCount = preview.data[j].length;
              avgFieldCount += fieldCount;
              if (typeof fieldCountPrevRow === "undefined") {
                fieldCountPrevRow = fieldCount;
                continue;
              } else if (fieldCount > 0) {
                delta += Math.abs(fieldCount - fieldCountPrevRow);
                fieldCountPrevRow = fieldCount;
              }
            }
            if (preview.data.length > 0)
              avgFieldCount /= preview.data.length - emptyLinesCount;
            if ((typeof bestDelta === "undefined" || delta <= bestDelta) && (typeof maxFieldCount === "undefined" || avgFieldCount > maxFieldCount) && avgFieldCount > 1.99) {
              bestDelta = delta;
              bestDelim = delim;
              maxFieldCount = avgFieldCount;
            }
          }
          _config.delimiter = bestDelim;
          return {
            successful: !!bestDelim,
            bestDelimiter: bestDelim
          };
        }
        function guessLineEndings(input, quoteChar) {
          input = input.substring(0, 1024 * 1024);
          var re = new RegExp(escapeRegExp(quoteChar) + "([^]*?)" + escapeRegExp(quoteChar), "gm");
          input = input.replace(re, "");
          var r = input.split("\r");
          var n = input.split("\n");
          var nAppearsFirst = n.length > 1 && n[0].length < r[0].length;
          if (r.length === 1 || nAppearsFirst)
            return "\n";
          var numWithN = 0;
          for (var i = 0; i < r.length; i++) {
            if (r[i][0] === "\n")
              numWithN++;
          }
          return numWithN >= r.length / 2 ? "\r\n" : "\r";
        }
        function addError(type, code, msg, row) {
          var error = {
            type,
            code,
            message: msg
          };
          if (row !== void 0) {
            error.row = row;
          }
          _results.errors.push(error);
        }
      }
      function escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }
      function Parser(config) {
        config = config || {};
        var delim = config.delimiter;
        var newline = config.newline;
        var comments = config.comments;
        var step = config.step;
        var preview = config.preview;
        var fastMode = config.fastMode;
        var quoteChar;
        if (config.quoteChar === void 0 || config.quoteChar === null) {
          quoteChar = '"';
        } else {
          quoteChar = config.quoteChar;
        }
        var escapeChar = quoteChar;
        if (config.escapeChar !== void 0) {
          escapeChar = config.escapeChar;
        }
        if (typeof delim !== "string" || Papa3.BAD_DELIMITERS.indexOf(delim) > -1)
          delim = ",";
        if (comments === delim)
          throw new Error("Comment character same as delimiter");
        else if (comments === true)
          comments = "#";
        else if (typeof comments !== "string" || Papa3.BAD_DELIMITERS.indexOf(comments) > -1)
          comments = false;
        if (newline !== "\n" && newline !== "\r" && newline !== "\r\n")
          newline = "\n";
        var cursor = 0;
        var aborted = false;
        this.parse = function(input, baseIndex, ignoreLastRow) {
          if (typeof input !== "string")
            throw new Error("Input must be a string");
          var inputLen = input.length, delimLen = delim.length, newlineLen = newline.length, commentsLen = comments.length;
          var stepIsFunction = isFunction(step);
          cursor = 0;
          var data = [], errors = [], row = [], lastCursor = 0;
          if (!input)
            return returnable();
          if (config.header && !baseIndex) {
            var firstLine = input.split(newline)[0];
            var headers = firstLine.split(delim);
            var separator = "_";
            var headerMap = [];
            var headerCount = {};
            var duplicateHeaders = false;
            for (var j in headers) {
              var header = headers[j];
              if (isFunction(config.transformHeader))
                header = config.transformHeader(header, j);
              var headerName = header;
              var count = headerCount[header] || 0;
              if (count > 0) {
                duplicateHeaders = true;
                headerName = header + separator + count;
              }
              headerCount[header] = count + 1;
              while (headerMap.includes(headerName)) {
                headerName = headerName + separator + count;
              }
              headerMap.push(headerName);
            }
            if (duplicateHeaders) {
              var editedInput = input.split(newline);
              editedInput[0] = headerMap.join(delim);
              input = editedInput.join(newline);
            }
          }
          if (fastMode || fastMode !== false && input.indexOf(quoteChar) === -1) {
            var rows = input.split(newline);
            for (var i = 0; i < rows.length; i++) {
              row = rows[i];
              cursor += row.length;
              if (i !== rows.length - 1)
                cursor += newline.length;
              else if (ignoreLastRow)
                return returnable();
              if (comments && row.substring(0, commentsLen) === comments)
                continue;
              if (stepIsFunction) {
                data = [];
                pushRow(row.split(delim));
                doStep();
                if (aborted)
                  return returnable();
              } else
                pushRow(row.split(delim));
              if (preview && i >= preview) {
                data = data.slice(0, preview);
                return returnable(true);
              }
            }
            return returnable();
          }
          var nextDelim = input.indexOf(delim, cursor);
          var nextNewline = input.indexOf(newline, cursor);
          var quoteCharRegex = new RegExp(escapeRegExp(escapeChar) + escapeRegExp(quoteChar), "g");
          var quoteSearch = input.indexOf(quoteChar, cursor);
          for (; ; ) {
            if (input[cursor] === quoteChar) {
              quoteSearch = cursor;
              cursor++;
              for (; ; ) {
                quoteSearch = input.indexOf(quoteChar, quoteSearch + 1);
                if (quoteSearch === -1) {
                  if (!ignoreLastRow) {
                    errors.push({
                      type: "Quotes",
                      code: "MissingQuotes",
                      message: "Quoted field unterminated",
                      row: data.length,
                      // row has yet to be inserted
                      index: cursor
                    });
                  }
                  return finish();
                }
                if (quoteSearch === inputLen - 1) {
                  var value = input.substring(cursor, quoteSearch).replace(quoteCharRegex, quoteChar);
                  return finish(value);
                }
                if (quoteChar === escapeChar && input[quoteSearch + 1] === escapeChar) {
                  quoteSearch++;
                  continue;
                }
                if (quoteChar !== escapeChar && quoteSearch !== 0 && input[quoteSearch - 1] === escapeChar) {
                  continue;
                }
                if (nextDelim !== -1 && nextDelim < quoteSearch + 1) {
                  nextDelim = input.indexOf(delim, quoteSearch + 1);
                }
                if (nextNewline !== -1 && nextNewline < quoteSearch + 1) {
                  nextNewline = input.indexOf(newline, quoteSearch + 1);
                }
                var checkUpTo = nextNewline === -1 ? nextDelim : Math.min(nextDelim, nextNewline);
                var spacesBetweenQuoteAndDelimiter = extraSpaces(checkUpTo);
                if (input.substr(quoteSearch + 1 + spacesBetweenQuoteAndDelimiter, delimLen) === delim) {
                  row.push(input.substring(cursor, quoteSearch).replace(quoteCharRegex, quoteChar));
                  cursor = quoteSearch + 1 + spacesBetweenQuoteAndDelimiter + delimLen;
                  if (input[quoteSearch + 1 + spacesBetweenQuoteAndDelimiter + delimLen] !== quoteChar) {
                    quoteSearch = input.indexOf(quoteChar, cursor);
                  }
                  nextDelim = input.indexOf(delim, cursor);
                  nextNewline = input.indexOf(newline, cursor);
                  break;
                }
                var spacesBetweenQuoteAndNewLine = extraSpaces(nextNewline);
                if (input.substring(quoteSearch + 1 + spacesBetweenQuoteAndNewLine, quoteSearch + 1 + spacesBetweenQuoteAndNewLine + newlineLen) === newline) {
                  row.push(input.substring(cursor, quoteSearch).replace(quoteCharRegex, quoteChar));
                  saveRow(quoteSearch + 1 + spacesBetweenQuoteAndNewLine + newlineLen);
                  nextDelim = input.indexOf(delim, cursor);
                  quoteSearch = input.indexOf(quoteChar, cursor);
                  if (stepIsFunction) {
                    doStep();
                    if (aborted)
                      return returnable();
                  }
                  if (preview && data.length >= preview)
                    return returnable(true);
                  break;
                }
                errors.push({
                  type: "Quotes",
                  code: "InvalidQuotes",
                  message: "Trailing quote on quoted field is malformed",
                  row: data.length,
                  // row has yet to be inserted
                  index: cursor
                });
                quoteSearch++;
                continue;
              }
              continue;
            }
            if (comments && row.length === 0 && input.substring(cursor, cursor + commentsLen) === comments) {
              if (nextNewline === -1)
                return returnable();
              cursor = nextNewline + newlineLen;
              nextNewline = input.indexOf(newline, cursor);
              nextDelim = input.indexOf(delim, cursor);
              continue;
            }
            if (nextDelim !== -1 && (nextDelim < nextNewline || nextNewline === -1)) {
              row.push(input.substring(cursor, nextDelim));
              cursor = nextDelim + delimLen;
              nextDelim = input.indexOf(delim, cursor);
              continue;
            }
            if (nextNewline !== -1) {
              row.push(input.substring(cursor, nextNewline));
              saveRow(nextNewline + newlineLen);
              if (stepIsFunction) {
                doStep();
                if (aborted)
                  return returnable();
              }
              if (preview && data.length >= preview)
                return returnable(true);
              continue;
            }
            break;
          }
          return finish();
          function pushRow(row2) {
            data.push(row2);
            lastCursor = cursor;
          }
          function extraSpaces(index) {
            var spaceLength = 0;
            if (index !== -1) {
              var textBetweenClosingQuoteAndIndex = input.substring(quoteSearch + 1, index);
              if (textBetweenClosingQuoteAndIndex && textBetweenClosingQuoteAndIndex.trim() === "") {
                spaceLength = textBetweenClosingQuoteAndIndex.length;
              }
            }
            return spaceLength;
          }
          function finish(value2) {
            if (ignoreLastRow)
              return returnable();
            if (typeof value2 === "undefined")
              value2 = input.substring(cursor);
            row.push(value2);
            cursor = inputLen;
            pushRow(row);
            if (stepIsFunction)
              doStep();
            return returnable();
          }
          function saveRow(newCursor) {
            cursor = newCursor;
            pushRow(row);
            row = [];
            nextNewline = input.indexOf(newline, cursor);
          }
          function returnable(stopped) {
            return {
              data,
              errors,
              meta: {
                delimiter: delim,
                linebreak: newline,
                aborted,
                truncated: !!stopped,
                cursor: lastCursor + (baseIndex || 0)
              }
            };
          }
          function doStep() {
            step(returnable());
            data = [];
            errors = [];
          }
        };
        this.abort = function() {
          aborted = true;
        };
        this.getCharIndex = function() {
          return cursor;
        };
      }
      function newWorker() {
        if (!Papa3.WORKERS_SUPPORTED)
          return false;
        var workerUrl = getWorkerBlob();
        var w = new global.Worker(workerUrl);
        w.onmessage = mainThreadReceivedMessage;
        w.id = workerIdCounter++;
        workers[w.id] = w;
        return w;
      }
      function mainThreadReceivedMessage(e) {
        var msg = e.data;
        var worker = workers[msg.workerId];
        var aborted = false;
        if (msg.error)
          worker.userError(msg.error, msg.file);
        else if (msg.results && msg.results.data) {
          var abort = function() {
            aborted = true;
            completeWorker(msg.workerId, { data: [], errors: [], meta: { aborted: true } });
          };
          var handle = {
            abort,
            pause: notImplemented,
            resume: notImplemented
          };
          if (isFunction(worker.userStep)) {
            for (var i = 0; i < msg.results.data.length; i++) {
              worker.userStep({
                data: msg.results.data[i],
                errors: msg.results.errors,
                meta: msg.results.meta
              }, handle);
              if (aborted)
                break;
            }
            delete msg.results;
          } else if (isFunction(worker.userChunk)) {
            worker.userChunk(msg.results, handle, msg.file);
            delete msg.results;
          }
        }
        if (msg.finished && !aborted)
          completeWorker(msg.workerId, msg.results);
      }
      function completeWorker(workerId, results) {
        var worker = workers[workerId];
        if (isFunction(worker.userComplete))
          worker.userComplete(results);
        worker.terminate();
        delete workers[workerId];
      }
      function notImplemented() {
        throw new Error("Not implemented.");
      }
      function workerThreadReceivedMessage(e) {
        var msg = e.data;
        if (typeof Papa3.WORKER_ID === "undefined" && msg)
          Papa3.WORKER_ID = msg.workerId;
        if (typeof msg.input === "string") {
          global.postMessage({
            workerId: Papa3.WORKER_ID,
            results: Papa3.parse(msg.input, msg.config),
            finished: true
          });
        } else if (global.File && msg.input instanceof File || msg.input instanceof Object) {
          var results = Papa3.parse(msg.input, msg.config);
          if (results)
            global.postMessage({
              workerId: Papa3.WORKER_ID,
              results,
              finished: true
            });
        }
      }
      function copy(obj) {
        if (typeof obj !== "object" || obj === null)
          return obj;
        var cpy = Array.isArray(obj) ? [] : {};
        for (var key in obj)
          cpy[key] = copy(obj[key]);
        return cpy;
      }
      function bindFunction(f, self2) {
        return function() {
          f.apply(self2, arguments);
        };
      }
      function isFunction(func) {
        return typeof func === "function";
      }
      return Papa3;
    });
  }
});

// smoke.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
var import_papaparse2 = __toESM(require_papaparse(), 1);

// src/types/index.ts
var CARD_COLOR_LABELS = Object.freeze({
  red: "\u72C2\u6012",
  green: "\u5E73\u9759",
  blue: "\u5FC3\u7075",
  yellow: "\u8EAF\u4F53",
  purple: "\u6DF7\u6C8C",
  orange: "\u79E9\u5E8F",
  colorless: "\u65E0\u8272"
});
var DEFAULT_ANALYSIS_OPTIONS = Object.freeze({
  topThreshold: 0.15,
  comboMinBase: 0.15,
  comboMinLift: 1.2,
  jaccardMin: 0.55,
  archMax: 3,
  weekMode: "iso",
  rollingGapDays: 4
});

// src/utils/dataParser.ts
var import_papaparse = __toESM(require_papaparse(), 1);

// src/utils/isoWeek.ts
function getISOWeek(input) {
  const d = typeof input === "string" ? new Date(input.length >= 10 ? input.slice(0, 10) : input) : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const firstDayNr = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDayNr + 3);
  const diffMs = target.valueOf() - firstThursday.valueOf();
  const week = 1 + Math.ceil(diffMs / (7 * 24 * 3600 * 1e3));
  const year = target.getFullYear();
  if (week < 1 || week > 53) return null;
  return {
    year,
    week,
    label: `${year}-W${String(week).padStart(2, "0")}`
  };
}
function daysBetween(a, b) {
  const ta = new Date(a.length >= 10 ? a.slice(0, 10) : a).getTime();
  const tb = new Date(b.length >= 10 ? b.slice(0, 10) : b).getTime();
  if (Number.isNaN(ta) || Number.isNaN(tb)) return Number.MAX_SAFE_INTEGER;
  return Math.round(Math.abs(tb - ta) / 864e5);
}
function bucketByRollingWindow(dates, gapDays) {
  const sorted = Array.from(new Set(dates.filter((d) => !!d))).sort();
  const dateToLabel = /* @__PURE__ */ new Map();
  const list = [];
  let bucketIdx = 0;
  let prev = null;
  for (const d of sorted) {
    if (prev !== null && daysBetween(prev, d) >= gapDays) {
      bucketIdx++;
    }
    const label = `\u7B2C${bucketIdx + 1}\u5468`;
    dateToLabel.set(d, label);
    if (list[list.length - 1] !== label) list.push(label);
    prev = d;
  }
  return { dateToLabel, list };
}
function rollingLabelToBucket(label, order) {
  return { year: 0, week: order, label };
}
function compareWeekBucket(a, b) {
  if (a.year !== b.year) return a.year - b.year;
  return a.week - b.week;
}

// src/utils/cityRegex.ts
var UNKNOWN_CITY = "\u672A\u77E5";
var PRIMARY = /【[^】]*】\s*(.+?)(?:站|分站|赛区)(?:[-·\s]|$)/;
var SECONDARY = /([一-龥·A-Za-z\d]{2,8})(?:站\b|分站\b|赛区\b)/;
var PROVINCE_SUFFIX_PATTERN = /(特别行政区|维吾尔自治区|壮族自治区|回族自治区|自治区|省|市)$/;
var CITY_SUFFIX_PATTERN = /市$/;
function trimEndDigits(s) {
  return s.replace(/\d+$/u, "").trim();
}
function looksLikeCity(s) {
  return /^[一-龥·A-Za-z]{2,8}$/u.test(s);
}
function extractCityFromActivityName(name) {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  const m1 = trimmed.match(PRIMARY);
  if (m1 && m1[1]) {
    const cleaned = cleanCandidate(m1[1]);
    if (cleaned) return cleaned;
  }
  const m2 = trimmed.match(SECONDARY);
  if (m2 && m2[1]) {
    const cleaned = cleanCandidate(m2[1]);
    if (cleaned) return cleaned;
  }
  return null;
}
function extractCityFromProvince(province) {
  if (!province) return null;
  const trimmed = province.trim();
  if (!trimmed) return null;
  let s = trimmed.replace(PROVINCE_SUFFIX_PATTERN, "").trim();
  s = s.replace(CITY_SUFFIX_PATTERN, "").trim();
  s = trimEndDigits(s);
  if (!looksLikeCity(s)) return null;
  return s;
}
function cleanCandidate(raw) {
  let s = raw.trim();
  s = s.replace(CITY_SUFFIX_PATTERN, "").trim();
  s = s.replace(/(分站|赛区|站)$/u, "").trim();
  s = trimEndDigits(s);
  if (!looksLikeCity(s)) return null;
  return s;
}
function resolveCity(args) {
  if (args.override && args.override.trim()) return args.override.trim();
  if (args.shopCity && args.shopCity.trim()) {
    const cleaned = cleanCandidate(args.shopCity);
    if (cleaned) return cleaned;
    return args.shopCity.trim();
  }
  return extractCityFromActivityName(args.activityName) ?? extractCityFromProvince(args.province) ?? UNKNOWN_CITY;
}

// src/utils/parseTTS.ts
function parseTTSCode(input) {
  const result2 = /* @__PURE__ */ new Map();
  if (!input) return result2;
  const parts = input.trim().split(/\s+/);
  for (const part of parts) {
    if (!part) continue;
    const segs = part.split("-");
    if (segs.length < 2) continue;
    const series = segs[0];
    const no = (segs[1] ?? "").replace(/\*$/, "").trim();
    if (!series || !no) continue;
    const id = `${series}-${no}`;
    result2.set(id, (result2.get(id) ?? 0) + 1);
  }
  return result2;
}
var CATEGORY_PREFIX_STRIP = /^(专属|指示物)/u;
var ALLOWED = /* @__PURE__ */ new Set([
  "\u4F20\u5947",
  "\u82F1\u96C4\u5355\u4F4D",
  "\u5355\u4F4D",
  "\u6CD5\u672F",
  "\u88C5\u5907",
  "\u7B26\u6587",
  "\u6218\u573A",
  "\u5176\u4ED6"
]);
function normalizeCategory(raw) {
  let s = "\u5176\u4ED6";
  if (raw) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && typeof arr[0] === "string") s = arr[0];
    } catch {
      if (/^[\u4e00-\u9fa5]+$/.test(raw.trim())) s = raw.trim();
    }
  }
  s = s.replace(CATEGORY_PREFIX_STRIP, "");
  return ALLOWED.has(s) ? s : "\u5176\u4ED6";
}

// src/utils/dataParser.ts
function pickColumn(keys, exact, hints) {
  if (!keys) return null;
  for (const k of keys) {
    if (k && k.toLowerCase() === exact) return k;
  }
  for (const k of keys) {
    if (!k) continue;
    const low = k.toLowerCase();
    for (const hint of hints) {
      if (low.includes(hint)) return k;
    }
  }
  return null;
}
function buildCardCatalog(cBase, cPrints, cacheData) {
  const baseById = /* @__PURE__ */ new Map();
  for (const b of cBase) {
    const id = b.id;
    if (typeof id === "string" && id) baseById.set(id, b);
  }
  const byId = /* @__PURE__ */ new Map();
  const cardDict = /* @__PURE__ */ new Map();
  const cardEnergy = /* @__PURE__ */ new Map();
  const cardRarity = /* @__PURE__ */ new Map();
  const cardCategory = /* @__PURE__ */ new Map();
  const cardColors = /* @__PURE__ */ new Map();
  const cardImg = /* @__PURE__ */ new Map();
  const VALID_COLORS = /* @__PURE__ */ new Set([
    "red",
    "green",
    "blue",
    "yellow",
    "purple",
    "orange",
    "colorless"
  ]);
  function parseColors(raw) {
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr.filter(
        (c) => typeof c === "string" && VALID_COLORS.has(c)
      );
    } catch {
      return [];
    }
  }
  function parseJsonArrayFirst(raw) {
    if (!raw) return "";
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && typeof arr[0] === "string") return arr[0];
    } catch {
    }
    return "";
  }
  for (const p of cPrints) {
    if (typeof p.card_id !== "string" || !p.card_id) continue;
    if (typeof p.card_no_extend !== "string" || !p.card_no_extend) continue;
    const base = baseById.get(p.card_id);
    if (!base) continue;
    const rawNo = p.card_no_extend.replace(/\*$/, "").trim();
    if (!rawNo) continue;
    const series = rawNo.split("-")[0] ?? "";
    const energy = parseFloat(base.energy ?? "") || 0;
    const category = normalizeCategory(base.card_category);
    const name = base.card_name_cn || rawNo;
    const rarity = p.rarity_name || "\u672A\u77E5";
    const meta = {
      id: rawNo,
      name,
      series,
      rarity,
      energy,
      category,
      rawCategory: base.card_category ?? "",
      colors: parseColors(base.card_color_list),
      region: parseJsonArrayFirst(base.region),
      power: parseFloat(base.power ?? "") || 0,
      championTag: (base.champion_tag ?? "").trim(),
      isBanned: String(base.is_banned ?? "").toLowerCase() === "true"
    };
    byId.set(rawNo, meta);
    cardDict.set(rawNo, name);
    cardEnergy.set(rawNo, energy);
    cardRarity.set(rawNo, rarity);
    cardCategory.set(rawNo, category);
    cardColors.set(rawNo, meta.colors);
    const img = p.img_cdn;
    if (typeof img === "string" && img.startsWith("http")) {
      if (!cardImg.has(rawNo)) cardImg.set(rawNo, img);
    }
  }
  if (cacheData) {
    for (const entries of Object.values(cacheData)) {
      if (!Array.isArray(entries)) continue;
      for (const e of entries) {
        if (!e || typeof e.cardNo !== "string") continue;
        const no = normalizeCardNo(e.cardNo);
        if (!no) continue;
        if (!cardImg.has(no) && typeof e.frontImage === "string" && e.frontImage.startsWith("http")) {
          cardImg.set(no, e.frontImage);
        }
        if (!byId.has(no) && no.includes("-")) {
          const name = e.cardName ?? no;
          const series = no.split("-")[0] ?? "";
          const colors = (e.cardColorList ?? []).filter(
            (c) => typeof c === "string" && VALID_COLORS.has(c)
          );
          const catRaw = e.cardCategoryName ?? "";
          const category = ALLOWED_CACHE_CATEGORY.has(catRaw) ? catRaw : "\u5176\u4ED6";
          const meta = {
            id: no,
            name,
            series,
            rarity: e.rarity ?? "\u672A\u77E5",
            energy: 0,
            category,
            rawCategory: catRaw,
            colors,
            region: "",
            power: 0,
            championTag: e.hero ?? "",
            isBanned: false
          };
          byId.set(no, meta);
          cardDict.set(no, name);
          cardEnergy.set(no, 0);
          cardRarity.set(no, meta.rarity);
          cardCategory.set(no, category);
          cardColors.set(no, colors);
        }
      }
    }
  }
  return { byId, cardDict, cardEnergy, cardRarity, cardCategory, cardColors, cardImg };
}
var ALLOWED_CACHE_CATEGORY = /* @__PURE__ */ new Set([
  "\u4F20\u5947",
  "\u82F1\u96C4\u5355\u4F4D",
  "\u5355\u4F4D",
  "\u6CD5\u672F",
  "\u88C5\u5907",
  "\u7B26\u6587",
  "\u6218\u573A"
]);
function normalizeCardNo(no) {
  return no.replace(/·/g, "-").replace(/\/.*$/, "").replace(/\*$/, "").trim();
}
function detectDeckColumns(rows) {
  if (rows.length === 0) {
    return {
      rankCol: "rank",
      eventCol: null,
      playerCol: null,
      dateCol: null,
      provinceCol: null,
      heroCol: null,
      ttsCol: null
    };
  }
  const first = rows[0] ?? {};
  const keys = Object.keys(first);
  const rankCol = pickColumn(keys, "finalranking", ["rank"]) ?? keys[3] ?? "rank";
  const eventCol = pickColumn(keys, "activityname", ["activity", "tournament", "event"]);
  const playerCol = pickColumn(keys, "playername", ["player"]);
  const dateCol = pickColumn(keys, "date", ["date"]);
  const provinceCol = pickColumn(keys, "shopprovince", ["province"]);
  const heroCol = pickColumn(keys, "hero", ["hero", "champion"]);
  const ttsCol = pickColumn(keys, "tts_code", ["tts", "deckcode", "code"]);
  return { rankCol, eventCol, playerCol, dateCol, provinceCol, heroCol, ttsCol };
}
function precomputeWeeks(rows, dateCol, weekMode, rollingGapDays) {
  const result2 = {
    dateToBucket: /* @__PURE__ */ new Map(),
    list: [],
    hasAny: false
  };
  if (!dateCol) return result2;
  if (weekMode === "iso") {
    const seen = /* @__PURE__ */ new Map();
    for (const r of rows) {
      const dateStr = (r[dateCol] ?? "").slice(0, 10);
      if (!dateStr) continue;
      const bucket = getISOWeek(dateStr);
      if (!bucket) continue;
      result2.hasAny = true;
      result2.dateToBucket.set(dateStr, bucket);
      if (!seen.has(bucket.label)) seen.set(bucket.label, bucket);
    }
    result2.list = Array.from(seen.values()).sort(compareWeekBucket);
  } else {
    const dates = rows.map((r) => (r[dateCol] ?? "").slice(0, 10)).filter((d) => !!d);
    const { dateToLabel, list } = bucketByRollingWindow(dates, rollingGapDays);
    result2.hasAny = dateToLabel.size > 0;
    list.forEach((label, idx) => {
      const bucket = rollingLabelToBucket(label, idx + 1);
      for (const [d, l] of dateToLabel.entries()) {
        if (l === label) result2.dateToBucket.set(d, bucket);
      }
    });
    result2.list = list.map((l, idx) => rollingLabelToBucket(l, idx + 1));
  }
  return result2;
}
var UNKNOWN_WEEK = { year: 0, week: 0, label: "\u672A\u77E5" };
function cell(row, col, fallback = "") {
  if (!col) return fallback;
  const v = row[col];
  if (v == null) return fallback;
  return String(v).trim();
}
function normalizeDeck(row, cols, weekPre, cityOverrides, shopIndex) {
  const activityName = cell(row, cols.eventCol);
  const playerName = cell(row, cols.playerCol);
  const dateStr = cell(row, cols.dateCol).slice(0, 10);
  const provinceRaw = cell(row, cols.provinceCol);
  const heroRaw = cell(row, cols.heroCol, "\u672A\u77E5") || "\u672A\u77E5";
  const ttsCode = cell(row, cols.ttsCol);
  const rankRaw = cols.rankCol ? row[cols.rankCol] : void 0;
  const rankParsed = parseInt(String(rankRaw ?? ""), 10);
  const rank = Number.isFinite(rankParsed) ? rankParsed : Number.MAX_SAFE_INTEGER;
  const shop = activityName ? shopIndex?.get(normalizeEventKey(activityName)) : void 0;
  const province = shop?.shopProvince || provinceRaw;
  const shopName = shop?.shopName ?? "";
  const override = activityName ? cityOverrides.get(activityName) : void 0;
  const city = resolveCity({
    activityName,
    province: provinceRaw,
    override,
    shopCity: shop?.shopCity
  });
  const week = dateStr && weekPre.dateToBucket.get(dateStr) || UNKNOWN_WEEK;
  return {
    raw: row,
    playerName,
    activityName,
    date: dateStr,
    rank,
    hero: heroRaw,
    province,
    city,
    week,
    ttsCode,
    cards: parseTTSCode(ttsCode),
    wins: null,
    eventRounds: null,
    winRate: null,
    shopCity: shop?.shopCity ?? "",
    shopName,
    cardGroupId: null
  };
}
function normalizeDecks(rows, opts = {}) {
  const cityOverrides = opts.cityOverrides ?? /* @__PURE__ */ new Map();
  const weekMode = opts.weekMode ?? "iso";
  const rollingGapDays = opts.rollingGapDays ?? 4;
  const shopIndex = opts.shopIndex;
  const columns = detectDeckColumns(rows);
  const weekPre = precomputeWeeks(rows, columns.dateCol, weekMode, rollingGapDays);
  const decks = [];
  const unknownEvents = /* @__PURE__ */ new Set();
  for (const r of rows) {
    const deck = normalizeDeck(r, columns, weekPre, cityOverrides, shopIndex);
    decks.push(deck);
    if (deck.city === UNKNOWN_CITY && deck.activityName) {
      unknownEvents.add(deck.activityName);
    }
  }
  return {
    decks,
    columns,
    weeks: weekPre.list,
    cityUnknownActivities: Array.from(unknownEvents)
  };
}
function dedupeSampleDecks(decks) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const d of decks) {
    const key = `${d.playerName}|${d.activityName}|${d.date}|${d.rank}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}
function normalizeEventKey(name) {
  return name.replace(/\s+/g, "").replace(/（/g, "(").replace(/）/g, ")");
}

// src/core/heroStats.ts
function pickTopCount(n, threshold) {
  if (n === 0) return 0;
  if (threshold >= 8) {
    return Math.min(Math.floor(threshold), n);
  }
  return Math.min(n, Math.max(8, Math.ceil(n * threshold)));
}
function aggregateUsage(topDecks, catalog, topCount) {
  const usage = /* @__PURE__ */ new Map();
  for (const deck of topDecks) {
    for (const [id, count] of deck.cards) {
      let u = usage.get(id);
      if (!u) {
        u = { deckCount: 0, totalCount: 0, energySum: 0 };
        usage.set(id, u);
      }
      u.deckCount += 1;
      u.totalCount += count;
      const energy = catalog.cardEnergy.get(id) ?? 0;
      u.energySum += energy * count;
    }
  }
  const cards = [];
  for (const [id, u] of usage) {
    const rate = topCount > 0 ? u.deckCount / topCount * 100 : 0;
    const avg = u.deckCount > 0 ? u.totalCount / u.deckCount : 0;
    const energy = u.totalCount > 0 ? u.energySum / u.totalCount : 0;
    cards.push({
      id,
      name: catalog.cardDict.get(id) ?? id,
      series: id.split("-")[0] ?? "",
      rarity: catalog.cardRarity.get(id) ?? "\u672A\u77E5",
      rate,
      avg,
      energy,
      colors: catalog.cardColors.get(id) ?? []
    });
  }
  cards.sort((a, b) => b.rate - a.rate || a.id.localeCompare(b.id));
  return cards;
}
function aggregateWins(heroDecks) {
  let winsSum = 0;
  let roundsSum = 0;
  let winsDecks = 0;
  for (const d of heroDecks) {
    if (d.wins === null || d.eventRounds === null || d.eventRounds <= 0) continue;
    winsSum += d.wins;
    roundsSum += d.eventRounds;
    winsDecks += 1;
  }
  if (winsDecks === 0 || roundsSum === 0) return { winRate: null, avgWins: null };
  return {
    winRate: winsSum / roundsSum * 100,
    avgWins: winsSum / winsDecks
  };
}
function computeHeroStats(allDecks, catalog, weeks, options = { topThreshold: 0.15 }) {
  const byHero = /* @__PURE__ */ new Map();
  for (const d of allDecks) {
    const hero = d.hero || "\u672A\u77E5";
    let arr = byHero.get(hero);
    if (!arr) {
      arr = [];
      byHero.set(hero, arr);
    }
    arr.push(d);
  }
  const totalDecks = allDecks.length;
  const result2 = /* @__PURE__ */ new Map();
  for (const [hero, heroDecks] of byHero) {
    const sorted = heroDecks.slice().sort((a, b) => a.rank - b.rank);
    const topCount = pickTopCount(sorted.length, options.topThreshold);
    const topDecks = sorted.slice(0, topCount);
    const cards = aggregateUsage(topDecks, catalog, topCount);
    let top8 = 0;
    for (const d of heroDecks) {
      if (d.rank >= 1 && d.rank <= 8) top8++;
    }
    const weekMap = /* @__PURE__ */ new Map();
    for (const w of weeks) weekMap.set(w.label, 0);
    for (const d of heroDecks) {
      weekMap.set(d.week.label, (weekMap.get(d.week.label) ?? 0) + 1);
    }
    const cityMap = /* @__PURE__ */ new Map();
    for (const d of heroDecks) {
      if (d.city === UNKNOWN_CITY) continue;
      cityMap.set(d.city, (cityMap.get(d.city) ?? 0) + 1);
    }
    const { winRate, avgWins } = aggregateWins(heroDecks);
    result2.set(hero, {
      total: heroDecks.length,
      topCount,
      topDecks,
      popularity: totalDecks > 0 ? heroDecks.length / totalDecks * 100 : 0,
      top8Rate: heroDecks.length > 0 ? top8 / heroDecks.length * 100 : 0,
      winRate,
      avgWins,
      tier: null,
      tierScore: null,
      cards,
      weeks: weekMap,
      cities: cityMap
    });
  }
  return result2;
}

// src/core/combo.ts
var DEFAULT_COMBO_OPTIONS = Object.freeze({
  minBase: 0.15,
  minLift: 1.2
});
function computeCombos(decks, catalog, options = {}) {
  const opts = { ...DEFAULT_COMBO_OPTIONS, ...options };
  const nTop = decks.length;
  if (nTop === 0) return [];
  const cardCount = /* @__PURE__ */ new Map();
  const deckFilteredIds = [];
  for (const deck of decks) {
    const ids = [];
    for (const id of deck.cards.keys()) {
      if (catalog.cardCategory.get(id) === "\u7B26\u6587") continue;
      ids.push(id);
      cardCount.set(id, (cardCount.get(id) ?? 0) + 1);
    }
    deckFilteredIds.push(ids);
  }
  const thresholdCount = nTop * opts.minBase;
  const validCards = /* @__PURE__ */ new Set();
  for (const [id, count] of cardCount) {
    if (count >= thresholdCount) validCards.add(id);
  }
  if (validCards.size < 2) return [];
  const comboCount = /* @__PURE__ */ new Map();
  for (const ids of deckFilteredIds) {
    const filtered = [];
    for (const id of ids) {
      if (validCards.has(id)) filtered.push(id);
    }
    if (filtered.length < 2) continue;
    const sorted = filtered.slice().sort();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i];
        const b = sorted[j];
        const key = pairKey(a, b);
        comboCount.set(key, (comboCount.get(key) ?? 0) + 1);
      }
    }
  }
  const results = [];
  for (const [key, count] of comboCount) {
    const { a, b } = parseKey(key);
    const countA = cardCount.get(a) ?? 0;
    const countB = cardCount.get(b) ?? 0;
    if (countA === 0 || countB === 0) continue;
    const pA = countA / nTop;
    const pB = countB / nTop;
    const pAB = count / nTop;
    const denom = pA * pB;
    if (denom === 0) continue;
    const lift = pAB / denom;
    if (lift < opts.minLift) continue;
    if (count < (opts.minCount ?? 2)) continue;
    results.push({
      a,
      b,
      nameA: catalog.cardDict.get(a) ?? a,
      nameB: catalog.cardDict.get(b) ?? b,
      count,
      countA,
      countB,
      lift,
      coRate: count / countA * 100,
      coRateReverse: count / countB * 100
    });
  }
  results.sort(
    (x, y) => y.lift - x.lift || y.count - x.count || x.nameA.localeCompare(y.nameA)
  );
  return results;
}
function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
function parseKey(key) {
  const idx = key.indexOf("|");
  if (idx < 0) return { a: key, b: "" };
  return { a: key.slice(0, idx), b: key.slice(idx + 1) };
}

// src/core/region.ts
function computeRegionStats(decks) {
  const regionStats = /* @__PURE__ */ new Map();
  const regionHeat = /* @__PURE__ */ new Map();
  const provinceStats = /* @__PURE__ */ new Map();
  for (const deck of decks) {
    const city = deck.city || UNKNOWN_CITY;
    const hero = deck.hero || "\u672A\u77E5";
    if (city !== UNKNOWN_CITY) {
      let heroMap = regionStats.get(city);
      if (!heroMap) {
        heroMap = /* @__PURE__ */ new Map();
        regionStats.set(city, heroMap);
      }
      heroMap.set(hero, (heroMap.get(hero) ?? 0) + 1);
    }
    let heatHeroMap = regionHeat.get(city);
    if (!heatHeroMap) {
      heatHeroMap = /* @__PURE__ */ new Map();
      regionHeat.set(city, heatHeroMap);
    }
    let cell2 = heatHeroMap.get(hero);
    if (!cell2) {
      cell2 = { n: 0, top8: 0, winsSum: null, roundsSum: null };
      heatHeroMap.set(hero, cell2);
    }
    cell2.n += 1;
    if (deck.rank >= 1 && deck.rank <= 8) cell2.top8 += 1;
    if (deck.wins !== null && deck.eventRounds !== null && deck.eventRounds > 0) {
      cell2.winsSum = (cell2.winsSum ?? 0) + deck.wins;
      cell2.roundsSum = (cell2.roundsSum ?? 0) + deck.eventRounds;
    }
    if (deck.province) {
      provinceStats.set(deck.province, (provinceStats.get(deck.province) ?? 0) + 1);
    }
  }
  return { regionStats, regionHeat, provinceStats };
}

// src/core/join.ts
function buildShopIndex(rows) {
  const idx = /* @__PURE__ */ new Map();
  if (!rows) return idx;
  for (const r of rows) {
    const name = (r.name ?? "").trim();
    if (!name) continue;
    const key = normalizeEventKey(name);
    const prev = idx.get(key);
    if (!prev || (r.playerMaxCount ?? 0) > (prev.playerMaxCount ?? 0)) {
      idx.set(key, r);
    }
  }
  return idx;
}
function attachWinData(decks, rankRows) {
  if (!rankRows || rankRows.length === 0) return 0;
  const byKey = /* @__PURE__ */ new Map();
  const roundsByEvent = /* @__PURE__ */ new Map();
  let matched = 0;
  for (const r of rankRows) {
    const activity = (r.activityName ?? "").trim();
    const player = (r.playerName ?? "").trim();
    if (!activity || !player) continue;
    const key = `${normalizeEventKey(activity)}|${player}`;
    const wins = typeof r.winCount === "number" && Number.isFinite(r.winCount) ? r.winCount : null;
    byKey.set(key, {
      wins: wins ?? 0,
      gid: typeof r.cardGroupId === "number" ? r.cardGroupId : null
    });
    if (wins !== null) {
      const evKey = normalizeEventKey(activity);
      roundsByEvent.set(evKey, Math.max(roundsByEvent.get(evKey) ?? 0, wins));
    }
  }
  for (const d of decks) {
    const key = `${normalizeEventKey(d.activityName)}|${d.playerName.trim()}`;
    const hit = byKey.get(key);
    if (!hit) continue;
    matched++;
    d.wins = hit.wins;
    d.cardGroupId = hit.gid;
    const rounds = roundsByEvent.get(normalizeEventKey(d.activityName)) ?? null;
    d.eventRounds = rounds;
    d.winRate = rounds && rounds > 0 ? hit.wins / rounds * 100 : null;
  }
  return matched;
}
function buildEventList(decks, shopIndex, rankRows) {
  const byEvent = /* @__PURE__ */ new Map();
  for (const d of decks) {
    if (!d.activityName) continue;
    const key = normalizeEventKey(d.activityName);
    let agg = byEvent.get(key);
    if (!agg) {
      agg = {
        date: d.date,
        province: d.province,
        city: d.city,
        area: "",
        shopName: "",
        playerMax: null,
        deckCount: 0
      };
      byEvent.set(key, agg);
    }
    agg.deckCount += 1;
    if (!agg.date && d.date) agg.date = d.date;
    const shop = shopIndex.get(key);
    if (shop) {
      agg.city = shop.shopCity?.replace(/市$/, "") || agg.city;
      agg.area = shop.shopArea ?? "";
      agg.shopName = shop.shopName ?? "";
      agg.playerMax = shop.playerMaxCount ?? agg.playerMax;
      if (shop.date) agg.date = shop.date.slice(0, 10);
      if (shop.shopProvince) agg.province = shop.shopProvince;
    }
  }
  const roundsByEvent = /* @__PURE__ */ new Map();
  if (rankRows) {
    for (const r of rankRows) {
      const activity = (r.activityName ?? "").trim();
      const wins = r.winCount;
      if (!activity || typeof wins !== "number" || !Number.isFinite(wins)) continue;
      const key = normalizeEventKey(activity);
      roundsByEvent.set(key, Math.max(roundsByEvent.get(key) ?? 0, wins));
    }
  }
  const list = [];
  for (const [key, agg] of byEvent) {
    list.push({
      name: key,
      date: agg.date,
      province: agg.province,
      city: agg.city,
      area: agg.area,
      shopName: agg.shopName,
      playerMax: agg.playerMax,
      deckCount: agg.deckCount,
      rounds: roundsByEvent.get(key) ?? null
    });
  }
  list.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  return list;
}

// src/core/tier.ts
var MIN_TIER_SAMPLE = 15;
function percentile(values, value) {
  if (values.length === 0) return 0;
  let below = 0;
  for (const v of values) {
    if (v < value) below += 1;
  }
  return below / values.length;
}
function rateTiers(inputs, opts = {}) {
  const useWin = opts.hasWinData !== false;
  const idx = [];
  const winRates = [];
  const top8s = [];
  const pops = [];
  inputs.forEach((e, i) => {
    if (useWin && e.winRate == null) return;
    idx.push(i);
    winRates.push(e.winRate ?? e.top8Rate);
    top8s.push(e.top8Rate);
    pops.push(e.popularity);
  });
  if (idx.length < 4) {
    return inputs.map(() => ({ tier: null, tierScore: null }));
  }
  const out = inputs.map(() => ({ tier: null, tierScore: null }));
  for (const i of idx) {
    const e = inputs[i];
    const pWin = percentile(winRates, e.winRate ?? e.top8Rate);
    const pTop8 = percentile(top8s, e.top8Rate);
    const pPop = percentile(pops, e.popularity);
    const score = useWin ? pWin * 0.55 + pTop8 * 0.2 + pPop * 0.25 : pWin * 0.6 + pPop * 0.4;
    out[i] = {
      tierScore: Math.round(score * 100),
      tier: score >= 0.85 ? "S" : score >= 0.6 ? "A" : score >= 0.3 ? "B" : "C"
    };
  }
  return out;
}
function computeTiers(heroes2, opts = {}) {
  const minSample = opts.minSample ?? MIN_TIER_SAMPLE;
  const keys = [];
  const inputs = [];
  for (const [hero, stat] of heroes2) {
    if (stat.total < minSample) continue;
    keys.push(hero);
    inputs.push({
      winRate: stat.winRate,
      top8Rate: stat.top8Rate,
      popularity: stat.popularity
    });
  }
  const rated = rateTiers(inputs, opts);
  keys.forEach((hero, i) => {
    const r = rated[i];
    if (!r || !r.tier) return;
    const stat = heroes2.get(hero);
    if (!stat) return;
    stat.tier = r.tier;
    stat.tierScore = r.tierScore;
  });
}

// src/core/colorStats.ts
function pairLabel(colors) {
  return colors.map((c) => CARD_COLOR_LABELS[c]).join("\xB7");
}
function computeColorStats(decks, catalog, weeks) {
  const pairDecks = /* @__PURE__ */ new Map();
  const colorCopies = /* @__PURE__ */ new Map();
  const weekly = /* @__PURE__ */ new Map();
  for (const w of weeks) {
    weekly.set(w.label, /* @__PURE__ */ new Map());
  }
  let identifiedDecks = 0;
  for (const d of decks) {
    let pair = null;
    for (const id of d.cards.keys()) {
      if (catalog.cardCategory.get(id) === "\u4F20\u5947") {
        const cs2 = catalog.cardColors.get(id);
        if (cs2 && cs2.length >= 1) {
          pair = [...cs2].filter((c) => c !== "colorless").sort();
          break;
        }
      }
    }
    if (pair && pair.length >= 1) {
      identifiedDecks++;
      const key = pair.join("|");
      const prev = pairDecks.get(key);
      if (prev) prev.decks += 1;
      else pairDecks.set(key, { colors: pair, decks: 1 });
    }
    const weekColors = weekly.get(d.week.label);
    for (const [id, count] of d.cards) {
      const cat = catalog.cardCategory.get(id);
      if (cat === "\u7B26\u6587" || cat === "\u6218\u573A") continue;
      const cs2 = catalog.cardColors.get(id);
      if (!cs2) continue;
      for (const c of cs2) {
        colorCopies.set(c, (colorCopies.get(c) ?? 0) + count);
        weekColors?.set(c, (weekColors.get(c) ?? 0) + count);
      }
    }
  }
  const totalForShare = identifiedDecks || 1;
  const pairs = Array.from(pairDecks.values()).map((p) => ({
    label: pairLabel(p.colors),
    colors: p.colors,
    decks: p.decks,
    share: p.decks / totalForShare * 100
  })).sort((a, b) => b.decks - a.decks);
  return {
    pairs,
    colorCopies,
    weeklyColors: Array.from(weekly.entries()).map(([week, colors]) => ({
      week,
      colors
    })),
    identifiedDecks
  };
}

// src/core/analyzer.ts
function runAnalysis(input) {
  const opts = {
    ...DEFAULT_ANALYSIS_OPTIONS,
    ...input.options
  };
  const joinShopIndex = buildShopIndex(input.shopRows);
  const normalized = normalizeDecks(input.deckRows, {
    cityOverrides: input.cityOverrides ?? /* @__PURE__ */ new Map(),
    weekMode: opts.weekMode,
    rollingGapDays: opts.rollingGapDays,
    shopIndex: joinShopIndex
  });
  const winMatchedDecks = attachWinData(normalized.decks, input.rankRows);
  const hasWinData = winMatchedDecks > 0;
  const catalog = buildCardCatalog(input.baseRows, input.printRows, input.cacheData);
  let imageCount = 0;
  for (const [id] of catalog.cardImg) {
    if (catalog.byId.has(id)) imageCount++;
  }
  const heroes2 = computeHeroStats(normalized.decks, catalog, normalized.weeks, {
    topThreshold: opts.topThreshold
  });
  computeTiers(heroes2, { hasWinData });
  const topDecksBag = [];
  for (const heroStat of heroes2.values()) {
    topDecksBag.push(...heroStat.topDecks);
  }
  const uniqueSampleDecks = dedupeSampleDecks(topDecksBag);
  const globalTopCards = countCards(uniqueSampleDecks);
  const globalAllCards = countCards(normalized.decks);
  const { regionStats, regionHeat, provinceStats } = computeRegionStats(normalized.decks);
  const combos = computeCombos(uniqueSampleDecks, catalog, {
    minBase: opts.comboMinBase,
    minLift: opts.comboMinLift
  });
  const colorStats = computeColorStats(uniqueSampleDecks, catalog, normalized.weeks);
  const events = buildEventList(normalized.decks, joinShopIndex, input.rankRows);
  return {
    totalDecks: normalized.decks.length,
    uniqueSampleDecks,
    sampleSize: uniqueSampleDecks.length,
    heroes: heroes2,
    weeks: normalized.weeks,
    allDecks: normalized.decks,
    globalTopCards,
    globalAllCards,
    combos,
    regionStats,
    regionHeat,
    provinceStats,
    cityUnknown: normalized.cityUnknownActivities,
    catalog,
    rankColumn: normalized.columns.rankCol,
    provinceColumn: normalized.columns.provinceCol ?? "",
    cityUnknownActivityNames: normalized.cityUnknownActivities,
    events,
    hasWinData,
    winMatchedDecks,
    shopMatchedEvents: events.filter((e) => e.shopName).length,
    imageCount,
    colorStats
  };
}
function countCards(decks) {
  const m = /* @__PURE__ */ new Map();
  for (const deck of decks) {
    for (const id of deck.cards.keys()) {
      m.set(id, (m.get(id) ?? 0) + 1);
    }
  }
  return m;
}

// src/utils/palette.ts
var CATEGORY_COLORS = Object.freeze({
  \u4F20\u5947: "#0f172a",
  \u82F1\u96C4\u5355\u4F4D: "#8b5cf6",
  \u5355\u4F4D: "#3b82f6",
  \u6CD5\u672F: "#ef4444",
  \u88C5\u5907: "#f59e0b",
  \u7B26\u6587: "#a78bfa",
  \u6218\u573A: "#06b6d4",
  \u5176\u4ED6: "#9ca3af"
});
var CARD_COLOR_HEX = Object.freeze({
  red: "#e2372b",
  green: "#3fa650",
  blue: "#2f7dd1",
  yellow: "#d9a514",
  purple: "#8b48c9",
  orange: "#e2762b",
  colorless: "#94a3b8"
});
var TIER_COLORS = Object.freeze({
  S: { bg: "bg-amber-100 dark:bg-amber-500/20 border-amber-300 dark:border-amber-500/40", text: "text-amber-700 dark:text-amber-400" },
  A: { bg: "bg-rose-100 dark:bg-rose-500/20 border-rose-300 dark:border-rose-500/40", text: "text-rose-700 dark:text-rose-400" },
  B: { bg: "bg-sky-100 dark:bg-sky-500/20 border-sky-300 dark:border-sky-500/40", text: "text-sky-700 dark:text-sky-400" },
  C: { bg: "bg-slate-100 dark:bg-slate-500/20 border-slate-300 dark:border-slate-500/40", text: "text-slate-600 dark:text-slate-400" }
});

// src/core/archetype.ts
var DEFAULT_ARCHETYPE_OPTIONS = Object.freeze({
  jaccardMin: 0.55,
  archMax: 3
});

// src/core/stats.ts
var SHRINK_STRENGTH = 10;
function shrinkWinRate(wins, rounds, prior2, strength = SHRINK_STRENGTH) {
  if (rounds <= 0) return prior2 * 100;
  return (wins + strength * prior2) / (rounds + strength) * 100;
}
function envPriorWinRate(decks) {
  let wins = 0;
  let rounds = 0;
  for (const d of decks) {
    if (d.wins !== null && d.eventRounds !== null && d.eventRounds > 0) {
      wins += d.wins;
      rounds += d.eventRounds;
    }
  }
  if (rounds <= 0) return null;
  return wins / rounds;
}

// src/core/legendaryStats.ts
function legendaryRows(decks, catalog, grandTotal, opts = {}) {
  const shrink = opts.shrink ?? true;
  const strength = opts.strength;
  const byLeg = /* @__PURE__ */ new Map();
  for (const d of decks) {
    let leg = null;
    let colors = [];
    for (const id of d.cards.keys()) {
      if (catalog.cardCategory.get(id) === "\u4F20\u5947") {
        leg = id;
        const cs2 = catalog.cardColors.get(id);
        if (cs2) {
          colors = [...cs2].filter((c) => c !== "colorless").sort();
        }
        break;
      }
    }
    if (!leg) continue;
    let agg = byLeg.get(leg);
    if (!agg) {
      agg = { colors, total: 0, top8: 0, winsSum: 0, roundsSum: 0, winDecks: 0, heroes: /* @__PURE__ */ new Map() };
      byLeg.set(leg, agg);
    }
    agg.total += 1;
    if (d.rank >= 1 && d.rank <= 8) agg.top8 += 1;
    if (d.wins !== null && d.eventRounds !== null && d.eventRounds > 0) {
      agg.winsSum += d.wins;
      agg.roundsSum += d.eventRounds;
      agg.winDecks += 1;
    }
    const hero = d.hero || "\u672A\u77E5";
    agg.heroes.set(hero, (agg.heroes.get(hero) ?? 0) + 1);
  }
  const rows = [];
  const prior2 = shrink ? envPriorWinRate(decks) : null;
  for (const [cardNo, a] of byLeg) {
    const meta = catalog.byId.get(cardNo);
    const topHero = [...a.heroes.entries()].sort((x, y) => y[1] - x[1])[0];
    const hasWin = a.winDecks > 0 && a.roundsSum > 0;
    const raw = hasWin ? a.winsSum / a.roundsSum * 100 : null;
    rows.push({
      cardNo,
      name: meta?.name ?? cardNo,
      colors: a.colors,
      total: a.total,
      top8: a.top8,
      top8Rate: a.total > 0 ? a.top8 / a.total * 100 : 0,
      popularity: grandTotal > 0 ? a.total / grandTotal * 100 : 0,
      winRate: raw,
      winRateAdj: hasWin && prior2 != null ? shrinkWinRate(a.winsSum, a.roundsSum, prior2, strength) : raw,
      wins: hasWin ? a.winsSum : null,
      rounds: hasWin ? a.roundsSum : null,
      avgWins: a.winDecks > 0 ? a.winsSum / a.winDecks : null,
      topHero: topHero?.[0] ?? "\u2014",
      topHeroRate: topHero && a.total > 0 ? topHero[1] / a.total * 100 : 0,
      imgUrl: catalog.cardImg.get(cardNo) ?? null,
      isBanned: meta?.isBanned ?? false
    });
  }
  rows.sort((x, y) => y.total - x.total);
  return rows;
}
function metricValue(r, m) {
  if (m === "winRate") return r.winRateAdj ?? r.top8Rate;
  return r[m];
}
function sortLegendaryRows(rows, metric, minSample = 5) {
  return [...rows].filter((r) => r.total >= minSample).sort((a, b) => metricValue(b, metric) - metricValue(a, metric) || b.total - a.total);
}

// smoke.ts
var PKG = (0, import_node_path.resolve)(process.cwd(), "\u57CE\u5E02\u8D5B\u7B2C\u56DB\u8D5B\u5B63\u7B2C\u4E09\u5468_\u5168\u91CF\u6570\u636E\u5305");
function csv(name) {
  const text = (0, import_node_fs.readFileSync)((0, import_node_path.resolve)(PKG, name), "utf8");
  return import_papaparse2.default.parse(text, { header: true, skipEmptyLines: true }).data ?? [];
}
var t0 = Date.now();
var result = runAnalysis({
  deckRows: csv("\u57CE\u5E02\u8D5B\u7B2C\u56DB\u8D5B\u5B63\u7B2C\u4E09\u5468_decks_data_with_TTS.csv"),
  baseRows: csv("cards_base_rows.csv"),
  printRows: csv("card_prints_rows.csv"),
  rankRows: JSON.parse((0, import_node_fs.readFileSync)((0, import_node_path.resolve)(PKG, "\u57CE\u5E02\u8D5B\u7B2C\u56DB\u8D5B\u5B63\u7B2C\u4E09\u5468_rank_data.json"), "utf8")),
  shopRows: JSON.parse((0, import_node_fs.readFileSync)((0, import_node_path.resolve)(PKG, "\u57CE\u5E02\u8D5B\u7B2C\u56DB\u8D5B\u5B63\u7B2C\u4E09\u5468_shop_data.json"), "utf8")),
  cacheData: JSON.parse((0, import_node_fs.readFileSync)((0, import_node_path.resolve)(PKG, "\u57CE\u5E02\u8D5B\u7B2C\u56DB\u8D5B\u5B63\u7B2C\u4E09\u5468_decks_cache.json"), "utf8"))
});
var ms = Date.now() - t0;
console.log("== \u5206\u6790\u8017\u65F6", ms, "ms ==");
console.log("totalDecks:", result.totalDecks);
console.log("sampleSize(Top15%):", result.sampleSize);
console.log("hasWinData:", result.hasWinData, "| winMatched:", result.winMatchedDecks);
console.log("events:", result.events.length, "| shopMatched:", result.shopMatchedEvents);
console.log("images:", result.imageCount);
var heroes = Array.from(result.heroes.entries()).sort((a, b) => b[1].total - a[1].total);
console.log("\n== Tier \u6392\u884C(\u524D10)==");
for (const [name, s] of heroes.slice(0, 10)) {
  console.log(
    `${s.tier ?? "-"} | ${name} | n=${s.total} pop=${s.popularity.toFixed(1)}% win=${s.winRate?.toFixed(1)}% top8=${s.top8Rate.toFixed(1)}% score=${s.tierScore}`
  );
}
var cs = result.colorStats;
console.log("\n== \u57DF\u5BF9 Top6 ==");
cs?.pairs.slice(0, 6).forEach((p) => console.log(`${p.label}: ${p.decks}\u5957 ${p.share.toFixed(1)}%`));
console.log("identifiedDecks:", cs?.identifiedDecks);
var d0 = result.uniqueSampleDecks[0];
if (d0) {
  console.log("\n== \u6837\u672C\u5361\u7EC4 ==");
  console.log(d0.playerName, "|", d0.hero, "| rank", d0.rank, "| wins", d0.wins, "/", d0.eventRounds, "| city", d0.city, "| shop", d0.shopName, "| gid", d0.cardGroupId);
  const imgs = [...d0.cards.keys()].filter((id) => result.catalog.cardImg.has(id)).length;
  console.log("\u5361\u8868", d0.cards.size, "\u79CD \xB7 \u6709\u56FE", imgs, "\u79CD");
}
var cities = new Set(result.allDecks.map((d) => d.city));
console.log("\n\u57CE\u5E02\u6570:", cities.size, "| \u672A\u77E5:", result.allDecks.filter((d) => d.city === "\u672A\u77E5").length);
console.log("combos:", result.combos.length, "| top1:", JSON.stringify(result.combos[0]?.nameA), "+", JSON.stringify(result.combos[0]?.nameB), "lift", result.combos[0]?.lift.toFixed(2));
var legs = legendaryRows(result.allDecks, result.catalog, result.totalDecks);
var covered = legs.reduce((s, r) => s + r.total, 0);
console.log("\n== \u4F20\u5947\u6392\u884C(\u65B0\u5F15\u64CE)==");
console.log("\u4F20\u5947\u79CD\u7C7B:", legs.length, "| \u8BC6\u522B\u5361\u7EC4:", covered, "/", result.totalDecks, "| \u8986\u76D6:", (covered / result.totalDecks * 100).toFixed(1) + "%");
console.log("-- \u6309\u51FA\u573A\u7387 Top5 --");
sortLegendaryRows(legs, "popularity").slice(0, 5).forEach(
  (r, i) => console.log(`#${i + 1} ${r.name}(${r.cardNo}) n=${r.total} pop=${r.popularity.toFixed(1)}% win=${r.winRate?.toFixed(1)}% top8=${r.top8Rate.toFixed(1)}% hero=${r.topHero}(${r.topHeroRate.toFixed(0)}%) \u57DF=${r.colors.join("+")}`)
);
console.log("-- \u6309\u771F\u5B9E\u80DC\u7387 Top5 --");
sortLegendaryRows(legs, "winRate").slice(0, 5).forEach(
  (r, i) => console.log(`#${i + 1} ${r.name}(${r.cardNo}) n=${r.total} win=${r.winRate?.toFixed(1)}% top8=${r.top8Rate.toFixed(1)}% pop=${r.popularity.toFixed(1)}% hero=${r.topHero}`)
);
var legsSample = legendaryRows(result.uniqueSampleDecks, result.catalog, result.sampleSize);
var legByColors = /* @__PURE__ */ new Map();
for (const r of legsSample) {
  const key = [...r.colors].sort().join("|");
  legByColors.set(key, (legByColors.get(key) ?? 0) + r.total);
}
var csPairs = new Map(result.colorStats.pairs.map((p) => [p.colors.join("|"), p.decks]));
var pairOk = 0;
var pairMiss = 0;
for (const [key, n] of legByColors) {
  if (csPairs.get(key) === n) pairOk += 1;
  else pairMiss += 1;
}
console.log(`\u57DF\u5BF9\u53E3\u5F84\u4E00\u81F4\u6027(Top \u6837\u672C ${result.sampleSize} \u5957,${legByColors.size} \u4E2A\u57DF\u5BF9): ${pairOk} \u4E00\u81F4 / ${pairMiss} \u4E0D\u4E00\u81F4`);
console.log("\u5E73\u5747\u6BCF\u5957\u5361\u7EC4\u4F20\u5947\u6570:", (covered / result.totalDecks).toFixed(4));
console.log("\n== \u8D1D\u53F6\u65AF\u6536\u7F29 ==");
var prior = envPriorWinRate(result.allDecks);
console.log("\u73AF\u5883\u5148\u9A8C\u80DC\u7387:", prior != null ? (prior * 100).toFixed(2) + "%" : "null");
var u1 = shrinkWinRate(9, 9, 0.5);
var u2 = shrinkWinRate(100, 200, 0.5);
console.log(`shrinkWinRate(9/9, prior=0.5) = ${u1.toFixed(2)}% (\u671F\u671B 73.68%) | (100/200) = ${u2.toFixed(2)}% (\u671F\u671B 50.00%)`);
if (Math.abs(u1 - 73.68) > 0.1 || Math.abs(u2 - 50) > 0.1) {
  console.error("\u2717 \u6536\u7F29\u516C\u5F0F\u6821\u9A8C\u5931\u8D25");
  process.exitCode = 1;
} else {
  console.log("\u2713 \u6536\u7F29\u516C\u5F0F\u6821\u9A8C\u901A\u8FC7");
}
var byWinAdj = sortLegendaryRows(legs, "winRate");
console.log("-- \u6309\u4FEE\u6B63\u80DC\u7387 Top5 --");
byWinAdj.slice(0, 5).forEach(
  (r, i) => console.log(`#${i + 1} ${r.name}(${r.cardNo}) n=${r.total} \u4FEE\u6B63=${r.winRateAdj?.toFixed(1)}% \u539F\u59CB=${r.winRate?.toFixed(1)}% rounds=${r.rounds}`)
);
var shadow = legs.find((r) => r.cardNo === "VEN-191");
var shadowRank = byWinAdj.findIndex((r) => r.cardNo === "VEN-191") + 1;
console.log(`\u5F71\u6D41\u4E4B\u4E3B(VEN-191):\u539F\u59CB#1 \u2192 \u4FEE\u6B63\u540E\u7B2C ${shadowRank} \u540D(\u4FEE\u6B63 ${shadow?.winRateAdj?.toFixed(1)}% / \u539F\u59CB ${shadow?.winRate?.toFixed(1)}%)`);
console.log("\u82F1\u96C4\u699C(Tier)\u662F\u5426\u540C\u6B65\u6536\u7F29:", result.heroes ? "(\u5206\u6790\u7BA1\u7EBF\u4ECD\u4E3A\u539F\u59CB\u53E3\u5F84,\u89C6\u56FE\u5C42 quickStats \u5DF2\u6536\u7F29)" : "");
/*! Bundled license information:

papaparse/papaparse.js:
  (* @license
  Papa Parse
  v5.4.1
  https://github.com/mholt/PapaParse
  License: MIT
  *)
*/
