const nodePackage = require('../service/nodepackage.service');
const NodePackage = nodePackage.NodePackage;
const apiService = require('../service/api.service.js').ApiService;
const authService = require('../service/auth.service.js').AuthService;
const bunyan = NodePackage.bunyan;
const EventEmitter = NodePackage.EventEmitter;
const emitter = new EventEmitter.EventEmitter();
module.exports.auth = auth;
module.exports.emitter = emitter;
function auth(config, utility) {
    const credential = config.credential;
    const defaults = config.defaults;
    const requestTimeout = defaults.requesttimeout || 40;
    const retryServer = defaults.retry || 10;
    apiService.setTimeout(requestTimeout);
    // set loginType in axios header 
    apiService.setDefaultHeader(config.loginType);
    const log = bunyan.createLogger({ name: `auth`, level: config.logger.loglevel || 20 });
    return {
        name: `authentication`,
        onStartup: false,
        authResponse: {},
        /**
         * This method logged in to server using credentials configured in config file
        */
        async getAuthentication() {
            try {
                const payload = {
                    identifier: credential.identifier,
                    password: credential.password
                }
                const response = await authService.authenticate(payload);
                const { status, data } = response;
                if (status === utility.HTTP_STATUS_CODE.SUCCESS && data) {
                    apiService.setHeader(data.sessionId);
                    this.authResponse = data;
                    if (!this.onStartup) {
                        this.onStartup = true;
                        emitter.emit('init');
                    }
                } else {
                    // retry for authentication
                    log.error(`Error in authentication to server ${JSON.stringify(response.data)}`);
                    await utility.setTimer(retryServer);
                    await this.getAuthentication();
                }
            } catch (ex) {
                debugger;
                log.error(`Exception in authentication ${ex}`);
                await utility.setTimer(retryServer);
                await this.getAuthentication();
            }
        }
    }
}