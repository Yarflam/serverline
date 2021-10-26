const EventEmitter = require('events');
const readline = require('readline');
const stream = require('stream');
const util = require('util');

const PROMPT_DEFAULT = '> ';

class Serverline {
    constructor() {
        /* Instances */
        this._myEmitter = new EventEmitter();
        this._collection = {
            stdout: new stream.Writable(),
            stderr: new stream.Writable()
        };
        this._rl = null;
        /* Data */
        this._stdoutMuted = false;
        this._myPrompt = PROMPT_DEFAULT;
        this._hidePrompt = false;
        this._completions = [];
        this._fixSIGINTonQuestion = false;
    }

    isCompatible(withErr = true) {
        if (process.version.match(/v(\d+)\.(\d+).(\d+)/)[1] < 10) {
            if (withErr) throw new Error('serverline require node >= 10');
            return false;
        }
        return true;
    }

    init(options, withWarn = true) {
        /* Args */
        if (typeof options === 'string') options = { prompt: options };

        /* Options */
        const slOptions = Object.assign(
            {},
            { prompt: PROMPT_DEFAULT },
            options
        );
        if (slOptions.forceTerminalContext) {
            process.stdin.isTTY = true;
            process.stdout.isTTY = true;
        }

        /* Instance */
        this._rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            completer: (...args) => this.__completer(...args),
            prompt: slOptions.prompt
        });
        if (withWarn && !this._rl.terminal) {
            console.warn(
                'WARN: Compatibility mode! The current context is not a terminal. This may ' +
                    'occur when you redirect terminal output into a file.'
            );
            console.warn(
                'You can try to define `options.forceTerminalContext = true`.'
            );
        }

        /* Console rules */
        let consoleOptions = {};
        ['colorMode', 'inspectOptions', 'ignoreErrors'].forEach(val => {
            if (typeof slOptions[val] !== 'undefined') {
                consoleOptions[val] = slOptions[val];
            }
        });
        this.__consoleOverwrite(consoleOptions);
        this.__hiddenOverwrite();

        /* Initialize the events */
        this.__initEvents();
    }

    __initEvents() {
        this._rl.on('line', line => {
            if (!this._stdoutMuted && this._rl.history && this._rl.terminal) {
                this._rl.history.push(line);
            }
            if (this._hidePrompt) process.stdout.write('\x1b[A\x1b[K');
            this._myEmitter.emit('line', line);
            if (this._rl.terminal) {
                this._rl.prompt();
            }
        });

        this._rl.on('SIGINT', () => {
            this._fixSIGINTonQuestion = !!this._rl._questionCallback;
            if (this._rl.terminal) {
                this._rl.line = '';
            }
            if (!this._myEmitter.emit('SIGINT', this._rl)) {
                process.exit(0);
            }
        });

        this._rl.prompt();

        this._rl.input.on('data', char => {
            // fix CTRL+C on question
            if (char === '\u0003' && this._fixSIGINTonQuestion) {
                this._rl._onLine('');
                this._rl._refreshLine();
            }
            this._fixSIGINTonQuestion = false;
        });
    }

    secret(query, callback) {
        const toggleAfterAnswer = !this._stdoutMuted;
        this._stdoutMuted = true;
        this._rl.question(query, value => {
            if (this._rl.terminal) this._rl.history = this._rl.history.slice(1);
            if (toggleAfterAnswer) this._stdoutMuted = false;
            callback(value);
        });
    }

    question() {
        this._rl.question.apply(this._rl, arguments);
    }

    isMuted() {
        return this._stdoutMuted;
    }

    close() {
        if (!this._rl) return false;
        this._rl.close();
        return true;
    }

    pause() {
        if (!this._rl) return false;
        this._rl.pause();
        return true;
    }

    resume() {
        if (!this._rl) return false;
        this._rl.resume();
        return true;
    }

    on(eventName) {
        if (
            eventName === 'line' ||
            eventName === 'SIGINT' ||
            eventName === 'completer'
        ) {
            return this._myEmitter.on.apply(this._myEmitter, arguments);
        }
        this._rl.on.apply(this._myEmitter, arguments);
        return this;
    }

    _debugModuleSupport(debug) {
        if (typeof debug !== 'object' || debug === null) return false;
        debug.log = () =>
            console.log(util.format.apply(util, arguments).toString());
        return true;
    }

    /*
     *  SETTERS
     */

    setPrompt(strPrompt, hidePrompt = false) {
        this._myPrompt = strPrompt;
        this._hidePrompt = hidePrompt;
        this._rl.setPrompt(this._myPrompt);
        return this._myPrompt;
    }

    setMuted(enabled, msg) {
        this._stdoutMuted = !!enabled;
        const message = msg && typeof msg === 'string' ? msg : '> [hidden]';
        this._rl.setPrompt(!this._stdoutMuted ? this._myPrompt : message);
        return this._stdoutMuted;
    }

    setCompletion(obj) {
        this._completions = typeof obj === 'object' ? obj : this._completions;
        return this._completions;
    }

    setHistory(history) {
        if (this._rl._terminal && Array.isArray(history)) {
            this._rl._history = history;
            return true;
        }
        return !!this._rl.terminal;
    }

    /*
     *  GETTERS
     */

    getPrompt() {
        return this._myPrompt;
    }

    getHistory() {
        return this._rl.terminal ? this._rl.history : [];
    }

    getCollection() {
        return {
            stdout: this._collection.stdout,
            stderr: this._collection.stderr
        };
    }

    getRl() {
        return this._rl;
    }

    /*
     *  Utils
     */

    __completer(line) {
        let hits = this._completions.filter(c => {
            return c.indexOf(line) === 0;
        });

        const arg = {
            line: line,
            hits: hits
        };

        this._myEmitter.emit('completer', arg);

        hits = arg.hits;
        if (hits.length === 1) {
            return [hits, line];
        } else {
            console.log('\x1B[96mSuggest:\x1B[00m');

            let list = '';
            let l = 0;
            let c = '';
            let t = hits.length ? hits : this._completions;

            for (let i = 0; i < t.length; i++) {
                c = t[i].replace(/(\s*)$/g, '');

                if (list !== '') {
                    list += ', ';
                }

                if ((list + c).length + 4 - l > process.stdout.columns) {
                    list += '\n';
                    l = list.length;
                }
                list += c;
            }
            console.log('\x1B[96m' + list + '\x1B[00m');
            return [line !== arg.line ? [arg.line] : [], line];
        }
    }

    __consoleOverwrite(options) {
        const original = {
            stdout: process.stdout,
            stderr: process.stderr
        };

        Object.keys(this._collection).forEach(name => {
            this._collection[name]._write = (chunk, encoding, callback) => {
                // https://github.com/nodejs/node/blob/v10.0.0/lib/readline.js#L178
                if (this._rl.terminal) {
                    original[name].write(
                        this.__beforeTheLastLine(chunk),
                        encoding,
                        () => {
                            this._rl._refreshLine();
                            callback();
                        }
                    );
                } else {
                    original[name].write(chunk, encoding, callback);
                }
            };
        });

        const Console = console.Console;
        const consoleOptions = Object.assign(
            {},
            {
                stdout: this._collection.stdout,
                stderr: this._collection.stderr
            },
            options
        );
        console = new Console(consoleOptions); // eslint-disable-line no-global-assign
        console.Console = Console;
    }

    __beforeTheLastLine(chunk) {
        const nbline = Math.ceil(
            (this._rl.line.length + this._rl._prompt.length + 1) /
                this._rl.columns
        );

        let text = '';
        text += '\n\r\x1B[' + nbline + 'A\x1B[0J';
        text += chunk.toString();
        text += Array(nbline).join('\n');

        return Buffer.from(text, 'utf8');
    }

    __hiddenOverwrite() {
        this._rl._refreshLine = (refresh => {
            // https://github.com/nodejs/node/blob/v10.0.0/lib/readline.js#L326 && ./v9.5.0/lib/readline.js#L335
            return () => {
                let abc;
                if (this._stdoutMuted && this._rl.line) {
                    abc = this._rl.line;
                    this._rl.line = '';
                }

                refresh.call(this._rl);

                if (this._stdoutMuted && this._rl.line) {
                    this._rl.line = abc;
                }
            };
        })(this._rl._refreshLine);

        this._rl._writeToOutput = (write => {
            // https://github.com/nodejs/node/blob/v10.0.0/lib/readline.js#L289 && ./v9.5.0/lib/readline.js#L442
            return argStringToWrite => {
                let stringToWrite = argStringToWrite;

                if (!this._stdoutMuted) {
                    stringToWrite = argStringToWrite;
                } else if (this._rl.terminal) {
                    // muted && terminal
                    stringToWrite =
                        '\x1B[2K\x1B[200D' +
                        this._rl._prompt +
                        '[' +
                        (this._rl.line.length % 2 === 1 ? '=-' : '-=') +
                        ']';
                } else {
                    // muted && terminal == false
                    stringToWrite = '';
                }

                write.call(this._rl, stringToWrite);
            };
        })(this._rl._writeToOutput);
    }
}

/* Only one instance (like initial repo) */
const handle = new Serverline();
module.exports = handle;
